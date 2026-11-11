const expected='http://localhost:48621',marker='roam-v21f2-test-environment',status=document.querySelector('#status'),init=document.querySelector('#init'),open=document.querySelector('#open'),cleanup=document.querySelector('#cleanup')
function show(message){status.textContent=message}
function guard(){if(location.origin!==expected||!isSecureContext)throw Error('Origine non autorisée : aucune écriture ni suppression permise.')}
async function inventory(){return {databases:await indexedDB.databases(),caches:await caches.keys(),workers:await navigator.serviceWorker.getRegistrations()}}
try{
 guard();const info=await fetch('/preview-info.json',{cache:'no-store'}).then(response=>response.json());if(info.origin!==expected)throw Error('Configuration inattendue')
 const data=await inventory(),existing=localStorage.getItem(marker),token=`${info.baseCandidate}:${info.previewBuildId}`
 if(existing===token){open.hidden=false;cleanup.disabled=false;show(`Origine de TEST confirmée : ${location.origin}\nBase : ${info.baseCandidate}\nPréversion : ${info.previewBuildId}`)}
 else if(existing||data.databases.length||data.caches.length||data.workers.length){throw Error('Origine déjà utilisée ou version différente. Ne rien effacer : choisir une origine de test vierge après analyse.')}
 else{init.disabled=false;show(`Origine vierge : ${location.origin}\nLe candidat public et son stockage ne sont pas ouverts.\nBase : ${info.baseCandidate}`)}
 init.onclick=async()=>{try{guard();const latest=await inventory();if(latest.databases.length||latest.caches.length||latest.workers.length)throw Error('Cette origine est devenue occupée ; initialisation refusée.');localStorage.setItem(marker,token);init.disabled=true;open.hidden=false;cleanup.disabled=false;show('Origine réservée aux seules données fictives. Ouvrir Roam TEST, puis importer le ZIP fictif depuis Plus.')}catch(error){show(error.message)}}
 cleanup.onclick=async()=>{try{guard();if(localStorage.getItem(marker)!==token||document.querySelector('#confirmation').value!=='SUPPRIMER TEST')throw Error('Confirmation ou marqueur de test absent. Aucune suppression.');cleanup.disabled=true
  const data=await inventory();if(data.databases.some(db=>db.name!=='roam-v2-db'))throw Error('Base inconnue sur cette origine : nettoyage automatique refusé.')
  if(data.workers.some(worker=>worker.scope!==expected+'/')||data.caches.some(name=>!name.startsWith(`roam-v2-static:${expected}/:`)))throw Error('Scope ou cache inconnu : aucun nettoyage autorisé.')
  for(const worker of data.workers)await worker.unregister()
  for(const name of data.caches)await caches.delete(name)
  await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('roam-v2-db');request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>show('Fermer les autres onglets et fenêtres Roam TEST : suppression en attente, aucune autre origine concernée.')})
  localStorage.removeItem(marker);open.hidden=true;show('Données fictives, worker et caches de cette origine supprimés. Désinstaller uniquement « Roam TEST V2.1 », puis arrêter le serveur et retirer la redirection USB.')
 }catch(error){show(error.message);cleanup.disabled=false}}
}catch(error){show(error.message)}
