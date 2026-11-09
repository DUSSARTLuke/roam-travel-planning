import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
const root = fileURLToPath(new URL('../', import.meta.url))
const profile = mkdtempSync(join(tmpdir(), 'roam-map-tests-'))
const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) }) })
const children = []
const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
let socket
let serverLog = ''
try {
  const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore','pipe','pipe'], windowsHide: true })
  children.push(vite)
  vite.stdout.on('data', (data) => { serverLog += data }); vite.stderr.on('data', (data) => { serverLog += data })
  const address = `http://127.0.0.1:${port}`
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(address)).ok) { ready = true; break } } catch {} await pause(100) }
  if (!ready) throw new Error('Vite indisponible: ' + serverLog)
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
  await command('Page.navigate', { url: address + '/' })
  await wait(`Boolean(document.querySelector('[aria-label="Ouvrir le voyage Londres"]'))`, 'Application initiale')
  await checked('navigator.serviceWorker.ready.then(()=>true)')
  await command('Page.reload')
  await wait('Boolean(navigator.serviceWorker.controller)', 'Contrôle service worker')
  await wait(`Boolean(document.querySelector('[aria-label="Ouvrir le voyage Londres"]'))`, 'Voyage chargé')
  await command('Network.enable')
  await command('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
  if(await checked('navigator.onLine') !== false) throw new Error('Réseau non désactivé')
  await command('Page.navigate', {url:'about:blank'})
  await command('Page.navigate', {url:address+'/'})
  await wait(`Boolean(document.querySelector('[aria-label="Ouvrir le voyage Londres"]'))`, 'Démarrage entièrement hors ligne')
  console.log('PASS : démarrage production hors ligne depuis une nouvelle navigation, contrôlé par le SW.')
  await checked(`document.querySelector('[aria-label="Ouvrir le voyage Londres"]').click()`)
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Programme'))`, 'Raccourci Programme')
  await click('Programme')
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ajouter une activité'))`, 'Programme hors ligne')
  await click('Ajouter une activité')
  await wait(`Boolean(document.querySelector('dialog input:not([type])'))`, 'Formulaire')
  await checked(`(()=>{const i=document.querySelector('dialog input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'TEST OFFLINE PRODUCTION');i.dispatchEvent(new Event('input',{bubbles:true}));const dt=new DataTransfer();const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='),c=>c.charCodeAt(0));dt.items.add(new File([bytes],'test-offline.png',{type:'image/png'}));const f=document.querySelector('dialog input[type=file]');f.files=dt.files;f.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await wait(`Boolean([...document.querySelectorAll('dialog button[type=submit]')].find(b=>b.textContent.trim()==='Ajouter l’activité'&&!b.disabled))`, 'Validation du document avant soumission')
  await click('Ajouter l’activité')
  await wait(`Boolean(document.querySelector('[aria-label="Consulter l’activité TEST OFFLINE PRODUCTION"]'))`, 'Enregistrement sans réseau')
  console.log('PASS : création via formulaire avec pièce jointe, réseau réellement coupé.')
  await checked(`document.querySelector('[aria-label="Consulter l’activité TEST OFFLINE PRODUCTION"]').click()`)
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Modifier l’activité'))`, 'Fiche offline')
  await click('Modifier l’activité')
  await wait(`Boolean(document.querySelector('dialog button[type=submit]')&&!document.querySelector('dialog button[type=submit]').disabled)`, 'Révision offline')
  await checked(`(()=>{const i=document.querySelector('dialog input:not([type])');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'TEST OFFLINE MODIFIÉ');i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('Enregistrer les modifications')
  await wait(`Boolean(document.querySelector('#activity-detail-title')?.textContent.includes('TEST OFFLINE MODIFIÉ'))`, 'Modification offline')
  console.log('PASS : modification hors connexion avec contrôle de révision.')

  await command('Page.navigate', {url:'about:blank'}); await command('Page.navigate', {url:address+'/'})
  await wait(`Boolean(document.querySelector('[aria-label="Ouvrir le voyage Londres"]'))`, 'Redémarrage offline')
  await checked(`document.querySelector('[aria-label="Ouvrir le voyage Londres"]').click()`)
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Programme'))`, 'Programme après redémarrage')
  await click('Programme')
  await wait(`Boolean(document.querySelector('[aria-label="Consulter l’activité TEST OFFLINE MODIFIÉ"]'))`, 'Persistance offline après redémarrage')
  console.log('PASS : activité conservée après fermeture de la page et redémarrage hors ligne.')
  await checked(`document.querySelector('[aria-label="Consulter l’activité TEST OFFLINE MODIFIÉ"]').click()`)
  await wait(`Boolean(document.querySelector('[aria-label="Consulter test-offline.png"]'))`, 'Document local')
  await checked(`document.querySelector('[aria-label="Consulter test-offline.png"]').click()`)
  await wait(`Boolean(document.querySelector('.document-viewer img')?.naturalWidth)`, 'Affichage image locale offline')
  console.log('PASS : image IndexedDB consultable sans réseau après redémarrage.')
  await click('Fermer')
  await wait(`Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Supprimer l’activité'))`, 'Fiche après image')
  await click('Supprimer l’activité');await click('Supprimer définitivement l’activité')
  await wait(`!document.querySelector('dialog')&&!document.body.textContent.includes('TEST OFFLINE MODIFIÉ')`, 'Suppression offline')
  await command('Page.navigate',{url:'about:blank'});await command('Page.navigate',{url:address+'/'})
  await wait(`Boolean(document.querySelector('[aria-label="Ouvrir le voyage Londres"]'))`, 'Deuxième redémarrage offline')
  await checked(`document.querySelector('[aria-label="Ouvrir le voyage Londres"]').click()`);await click('Programme')
  await wait(`Boolean(document.querySelector('.program-empty'))`, 'Suppression persistée offline')
  console.log('PASS : suppression et cascade persistées après une deuxième réouverture hors ligne.')

  console.log('Profil temporaire uniquement ; aucune donnée utilisateur consultée ou modifiée.')

} finally {
  socket?.close()
  for (const child of children.reverse()) { if (child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {} } }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { console.log('Profil temporaire de test laissé dans: ' + profile) }
}
