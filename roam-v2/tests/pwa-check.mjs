import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFile, access, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDirectory = process.argv.find(value=>value.startsWith('--artifact='))?.slice(11) ?? 'dist'
const read = (path) => readFile(path.startsWith('dist/') ? resolve(root,buildDirectory,path.slice(5)) : resolve(root,path))
const hash = (content) => createHash('sha256').update(content).digest('hex')
const manifest = JSON.parse(await read('public/manifest.webmanifest'))
assert.equal(manifest.name, 'Roam')
assert.equal(manifest.display, 'standalone')
for (const key of ['id', 'scope', 'start_url']) assert.equal(manifest[key], './')
for (const icon of manifest.icons) {
  const bytes = await read(`public/${icon.src}`)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  const [width, height] = icon.sizes.split('x').map(Number)
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height)
}
assert(manifest.icons.some((icon) => icon.sizes === '192x192'))
assert(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'))
assert((await read('index.html')).toString().includes('%BASE_URL%manifest.webmanifest'))
assert((await read('vite.config.ts')).toString().includes("base: './'"))
const template = (await read('pwa/service-worker.js')).toString()

async function scenario(scope, tampered = false, preserveClients = false) {
  const fixtures = new Map([
    ['index.html', '<html><body>Roam static</body></html>'],
    ['assets/main.js', 'console.log("static application")'],
    ['manifest.webmanifest', JSON.stringify(manifest)],
  ])
  const precache = [...fixtures].map(([path, content]) => ({ path, sha256: hash(content) }))
  const handlers = new Map()
  const storage = new Map()
  const ownPrefix = `roam-v2-static:${scope}:`
  storage.set('roam-v1', new Map())
  storage.set('roam-v2-static:https://roam.test/other/:older', new Map())
  storage.set(ownPrefix + 'older', new Map([[new URL('assets/old.js', scope).href, new Response('old static code')]]))
  let writes = 0
  let online = true
  let forced = 0
  const caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map())
      const values = storage.get(name)
      return { async put(key, response) { writes++; values.set(String(key), response.clone()) }, async match(key) { return values.get(String(key))?.clone() } }
    },
    async keys() { return [...storage.keys()] },
    async delete(name) { return storage.delete(name) },
  }
  const fetcher = async (request) => {
    if (!online) throw new TypeError('Offline test')
    const url = typeof request === 'string' ? request : request.url
    const entry = [...fixtures].find(([path]) => new URL(path, scope).href === url)
    assert(entry, `Unexpected fetch: ${url}`)
    if (request instanceof Request) { assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'reload') }
    const body = tampered && entry[0] === 'assets/main.js' ? 'not this build' : entry[1]
    const response = new Response(body)
    Object.defineProperty(response, 'type', { value: 'basic' })
    return response
  }
  const self = { registration: { scope }, addEventListener(type, callback) { handlers.set(type, callback) },
    skipWaiting() { forced++ }, clients: { async matchAll() { return preserveClients ? [{ id: 'live', url: scope, postMessage() {} }] : [] }, claim() { forced++ } } }
  const script = template.replace('const PRECACHE = []', `const PRECACHE = ${JSON.stringify(precache)}`)
    .replace("const BUILD_ID = ''", "const BUILD_ID = 'test-build'")
  vm.runInNewContext(script, { self, caches, fetch: fetcher, crypto: webcrypto, URL, Request, Response, Uint8Array, Map, setTimeout, clearTimeout })
  async function lifecycle(type) {
    let promise
    handlers.get(type)({ waitUntil(value) { promise = value } })
    await promise
  }
  if (tampered) {
    await assert.rejects(() => lifecycle('install'))
    assert(!storage.has(ownPrefix + 'test-build'))
    assert(storage.has(ownPrefix + 'older'))
    return
  }
  await lifecycle('install')
  assert.equal(writes, fixtures.size)
  assert.equal(forced, 0)
  assert(handlers.has('message'))
  assert.equal(forced, 0)
  await lifecycle('activate')
  assert(storage.has('roam-v1'))
  assert(storage.has('roam-v2-static:https://roam.test/other/:older'))
  assert.equal(storage.has(ownPrefix + 'older'), preserveClients)
  online = false
  async function request(url, method = 'GET', mode = 'same-origin') {
    let response
    handlers.get('fetch')({ request: { url, method, mode }, respondWith(value) { response = value } })
    return response === undefined ? undefined : await response
  }
  assert((await (await request(scope, 'GET', 'navigate')).text()).includes('Roam static'))
  assert((await (await request(new URL('assets/main.js', scope).href)).text()).includes('static application'))
  for (const url of [new URL('backup.zip', scope).href, new URL('api/trips', scope).href,
    new URL('index.html?trip=private', scope).href, new URL('assets/main.js?token=private', scope).href,
    'https://outside.test/photo.jpg', 'blob:https://roam.test/personal', 'https://roam.test/v1/index.html']) {
    assert.equal(await request(url), undefined)
  }
  assert.equal(await request(new URL('assets/main.js', scope).href, 'POST'), undefined)
  if (preserveClients) assert.equal(await (await request(new URL('assets/old.js', scope).href)).text(), 'old static code')
  assert.equal(writes, fixtures.size, 'No runtime caching allowed')
  storage.get(ownPrefix + 'test-build').delete(new URL('index.html', scope).href)
  assert.equal((await request(scope, 'GET', 'navigate')).status, 503)
}
await scenario('https://roam.test/')
await scenario('https://roam.test/roam-v2/')
await scenario('https://roam.test/roam-v2/', true)
await scenario('https://roam.test/roam-v2/', false, true)
console.log('PWA source checks passed: manifest/icons, root/subpath, offline cache, exclusions, integrity failure, scoped cleanup and no activation without a user request.')

async function updateScenario(votes, changedClients = false, concurrent = false) {
  const scope = 'https://roam.test/roam-v2/'
  const handlers = new Map()
  let forced = 0
  let lookups = 0
  const messages = []
  const clients = votes.map((vote, index) => ({
    id: `tab-${index}`, url: scope,
    postMessage(message) {
      messages.push({ tab: index, ...message })
      if (message.type === 'ROAM_UPDATE_CHECK' && vote !== null) queueMicrotask(() => {
        handlers.get('message')({ data: { type: 'ROAM_UPDATE_VOTE', id: message.id, ok: vote }, source: clients[index] })
      })
    },
  }))
  const outside = { id: 'v1', url: 'https://roam.test/v1/', postMessage() { throw new Error('V1 tab contacted') } }
  const self = { registration: { scope }, addEventListener(type, handler) { handlers.set(type, handler) },
    async skipWaiting() { forced++ }, clients: { async matchAll() {
      lookups++
      return changedClients && lookups > 1 ? [...clients, outside, { id: 'new-tab', url: scope, postMessage() {} }] : [...clients, outside]
    } } }
  vm.runInNewContext(template.replace("const BUILD_ID = ''", "const BUILD_ID = 'update-test'"), {
    self, URL, Map, setTimeout: (callback) => setTimeout(callback, 20), clearTimeout,
  })
  assert.equal(forced, 0)
  handlers.get('message')({ data: { type: 'ROAM_UPDATE_VOTE', id: 'unsolicited', ok: true }, source: clients[0] })
  assert.equal(forced, 0)
  let operation
  handlers.get('message')({ data: { type: 'ROAM_REQUEST_UPDATE', id: 'explicit-click' }, source: clients[0], waitUntil(value) { operation = value } })
  if (concurrent) handlers.get('message')({ data: { type: 'ROAM_REQUEST_UPDATE', id: 'other-click' }, source: clients[1], waitUntil() {} })
  await operation
  const expected = votes.every((vote) => vote === true) && !changedClients
  assert.equal(forced, expected ? 1 : 0)
  assert.equal(messages.some((message) => message.type === 'ROAM_UPDATE_COMMIT'), expected)
  if (!expected) assert(messages.some((message) => message.type === 'ROAM_UPDATE_RELEASE'))
  if (concurrent) assert(messages.some((message) => message.id === 'other-click' && message.ok === false))
}
await updateScenario([true, true])
await updateScenario([true, false])
await updateScenario([true, null])
await updateScenario([true, true], true)
await updateScenario([true, true], false, true)
console.log('Update protocol checks passed: explicit request, all-tab votes, refusal/timeout/new tab, concurrent clicks and no V1 messages.')

if (!process.argv.includes('--source-only')) {
  await access(resolve(root,buildDirectory,'sw.js'))
  const built = JSON.parse(await read('dist/precache-manifest.json'))
  const sw = (await read('dist/sw.js')).toString()
  assert.match(built.buildId, /^[a-f0-9]{24}$/)
  assert(sw.includes(`const PRECACHE = ${JSON.stringify(built.entries)}`))
  assert(sw.includes(`const BUILD_ID = ${JSON.stringify(built.buildId)}`))
  assert(built.entries.some((entry) => entry.path === 'index.html'))
  assert(built.entries.some((entry) => /^assets\/.+\.js$/.test(entry.path)))
  assert(built.entries.some((entry) => /^assets\/.+\.css$/.test(entry.path)))
  for (const entry of built.entries) {
    assert(!entry.path.includes('..') && !entry.path.startsWith('/') && !entry.path.includes('\\'))
    assert(!/\.(zip|pdf|map|json)$/.test(entry.path))
    assert.equal(hash(await read(`dist/${entry.path}`)), entry.sha256, `Build hash mismatch: ${entry.path}`)
  }
  const optionalMapAssets = (await readdir(resolve(root,buildDirectory,'assets'))).filter((path) => /^(?:maplibrePreview|maplibre-gl-worker)[-.]/.test(path))
  assert(optionalMapAssets.some((path) => /^maplibrePreview-.*\.js$/.test(path)), 'Lazy MapLibre chunk missing')
  assert(optionalMapAssets.some((path) => /^maplibre-gl-worker-.*\.js$/.test(path)), 'Bundled map worker missing')
  for (const path of optionalMapAssets) assert(!built.entries.some((entry) => entry.path === `assets/${path}`), `Optional map asset precached: ${path}`)
  const mainEntry = built.entries.find((entry) => /^assets\/index-.*\.js$/.test(entry.path))
  assert(mainEntry && /import\(\s*["'`][^"'`]*maplibrePreview-/.test((await read(`dist/${mainEntry.path}`)).toString()), 'MapLibre must use a dynamic import')
  console.log('Production build checks passed: every precached file exists and matches its SHA-256.')
  console.log('Optional map assets: lazy chunk and worker present, excluded from PWA precache.')
}
