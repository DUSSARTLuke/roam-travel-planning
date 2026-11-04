// Replaced by the production build plugin. Never register this source template.
const PRECACHE = []
const BUILD_ID = ''
const SCOPE = new URL(self.registration.scope)
const CACHE_PREFIX = `roam-v2-static:${SCOPE.href}:`
const CACHE_NAME = CACHE_PREFIX + BUILD_ID
const ALLOWED = new Map(PRECACHE.map((entry) => [new URL(entry.path, SCOPE).href, entry.sha256]))
const INDEX = new URL('index.html', SCOPE).href

async function verifiedResponse(url, expected) {
  const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit' }))
  if (!response.ok || response.redirected || response.type !== 'basic') throw new Error('Static resource unavailable')
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== expected) throw new Error('Static resource does not match this build')
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME)
      for (const [url, hash] of ALLOWED) await cache.put(url, await verifiedResponse(url, hash))
    } catch (error) {
      await caches.delete(CACHE_NAME)
      throw error
    }
  })())
})

function isRoamClient(client) {
  if (!client || typeof client.id !== 'string' || typeof client.url !== 'string') return false
  const url = new URL(client.url)
  return url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.href.split(/[?#]/)[0] === INDEX)
}
async function roamClients() {
  return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(isRoamClient)
}
let updateRequest = null

// An activation request is accepted only after every live Roam tab has reserved
// a safe reload. No response, refusal or changed client set => no skipWaiting.
self.addEventListener('message', (event) => {
  const data = event.data
  const source = event.source
  if (!isRoamClient(source) || !data || typeof data.id !== 'string' || data.id.length > 100) return
  if (data.type === 'ROAM_UPDATE_VOTE') {
    if (updateRequest?.id !== data.id || !updateRequest.votes.has(source.id)) return
    updateRequest.votes.set(source.id, data.ok === true)
    if (data.ok !== true) updateRequest.resolve(false)
    else if ([...updateRequest.votes.values()].every((vote) => vote === true)) updateRequest.resolve(true)
    return
  }
  if (data.type !== 'ROAM_REQUEST_UPDATE') return
  if (updateRequest) { source.postMessage({ type: 'ROAM_UPDATE_RESULT', id: data.id, ok: false, message: 'Une autre demande de mise à jour est déjà en cours.' }); return }
  // Claim the slot before awaiting matchAll, so two concurrent requests cannot race.
  const request = { id: data.id, votes: new Map(), resolve: () => {}, clients: [] }
  updateRequest = request
  event.waitUntil((async () => {
    let timer
    try {
      request.clients = await roamClients()
      if (!request.clients.some((client) => client.id === source.id)) throw new Error('Requesting tab disappeared')
      request.votes = new Map(request.clients.map((client) => [client.id, null]))
      const votes = new Promise((resolve) => {
        request.resolve = resolve
        timer = setTimeout(() => resolve(false), 5000)
      })
      for (const client of request.clients) client.postMessage({ type: 'ROAM_UPDATE_CHECK', id: request.id })
      if (!await votes) throw new Error('A tab is busy or unresponsive')
      const current = await roamClients()
      if (current.length !== request.clients.length || current.some((client) => !request.votes.has(client.id))) throw new Error('The set of tabs changed')
      for (const client of current) client.postMessage({ type: 'ROAM_UPDATE_COMMIT', id: request.id })
      await self.skipWaiting()
      source.postMessage({ type: 'ROAM_UPDATE_RESULT', id: request.id, ok: true })
    } catch {
      for (const client of request.clients) client.postMessage({ type: 'ROAM_UPDATE_RELEASE', id: request.id })
      source.postMessage({ type: 'ROAM_UPDATE_RESULT', id: request.id, ok: false, message: 'Mise à jour reportée : un onglet est occupé, ne répond pas ou vient de changer. Termine les opérations et réessaie.' })
    } finally {
      clearTimeout(timer)
      if (updateRequest === request) updateRequest = null
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const clients = await roamClients()
    // A tab can appear after the final vote, or become unsafe before reload.
    // Retain old static assets while clients exist; never discard their code.
    if (clients.length === 0) {
      for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name)
    }
    for (const client of clients) client.postMessage({ type: 'ROAM_UPDATE_ACTIVATED' })
  })())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || url.protocol !== SCOPE.protocol || url.search || url.hash) return
  const navigation = request.mode === 'navigate' && (url.href === SCOPE.href || url.href === INDEX)
  const key = navigation ? INDEX : url.href
  const legacyAsset = url.pathname.startsWith(new URL('assets/', SCOPE).pathname) && /\.(js|css|svg|png|jpe?g|webp|woff2?|ttf|otf)$/.test(url.pathname)
  if (!ALLOWED.has(key) && !legacyAsset) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(key)
    if (cached) return cached
    if (legacyAsset) {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
          const previous = await (await caches.open(name)).match(key)
          if (previous) return previous
        }
      }
    }
    // No runtime cache writes. Unknown resources never reach this handler.
    try { return await fetch(request) }
    catch {
      return navigation
        ? new Response('Roam ne peut pas démarrer hors connexion. Ouvre cette application une fois en ligne pour préparer ses ressources.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        : Response.error()
    }
  })())
})
