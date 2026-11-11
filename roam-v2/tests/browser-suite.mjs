import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
const realMap=process.argv.includes('--real-map')
const requestedWidth=/^\d+$/.test(process.argv[2]??'')?Number(process.argv[2]):Number(process.env.ROAM_TEST_WIDTH||1100)
const root = fileURLToPath(new URL('../', import.meta.url))
const profile = mkdtempSync(join(tmpdir(), 'roam-map-tests-'))
const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
const children = []
const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
let socket
let serverLog = ''
try {
  const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', join(root, 'tests/vite.isolated.config.ts'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore','pipe','pipe'], windowsHide: true })
  children.push(vite)
  vite.stdout.on('data', (data) => { serverLog += data }); vite.stderr.on('data', (data) => { serverLog += data })
  const address = `http://127.0.0.1:${port}`
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(address)).ok) { ready = true; break } } catch {} await pause(100) }
  if (!ready) throw new Error('Vite indisponible: ' + serverLog)
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', ...(realMap?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-gpu']), '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  children.push(chrome)
  const activePort = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !existsSync(activePort); i++) await pause(100)
  if (!existsSync(activePort)) throw new Error('Chrome headless indisponible')
  const debugPort = Number(readFileSync(activePort, 'utf8').split('\n')[0])
  const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const tab = tabs.find((item) => item.type === 'page')
  socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let nextId = 0
  const pending = new Map()
  const errors = []
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result) }
    if(message.method==='Fetch.requestPaused')void command('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'},{name:'Access-Control-Allow-Origin',value:'*'}],body:'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADIElEQVR4nO3UIQEAIBDAwA+GRtO/DMRA7MT5qc3a5wJN8zsA+McAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIMwAIOwBQacbQIfjdbIAAAAASUVORK5CYII='}).catch(error=>errors.push(String(error)))
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value
  await command('Page.enable'); await command('Runtime.enable'); await command('Page.bringToFront')
  await command('Emulation.setDeviceMetricsOverride', {width:requestedWidth,height:900,deviceScaleFactor:1,mobile:requestedWidth<768})
  if(realMap)await command('Fetch.enable',{patterns:[{urlPattern:'https://tile.openstreetmap.org/*'}]})
  await command('Page.navigate', { url: address + '/tests/activities.html' })
  let loaded = false
  for (let i = 0; i < 150; i++) { if (await evaluate("document.body.dataset.testsReady === 'true'")) { loaded = true; break } await pause(100) }
  if (!loaded) throw new Error('Suite non chargée: ' + errors.join('\n') + '\n' + serverLog)
  // Wait for module execution after network completion before clicking.
  await pause(1200)
  if(realMap){const result=await evaluate(`(async()=>{try{const module=await import('/tests/realMap.browser.ts');return await module.testRealMapRenderer()}catch(error){return {ok:false,error:String(error)}}})()`);console.log(JSON.stringify(result));if(!result?.ok)throw Error('Rendu MapLibre réel échoué : '+JSON.stringify(result));}else{
  console.log('Contrôle isolé sélecteur :', await evaluate(`(async()=>{try{const m=await import('/tests/currencySelector.browser.tsx');m.testCurrencySelector(()=>{});return 'réussi'}catch(e){return String(e)}})()`))
  await evaluate('document.querySelector("#run").click()')
  let result = ''
  for (let i = 0; i < 600; i++) {
    result = await evaluate('document.querySelector("#results").textContent') ?? ''
    if (result.includes('ÉCHEC') || result.includes('Tous les tests ont réussi')) break
    await pause(100)
  }
  console.log(result)
  if (!result.includes('Tous les tests ont réussi')) throw new Error('Suite navigateur échouée: ' + errors.join('\n') + '\n' + serverLog)
  }
} finally {
  socket?.close()
  for (const child of children.reverse()) { if (child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {} } }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { console.log('Profil temporaire de test laissé dans: ' + profile) }
}
