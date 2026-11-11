import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeServer } from './serve.mjs'
import { verifyStage, root, stage } from './prepare.mjs'
const folder=(process.env.ROAM_TEST_PATCH==='places'||process.argv.includes('--places'))?join(root,'node_modules/.tmp/v21f2-place-preview'):stage
export function wifiServer(ip){
 if(!/^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(ip))throw Error('Adresse IPv4 privée requise')
 const origin=`http://${ip}:48622`,server=makeServer(folder,`${ip}:48622`)
 const handler=server.listeners('request')[0];server.removeAllListeners('request')
 server.on('request',(req,res)=>{
  if(req.headers.host===`${ip}:48622`&&['/wifi-test','/wifi-test/'].includes(req.url.split('?')[0])&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
   res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Roam TEST Wi-Fi</title><body><h1>Roam TEST V2.1 — Wi-Fi</h1><p>HTTP : tests d’interface uniquement, sans validation PWA/hors connexion. Ne jamais importer de données personnelles.</p><p id="status">Vérification…</p><button id="init" disabled>Réserver cette origine fictive</button><p><a id="open" href="/" hidden>Ouvrir Roam TEST</a></p><a href="/test-fixtures/roam-test-fiction.zip">Télécharger le ZIP fictif</a><script type="module">
const expected=${JSON.stringify(origin)},key='roam-v21f2-wifi-test',status=document.querySelector('#status'),button=document.querySelector('#init'),link=document.querySelector('#open');
try{if(location.origin!==expected)throw Error('Origine inattendue');const info=await fetch('/preview-info.json').then(r=>r.json());const token=info.baseCandidate+':'+info.previewBuildId;const existing=localStorage.getItem(key);if(existing===token||(info.patch&&(existing===info.previousTestToken||info.previousTestTokens?.includes(existing)))){link.hidden=false;status.textContent='Origine TEST déjà réservée : '+expected+(info.patch?' — '+info.patch:'')}else{if(existing||(await indexedDB.databases()).length)throw Error('Origine déjà utilisée : arrêter sans rien effacer');button.disabled=false;status.textContent='Origine vierge : '+expected+' — '+info.baseCandidate;button.onclick=async()=>{if((await indexedDB.databases()).length)throw Error('Origine devenue occupée');localStorage.setItem(key,token);link.hidden=false;button.disabled=true;status.textContent='TEST réservé. Importer uniquement le ZIP fictif depuis Plus.'}}}catch(error){status.textContent=error.message}
</script></body></html>`);return
  }handler(req,res)
 });return server
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 verifyStage(folder)
 const configurations=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object @{n='ip';e={$_.IPv4Address.IPAddress}},@{n='category';e={[string]$_.NetProfile.NetworkCategory}}) | ConvertTo-Json -Compress"],{encoding:'utf8'}))
 const rows=Array.isArray(configurations)?configurations:[configurations],row=rows.find(item=>item.category==='Private'||item.category==='1')
 if(!row)throw Error('Aucun réseau privé avec passerelle. Vérifier le Wi-Fi de confiance avant de le déclarer Private ; aucune modification automatique.')
 const server=wifiServer(row.ip);server.on('error',error=>{console.error(error.message);process.exitCode=1});server.listen(48622,row.ip,()=>console.log(`http://${row.ip}:48622/wifi-test/ — HTTP/interface uniquement. Ctrl+C pour arrêter. Ne configurer ni redirection routeur ni tunnel.`))
}
