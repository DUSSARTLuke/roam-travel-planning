const noStays=async()=>[]
import { projectLegacyTransfers } from '../src/evolution/v21/graph'
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createV21Repository } from '../src/evolution/v21/repository'
import { TripProgram } from '../src/components/program/TripProgram'
import { TripBudget } from '../src/components/budget/TripBudget'
import { buildTripBudget } from '../src/money/tripBudget'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { entityKey } from '../src/sync/model'
import type { Journey } from '../src/evolution/v21/contracts'
function assert(value:unknown,text:string):asserts value {if(!value)throw new Error(text)}
export async function testJourneyInterface(report:(text:string)=>void){
  const name=`roam-v2-test-journey-ui-${crypto.randomUUID()}`,database=new RoamDatabase(name),other=new RoamDatabase(name),target=new RoamDatabase(name+'-restore')
  const repository=createV21Repository(database),remote=createV21Repository(other),activities=createActivityRepository(database)
  const host=document.createElement('div');host.style.cssText='width:100%;max-width:100%;min-width:0';document.body.append(host);const root=createRoot(host)
  const trip:Trip={id:'ui-trip',destination:'Paris',country:'France',startDate:'2026-12-31',endDate:'2027-01-02',travelers:1,image:''}
  const readJourneys=(id:string)=>repository.listJourneys(id)
  function Harness(){const current=useLiveQuery(()=>database.trips.get(trip.id),[]),[budget,setBudget]=useState(false);return current?<><button onClick={()=>setBudget(!budget)}>Changer de test Budget</button>{budget?<TripBudget readAccommodations={noStays} trip={current} readActivities={activities.listActivities} readJourneys={readJourneys}/>:<TripProgram readAccommodations={noStays} trip={current} readActivities={activities.listActivities} readJourneys={readJourneys} journeyRepository={repository}/>}</>:null}
  const wait=async(condition:()=>boolean)=>{const end=performance.now()+10000;while(!condition()&&performance.now()<end)await new Promise(r=>setTimeout(r,20));assert(condition(),'UI déplacement non actualisée : '+host.textContent?.slice(-1300))}
  const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text)!
  const click=(text:string)=>{const b=button(text);assert(b,`Bouton absent : ${text}`);flushSync(()=>b.click())}
  const field=(text:string)=>{const labels=[...host.querySelectorAll('dialog label')];const label=labels.find(l=>l.firstChild?.textContent?.trim()===text)??labels.find(l=>l.firstChild?.textContent?.startsWith(text));const input=label?.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');assert(input,`Champ absent : ${text}`);return input}
  const change=(text:string,value:string)=>{const input=field(text);flushSync(()=>{const proto=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
  const save=()=>click(button('Créer le déplacement')?'Créer le déplacement':'Enregistrer les modifications')
  try{
    await database.trips.add(trip);flushSync(()=>root.render(<Harness/>))
    await wait(()=>!!button('Nouveau déplacement')&&!button('Nouveau déplacement').disabled)
    click('Nouveau déplacement');await wait(()=>!!host.querySelector('#journey-form-title'))
    assert(!field('Point de départ').disabled,'Lieu libre bloqué sans activité')
    change('Lieu de départ','Domicile');change('Lieu d’arrivée','Gare de Paris');change('Heure de départ','23:30');change('Heure d’arrivée','00:30')
    save();await wait(()=>!!host.querySelector('.journey-panel [role=alert]'))
    assert(host.textContent?.includes('lendemain')&&await database.journeys.count()===0,'Trajet de nuit accepté sur une date incohérente')
    change('Date d’arrivée','2027-01-01');change('Coût estimé','10,50');change('Montant payé','0');change('Statut de réservation','confirmed');change('Référence de confirmation','BILLET-TEST');change('Notes','Note de déplacement')
    const file=new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'Billet.png',{type:'image/png'})
    await wait(()=>!!host.querySelector<HTMLInputElement>('input[type=file]')&&!host.querySelector<HTMLInputElement>('input[type=file]')!.disabled)
    flushSync(()=>{const dt=new DataTransfer();dt.items.add(file);const input=host.querySelector<HTMLInputElement>('input[type=file]')!;input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))})
    await wait(()=>host.textContent?.includes('En attente d’enregistrement')===true&&!button('Enregistrement…'))
    const submit=button('Créer le déplacement');flushSync(()=>{submit.click();submit.click()})
    await wait(()=>!!host.querySelector('#journey-detail-title'))
    let row=(await database.journeys.toArray())[0]
    assert(await database.journeys.count()===1&&await database.activities.where('tripId').equals(trip.id).count()===0&&row.paidAmount===0&&row.estimatedCost===10.5,'Création autonome/double clic/montants incorrects')
    assert(row.title==='Domicile → Gare de Paris'&&row.arrival?.date==='2027-01-01'&&row.reservation?.reference==='BILLET-TEST','Titre/nuit/réservation perdus')
    assert(await database.activityDocumentBlobs.count()===1,'Document non enregistré atomiquement')
    const storedDocument=(await database.activityDocuments.toArray())[0],originalPayload=(await database.activityDocumentBlobs.get(storedDocument.id))!
    await database.activityDocumentBlobs.put({id:storedDocument.id,blob:new Blob([new Uint8Array(originalPayload.blob.size)],{type:'text/html'})})
    let corruptRejected=false;try{await repository.getDocument(trip.id,{kind:'journey',id:row.id},storedDocument.id)}catch{corruptRejected=true}
    assert(corruptRejected,'Signature native corrompue acceptée')
    await database.activityDocumentBlobs.put(originalPayload)
    click('Consulter');await wait(()=>Boolean(host.querySelector<HTMLImageElement>('.document-viewer img')?.naturalWidth))
    const viewerClose=[...host.querySelectorAll<HTMLButtonElement>('dialog button')].find(b=>b.getAttribute('aria-label')?.includes('Fermer'))
    if(viewerClose)flushSync(()=>viewerClose.click());else{const dialogs=host.querySelectorAll('dialog');flushSync(()=>dialogs[dialogs.length-1].dispatchEvent(new Event('cancel',{cancelable:true})))}
    await wait(()=>!host.querySelector('.document-viewer'))
    await database.activityDocumentBlobs.delete(storedDocument.id);click('Consulter');await wait(()=>!!host.querySelector('.document-viewer [role="alert"]'))
    flushSync(()=>host.querySelector('.document-viewer')!.dispatchEvent(new Event('cancel',{cancelable:true})));await wait(()=>!host.querySelector('.document-viewer'));await database.activityDocumentBlobs.put(originalPayload)
    click('Supprimer');await wait(()=>!!host.querySelector('#document-delete-title'));click('Annuler');assert(await database.activityDocumentBlobs.count()===1,'Annulation documentaire destructive')
    click('Supprimer');await wait(()=>!!button('Supprimer définitivement'));click('Supprimer définitivement');await wait(()=>!host.querySelector('#document-delete-title'))
    assert(await database.activityDocumentBlobs.count()===0&&await database.journeys.count()===1,'Suppression individuelle touche le trajet ou échoue')
    await repository.importDocuments(trip.id,{kind:'journey',id:row.id},[file]);await wait(()=>host.textContent?.includes('Billet.png')===true)
    await wait(()=>!!button('Modifier le déplacement'));click('Modifier le déplacement');await wait(()=>!!host.querySelector('#journey-form-title'))
    change('Date de départ','2027-01-01');change('Date d’arrivée','2027-01-02');change('Notes','Note conservée après changement de jour');save();await wait(()=>!!host.querySelector('#journey-detail-title'))
    click('Fermer');await wait(()=>!host.querySelector('dialog'))
    assert(host.textContent?.includes('1 janvier 2027'),'Journée non synchronisée après modification')
    const linked=await activities.createActivity(trip.id,{title:'Activité liée',category:'visit',date:'2027-01-01',scheduleType:'unscheduled',period:null,location:'Lieu lié',latitude:0,longitude:0})
    await wait(()=>!!host.querySelector('[aria-label="Consulter le déplacement Domicile → Gare de Paris"]'))
    flushSync(()=>host.querySelector<HTMLButtonElement>('[aria-label="Consulter le déplacement Domicile → Gare de Paris"]')!.click())
    await wait(()=>!!button('Modifier le déplacement'));click('Modifier le déplacement');await wait(()=>!!host.querySelector('#journey-form-title'))
    change('Point de départ',linked.id);assert(!!host.querySelector('[aria-label="Remplacer le lieu saisi ?"]'),'Lieu écrasé sans confirmation')
    click('Continuer la saisie');assert(field('Lieu de départ').value==='Domicile','Annulation remplacement perd le lieu')
    change('Point de départ',linked.id);click('Remplacer le lieu');assert(await database.journeys.count()===1,'Sélection enregistre automatiquement')
    change('Titre','Train de nuit');save();await wait(()=>host.querySelector('#journey-detail-title')?.textContent==='Train de nuit')
    row=(await database.journeys.toArray())[0];assert(row.stops[0].link?.id===linked.id&&row.stops[0].place.latitude===0,'Référence/GPS zéro perdu')
    const budget=buildTripBudget((await database.trips.get(trip.id))!,await activities.listActivities(trip.id),await repository.listJourneys(trip.id))
    assert(budget.totals.status==='calculated'&&budget.totals.estimated.amount===10.5&&budget.totals.paid.amount===0,'Budget natif non compté ou doublé')
    const secondActivity={...linked,id:'second-budget-fixture'}
    const legacyJourney:Journey={...row,id:'legacy-budget-fixture',estimatedCost:3,paidAmount:1,legacy:{kind:'manualTransfer',tripId:trip.id,id:'old-budget-fixture'},stops:row.stops.map((stop,i)=>({...stop,link:{kind:'activity',id:i?secondActivity.id:linked.id,state:'linked'}}))}
    const mixed=buildTripBudget({...trip,manualTransfers:projectLegacyTransfers(trip,[legacyJourney])},[linked,secondActivity],[row,legacyJourney])
    assert(mixed.totals.status==='calculated'&&mixed.totals.estimated.amount===13.5&&mixed.totals.paid.amount===1&&mixed.entries.filter(entry=>entry.kind==='transfer').length===2,'Projection V2 et Journey canonique comptées deux fois')
    const archive=await buildExportArchive(await readExportSnapshot({mode:'trip',tripId:trip.id},database)),prepared=await prepareRestore(archive.blob)
    await restoreBackup(prepared,await previewRestore(prepared,target),target);target.close();await target.open()
    assert((await target.journeys.get(row.id))?.stops[0].link?.id===linked.id&&await target.activityDocumentBlobs.count()===1,'ZIP/réouverture perd relation ou fichier')
    click('Fermer');click('Changer de test Budget');await wait(()=>!!host.querySelector('.trip-budget-page .budget-amount'))
    assert(host.querySelector('.budget-amount')!.textContent?.includes('10,50'),'Budget affiché ignore le déplacement autonome')
    click('Changer de test Budget');await wait(()=>!!host.querySelector('[aria-label^="Jour 2,"]'));flushSync(()=>host.querySelector<HTMLButtonElement>('[aria-label^="Jour 2,"]')!.click())
    await wait(()=>!!host.querySelector('[aria-label="Consulter le déplacement Train de nuit"]'));flushSync(()=>host.querySelector<HTMLButtonElement>('[aria-label="Consulter le déplacement Train de nuit"]')!.click())
    await wait(()=>!!button('Modifier le déplacement'));click('Modifier le déplacement');await wait(()=>!!host.querySelector('#journey-form-title'));change('Titre','Saisie locale')
    const snapshot=await remote.read('journeys',trip.id,row.id);await remote.saveJourney(trip.id,{...snapshot.entity as Journey,notes:'Modifié ailleurs'},snapshot.revision)
    const operations=await database.syncOutbox.count();save();await wait(()=>!!host.querySelector('.journey-panel [role=alert]'))
    assert(field('Titre').value==='Saisie locale'&&await database.syncOutbox.count()===operations,'Conflit perd la saisie ou écrit dans le journal')
    click('Fermer');click('Continuer la saisie');assert(field('Titre').value==='Saisie locale','Abandon implicite')
    flushSync(()=>host.querySelector('dialog')!.dispatchEvent(new Event('cancel',{cancelable:true})));click('Abandonner');await wait(()=>!!host.querySelector('#journey-detail-title'))
    await activities.deleteActivity(trip.id,linked.id);await wait(()=>host.textContent?.includes('Lieu lié supprimé')===true)
    click('Supprimer le déplacement');await wait(()=>!!button('Annuler la suppression'));click('Annuler la suppression')
    assert(await database.journeys.count()===1,'Annulation supprime le trajet')
    for(const width of [320,375]){host.style.width=`${width}px`;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));assert(host.scrollWidth<=host.clientWidth+1,'Liste déborde sur mobile');assert(host.querySelector('dialog')!.getBoundingClientRect().width<=innerWidth+1,'Panneau déborde sur mobile')}
    click('Supprimer le déplacement');await wait(()=>!!button('Confirmer la suppression du déplacement'));click('Confirmer la suppression du déplacement');await wait(()=>!host.querySelector('dialog'))
    assert(await database.journeys.count()===0&&await database.activityDocumentBlobs.count()===0&&(await database.syncEntities.get(entityKey('journeys',row.id)))?.deleted,'Suppression/cascade/tombstone incorrects')
    click('Nouveau déplacement');await wait(()=>!!host.querySelector('#journey-form-title'));change('Lieu de départ','Maison');change('Lieu d’arrivée','Aéroport');save();await wait(()=>!!host.querySelector('#journey-detail-title'))
    const noTime=(await database.journeys.toArray())[0]
    assert(noTime.departure?.time===undefined&&noTime.arrival?.time===undefined&&noTime.estimatedCost===undefined&&noTime.paidAmount===undefined,'Horaires ou montants inventés par le formulaire rapide')
    assert(noTime.stops.every(stop=>stop.place.latitude===undefined&&stop.place.longitude===undefined),'GPS artificiel')
    click('Supprimer le déplacement');await wait(()=>!!button('Confirmer la suppression du déplacement'));click('Confirmer la suppression du déplacement');await wait(()=>!host.querySelector('dialog'))
    flushSync(()=>root.unmount());database.close();await database.open();assert(await database.journeys.count()===0,'Suppression non persistée')
    report('UI déplacements autonomes : lieux libres sans activité, nuit/dates, montant zéro, réservation/document, fiche/édition, confirmation de lieu, liens/GPS, Budget/ZIP2, conflit/saisie, suppression, réouverture et mobile.')
  }finally{try{flushSync(()=>root.unmount())}catch{}host.remove();other.close();await database.delete();await target.delete()}
}
