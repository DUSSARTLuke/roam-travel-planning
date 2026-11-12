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
  const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore','pipe','pipe'], windowsHide: true })
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

  const database = 'roam-v2-test-concurrent-' + crypto.randomUUID()
  const url = address + '/tests/concurrent-activity.html?database=' + database
  const checked = async (expression) => { const response = await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result?.value }
  const wait = async (read, expression) => {for(let i=0;i<200;i++){if(await read(expression))return;await pause(100)}throw Error('Attente dépassée: '+expression)}
  await command('Page.navigate',{url}); await wait(checked,'Boolean(window.roamConcurrentTest)')
  await checked('roamConcurrentTest.seed()')
  const created = await command('Target.createTarget',{url})
  let second
  for(let i=0;i<100;i++){second=(await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t=>t.id===created.targetId);if(second)break;await pause(100)}
  const socketB = new WebSocket(second.webSocketDebuggerUrl)
  await new Promise(resolve=>socketB.addEventListener('open',resolve,{once:true}))
  let bid=0;const bpending=new Map()
  socketB.addEventListener('message',({data})=>{const r=JSON.parse(data);if(bpending.has(r.id)){const {resolve,reject}=bpending.get(r.id);bpending.delete(r.id);if(r.error) reject(Error(JSON.stringify(r.error))); else resolve(r.result)}})
  const commandB=(method,params={})=>new Promise((resolve,reject)=>{const id=++bid;bpending.set(id,{resolve,reject});socketB.send(JSON.stringify({id,method,params}))})
  const checkedB=async(expression)=>{const response=await commandB('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description??response.exceptionDetails.text);return response.result?.value}
  try {
    await wait(checkedB,'Boolean(window.roamConcurrentTest)')
    await checked('roamConcurrentTest.open()');await checkedB('roamConcurrentTest.open()')
    await checked(`roamConcurrentTest.save({title:'Titre modifié dans A'})`)
    const before=await checked('roamConcurrentTest.state()')
    const saved=await checkedB(`roamConcurrentTest.save({notes:'Notes de B'})`)
    const after=await checked('roamConcurrentTest.state()')
    if(saved.ok||after.activity.title!=='Titre modifié dans A'||after.operations!==before.operations)throw Error('RÉGRESSION A/B : édition obsolète acceptée ou journal modifié.')
    console.log('PASS : deux onglets réels, édition obsolète refusée sans écriture ni journal.')
    await checked('roamConcurrentTest.open()');await checkedB('roamConcurrentTest.open()')
    const simultaneousBefore=await checked('roamConcurrentTest.state()')
    const simultaneous=await Promise.all([checked(`roamConcurrentTest.save({title:'Simultané A'})`),checkedB(`roamConcurrentTest.save({title:'Simultané B'})`)])
    const simultaneousAfter=await checked('roamConcurrentTest.state()')
    if(simultaneous.filter(r=>r.ok).length!==1||simultaneousAfter.operations!==simultaneousBefore.operations+1)throw Error('Deux écritures simultanées acceptées ou journal incorrect.')
    console.log('PASS : éditions simultanées, une seule validation et une seule opération.')
    const blindBefore=await checked('roamConcurrentTest.state()'),blind=await checkedB('roamConcurrentTest.blindSave()'),blindAfter=await checked('roamConcurrentTest.state()')
    if(blind.ok||blindAfter.operations!==blindBefore.operations||JSON.stringify(blindAfter.activity)!==JSON.stringify(blindBefore.activity))throw Error('Écriture sans révision acceptée.')
    console.log('PASS : appel sans révision refusé au repository, sans écriture.')

    await checked('roamConcurrentTest.openUI()');await checkedB('roamConcurrentTest.openUI()')
    await wait(checked,'roamConcurrentTest.editorState().ready');await wait(checkedB,'roamConcurrentTest.editorState().ready')
    await checked(`roamConcurrentTest.field('title','Titre formulaire A')`)
    await checkedB(`roamConcurrentTest.field('notes','Notes privées de B non enregistrées')`)
    await checkedB('roamConcurrentTest.attach()');await wait(checkedB,'roamConcurrentTest.editorState().ready')
    await checked('roamConcurrentTest.submit()');await wait(checked,'!document.querySelector("dialog")')
    const uiBefore=await checked('roamConcurrentTest.state()')
    await checkedB('roamConcurrentTest.submit()');await wait(checkedB,'Boolean(roamConcurrentTest.editorState().error)')
    const ui=await checkedB('roamConcurrentTest.editorState()'),uiAfter=await checked('roamConcurrentTest.state()')
    if(!ui.error.includes('modifiée')||ui.notes!=='Notes privées de B non enregistrées'||!ui.pending||uiAfter.operations!==uiBefore.operations||uiAfter.documents!==0)throw Error('Conflit UI perd saisie/fichiers ou écrit partiellement.')
    await checkedB('roamConcurrentTest.reload()');await wait(checkedB,'roamConcurrentTest.editorState().ready')
    const reloaded=await checkedB('roamConcurrentTest.editorState()')
    if(reloaded.title!=='Titre formulaire A'||reloaded.notes==='Notes privées de B non enregistrées'||!reloaded.recoveries.some(t=>t.includes('Notes privées de B non enregistrées'))||!reloaded.pending)throw Error('Rechargement fusionne silencieusement ou perd la copie de saisie.')
    await checkedB(`roamConcurrentTest.field('notes','Notes réappliquées explicitement')`)
    await checkedB('roamConcurrentTest.submit(true)');await wait(checkedB,'!document.querySelector("dialog")')
    const retried=await checked('roamConcurrentTest.state()')
    if(retried.activity.title!=='Titre formulaire A'||retried.activity.notes!=='Notes réappliquées explicitement'||retried.documents!==1||retried.operations!==uiBefore.operations+3)throw Error('Réenregistrement ou double clic incorrect.')
    console.log('PASS : formulaires réels, conflit sans journal/document, saisie et fichier conservés, rechargement explicite, double clic et réenregistrement.')
    await checkedB('roamConcurrentTest.openUI()');await wait(checkedB,'roamConcurrentTest.editorState().ready')
    await checkedB(`roamConcurrentTest.field('notes','Saisie après suppression distante')`)
    await checked('roamConcurrentTest.remove()')
    const deletedBefore=await checked('roamConcurrentTest.state()')
    await checkedB('roamConcurrentTest.submit()');await wait(checkedB,'Boolean(roamConcurrentTest.editorState().error)')
    await checkedB('roamConcurrentTest.reload()');await wait(checkedB,'!document.querySelector("dialog").getAttribute("aria-busy") || document.querySelector("dialog").getAttribute("aria-busy")==="false"')
    const deletedAfter=await checked('roamConcurrentTest.state()'),deletedUI=await checkedB('roamConcurrentTest.editorState()')
    if(deletedUI.notes!=='Saisie après suppression distante'||deletedAfter.activity||deletedAfter.operations!==deletedBefore.operations)throw Error('Suppression concurrente perd la saisie, ressuscite ou journalise un échec.')
    console.log('PASS : suppression concurrente, pas de résurrection ni de journal supplémentaire, saisie conservée.')
    await command('Network.enable'); await commandB('Network.enable')
    const offlineNetwork={offline:true,latency:0,downloadThroughput:0,uploadThroughput:0}
    await command('Network.emulateNetworkConditions',offlineNetwork); await commandB('Network.emulateNetworkConditions',offlineNetwork)
    if(await checked('navigator.onLine')!==false||await checkedB('navigator.onLine')!==false)throw Error('Réseau V6 non coupé')
    await checked('roamConcurrentTest.seedV6()'); await checked('roamConcurrentTest.openV6()'); await checkedB('roamConcurrentTest.openV6()')
    const v6Before=await checked('roamConcurrentTest.stateV6()')
    const v6Writes=await Promise.all([checked("roamConcurrentTest.saveV6('A')"),checkedB("roamConcurrentTest.saveV6('B')")])
    const v6After=await checked('roamConcurrentTest.stateV6()')
    if(v6Writes.filter(Boolean).length!==1||v6After.operations!==v6Before.operations+1)throw Error('CAS hébergement V6 incorrect')
    console.log('PASS : hébergement V6 hors réseau, deux onglets réels, une écriture et une opération de journal.')
    await checked('roamConcurrentTest.seedBridge()'); await checkedB('roamConcurrentTest.openBridge()')
    await checked('roamConcurrentTest.touchBridgeHidden()')
    const hiddenBefore=await checked('roamConcurrentTest.bridgeState()')
    if(await checkedB('roamConcurrentTest.saveBridge()'))throw Error('Le formulaire V2 écrase une révision native cachée')
    const hiddenAfter=await checked('roamConcurrentTest.bridgeState()')
    if(hiddenAfter.operations!==hiddenBefore.operations||hiddenAfter.rows[0].reservation.reference!=='NATIVE')throw Error('Conflit V2/native écrit ou perd une réservation')
    await checked('roamConcurrentTest.openBridge()'); await checkedB('roamConcurrentTest.openBridge()')
    const bridgeBefore=await checked('roamConcurrentTest.bridgeState()')
    const bridgeWrites=await Promise.all([checked('roamConcurrentTest.saveBridge()'),checkedB('roamConcurrentTest.deleteBridge()')])
    const bridgeAfter=await checked('roamConcurrentTest.bridgeState()')
    if(bridgeWrites.filter(Boolean).length!==1||bridgeAfter.operations!==bridgeBefore.operations+1)throw Error('Édition/suppression V2 concurrente incohérente')
    console.log('PASS : pont V2/Journey hors réseau, deux onglets réels, conflit sur champ natif invisible et édition/suppression atomique.')
    await checked('roamConcurrentTest.openJourneyUI(true)');await checkedB('roamConcurrentTest.openJourneyUI()')
    await checked("roamConcurrentTest.field('title','Titre autonome A')");await checkedB("roamConcurrentTest.field('notes','Notes autonomes B')")
    await checked('roamConcurrentTest.submit(true)');await wait(checked,'!document.querySelector("dialog")')
    const journeyBefore=await checked('roamConcurrentTest.journeyUIState()')
    await checkedB('roamConcurrentTest.submit()');await wait(checkedB,'Boolean(document.querySelector(".journey-panel [role=alert]"))')
    const journeyAfter=await checkedB('roamConcurrentTest.journeyUIState()')
    if(journeyAfter.row.stops.length!==3||journeyAfter.row.segments[0].durationMinutes!==10||journeyAfter.row.title!=='Titre autonome A'||journeyAfter.notes!=='Notes autonomes B'||journeyAfter.operations!==journeyBefore.operations)throw Error('Conflit du formulaire autonome perd des saisies ou écrit')
    console.log('PASS : formulaires autonomes multi-étapes réels dans deux onglets hors réseau, double clic et conflit sans perte de saisie ni journal.')
    await checked('roamConcurrentTest.openStayUI()');await checkedB('roamConcurrentTest.openStayUI()')
    await checked("roamConcurrentTest.field('title','Hôtel onglet A')");await checkedB("roamConcurrentTest.field('notes','Notes hôtel B')")
    await checked('roamConcurrentTest.submit(true)');await wait(checked,'!document.querySelector("dialog")')
    const stayBefore=await checked('roamConcurrentTest.stayUIState()');await checkedB('roamConcurrentTest.submit()');await wait(checkedB,'Boolean(document.querySelector(".accommodation-form [role=alert]"))')
    const stayAfter=await checkedB('roamConcurrentTest.stayUIState()');if(stayAfter.row.place.name!=='Hôtel onglet A'||stayAfter.notes!=='Notes hôtel B'||stayAfter.operations!==stayBefore.operations)throw Error('Conflit hébergement écrase données/saisie ou journal')
    await checked('roamConcurrentTest.deleteStay()');const stayDeleted=await checked('roamConcurrentTest.stayUIState()');await checkedB('roamConcurrentTest.submit()');await pause(100)
    const stayRetried=await checkedB('roamConcurrentTest.stayUIState()');if(stayRetried.row||stayRetried.operations!==stayDeleted.operations||stayRetried.notes!=='Notes hôtel B')throw Error('Suppression concurrente hébergement ressuscite les données')
    console.log('PASS : formulaires Hébergement réels, deux onglets hors réseau, double clic, révision atomique, saisie conservée et suppression concurrente sans résurrection.')


    await checked('roamConcurrentTest.routingOpen()')
    const routingResults = await Promise.all([checked('roamConcurrentTest.routingCompute()'), checkedB('roamConcurrentTest.routingCompute()')])
    if(routingResults[0].inputKey!==routingResults[1].inputKey||await checked('roamConcurrentTest.routingCalls()')!==1)throw Error('B2 cache inter-onglets duplique le calcul')
    await checkedB('roamConcurrentTest.routingManual()'); const routingBefore=await checked('roamConcurrentTest.journeyUIState()')
    if(await checked('roamConcurrentTest.routingStaleSave()'))throw Error('B2 estimation ecrase duree manuelle concurrente')
    const routingAfter=await checked('roamConcurrentTest.journeyUIState()')
    if(routingAfter.row.segments[0].durationMinutes!==91||routingAfter.operations!==routingBefore.operations)throw Error('B2 duree manuelle ou journal perdu')
    console.log('PASS : B2 fournisseur simule hors reseau, deux onglets reels, un seul calcul ; estimation obsolete refusee, duree manuelle concurrente et journal preserves.')
  } finally {
    await checkedB('roamConcurrentTest.cleanup()');socketB.close();await command('Target.closeTarget',{targetId:created.targetId})
    await checked(`(async()=>{await roamConcurrentTest.cleanup();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(${JSON.stringify(database)});r.onsuccess=resolve;r.onerror=reject})})()`)
    await checked(`new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(${JSON.stringify(database + '-routing')});r.onsuccess=resolve;r.onerror=reject})`)
  }

} finally {
  socket?.close()
  for (const child of children.reverse()) { if (child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch {} } }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { console.log('Profil temporaire de test laissé dans: ' + profile) }
}
