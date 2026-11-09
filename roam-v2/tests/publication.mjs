import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const root = fileURLToPath(new URL('../', import.meta.url))
const profile = mkdtempSync(join(tmpdir(), 'roam-publication-tests-'))
const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
const children = []
const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
let socket
let siteServer
try {

  const address = `http://127.0.0.1:${port}`, base = '/roam-travel-planning/'
  const artifact = join(root, 'node_modules/.tmp/pages-v2-dist')
  const legacy = new Map(['index.html','app.js','style.css','sw.js','manifest.webmanifest','icon.svg'].map(name=>[name,execFileSync('git',['show',`master:${name}`],{cwd:join(root,'..')})]))
  const manifestV1=JSON.parse(legacy.get('manifest.webmanifest')),manifestV2=JSON.parse(readFileSync(join(artifact,'manifest.webmanifest')))
  const manifestUrl=address+base+'manifest.webmanifest'
  assert.equal(new URL(manifestV1.id??manifestV1.start_url,manifestUrl).href,new URL(manifestV2.id,manifestUrl).href,'PWA identity changed')
  assert.equal(new URL(manifestV2.scope,manifestUrl).pathname,base)
  assert.equal(new URL(manifestV2.start_url,manifestUrl).pathname,base)
  const precache=JSON.parse(readFileSync(join(artifact,'precache-manifest.json')))
  for(const entry of precache.entries)assert.equal(createHash('sha256').update(readFileSync(join(artifact,entry.path))).digest('hex'),entry.sha256)
  for(const match of readFileSync(join(artifact,'index.html'),'utf8').matchAll(/(?:href|src)="([^"]+)"/g))assert(new URL(match[1],address+base).pathname.startsWith(base),'Asset outside project base')
  console.log('PASS : artefact projet, chemins, identité manifest V1/V2, scope et SHA-256.')
  let phase='v1'
  siteServer=http.createServer((req,res)=>{
    const pathname=new URL(req.url,address).pathname
    if(pathname===base.slice(0,-1)){res.writeHead(301,{Location:base});res.end();return}
    if(!pathname.startsWith(base)){res.writeHead(404);res.end();return}
    const path=decodeURIComponent(pathname.slice(base.length))||'index.html'
    if(path.includes('..')||path.includes('\\')){res.writeHead(400);res.end();return}
    let content
    try{content=phase==='v1'?legacy.get(path):readFileSync(join(artifact,path))}catch{if(['app.js','style.css','icon.svg'].includes(path))content=legacy.get(path)}
    if(!content){res.writeHead(404);res.end('Not found');return}
    const ext=path.split('.').pop(),mime={html:'text/html',js:'text/javascript',css:'text/css',webmanifest:'application/manifest+json',json:'application/json',svg:'image/svg+xml',png:'image/png'}[ext]??'application/octet-stream'
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content)
  })
  await new Promise(resolve=>siteServer.listen(port,'127.0.0.1',resolve))
  const chrome = spawn(process.env.ROAM_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
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
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  await command('Page.enable'); await command('Runtime.enable'); await command('Page.bringToFront')

  const checked = async (expression) => { const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text); return response.result?.value }
  const wait = async (expression, label) => { for(let i=0;i<200;i++){ if(await checked(expression)) return; await pause(100) }; throw new Error(label + ': ' + await checked('document.body.innerText.slice(-2500)')) }
  const click = async (text) => checked(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Bouton absent: '+${JSON.stringify(text)});b.click()})()`)

  const url=address+base
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(address)}){if(!localStorage.getItem('roam'))localStorage.setItem('roam',JSON.stringify({marker:'fixture-publication-only',trip:{start:'2026-12-31',end:'2027-01-01',budget:0},acts:[],expenses:[],infos:[]}));}`})
  await command('Page.navigate',{url});await wait('Boolean(document.querySelector("#days"))','V1 initiale')
  await checked('navigator.serviceWorker.ready.then(()=>true)');await command('Page.reload');await wait('Boolean(navigator.serviceWorker.controller)','Contrôle V1')
  const original=await checked('localStorage.getItem("roam")')
  phase='v2'
  await checked('(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()})()')
  await wait('(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting))()','Worker V2 en attente')
  assert(await checked('Boolean(document.querySelector("#days"))'),'V1 was forced closed')
  console.log('PASS : V1 reste affichée, V2 attend sans activation forcée ni effacement du cache V1.')
  await command('Page.navigate',{url:'about:blank'});await pause(700);await command('Page.navigate',{url})
  await wait('Boolean(document.querySelector(\'[aria-label="Ouvrir le voyage Londres"]\'))','V2 au sous-chemin')
  assert.equal(await checked('localStorage.getItem("roam")'),original)
  assert(await checked('caches.has("roam-v1")'))
  assert.equal(await checked('(async()=> (await navigator.serviceWorker.getRegistration()).scope)()'),url)
  console.log('PASS : bascule après fermeture des clients, V2 au même scope ; données localStorage V1 conservées.')
  await checked('document.querySelector(\'[aria-label="Ouvrir le voyage Londres"]\').click()');await click('Programme')
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ajouter une activité'))`,'Programme V2')
  await click('Ajouter une activité');await wait('Boolean(document.querySelector("dialog input:not([type])"))','Formulaire V2')
  await checked(`(()=>{const i=document.querySelector('dialog input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'PUBLICATION TEST');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('Ajouter l’activité');await wait('Boolean(document.querySelector(\'[aria-label="Consulter l’activité PUBLICATION TEST"]\'))','Activité V2')
  await command('Network.enable');await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
  await command('Page.navigate',{url:'about:blank'});await command('Page.navigate',{url})
  await wait('Boolean(document.querySelector(\'[aria-label="Ouvrir le voyage Londres"]\'))','Démarrage offline au sous-chemin')
  await checked('document.querySelector(\'[aria-label="Ouvrir le voyage Londres"]\').click()');await click('Programme')
  await wait('Boolean(document.querySelector(\'[aria-label="Consulter l’activité PUBLICATION TEST"]\'))','Persistance V2 offline')
  assert.equal(await checked('localStorage.getItem("roam")'),original)
  console.log('PASS : V2 démarre hors connexion sous /roam-travel-planning/ et retrouve son activité.')
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
  phase='v1'
  await checked('(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()})()')
  await wait('(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting))()','Rollback V1 en attente')
  await command('Page.navigate',{url:'about:blank'});await pause(700);await command('Page.navigate',{url})
  await wait('Boolean(document.querySelector("#days"))','Retour V1')
  assert.equal(await checked('localStorage.getItem("roam")'),original)
  const retained=await checked(`new Promise((resolve,reject)=>{const r=indexedDB.open('roam-v2-db');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('activities','readonly'),q=tx.objectStore('activities').getAll();q.onsuccess=()=>{const result={version:db.version,count:q.result.filter(a=>a.title==='PUBLICATION TEST').length};db.close();resolve(result)}}})`)
  assert.equal(retained.count,1);assert.equal(retained.version,50)
  console.log('PASS : rollback V1 sans purge ni unregister, localStorage V1 et base IndexedDB V2 intacts (invisibles dans V1).')
  console.log('Publication simulée uniquement ; aucun accès en écriture à GitHub ni aux profils personnels.')

} finally {
  socket?.close()
  siteServer?.close()
  for (const child of children.reverse()) { if (child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {} } }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { console.log('Profil temporaire de test laissé dans: ' + profile) }
}
