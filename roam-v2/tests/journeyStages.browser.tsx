import { connection } from '../src/pwa/connection'
import { JourneyProgram } from '../src/components/program/JourneyProgram'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey } from '../src/db/transferModel'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createV21Repository } from '../src/evolution/v21/repository'
import { journeyDraft, draftJourney, reconcileSegments } from '../src/components/program/journeyFormModel'
import { JourneyFormPanel } from '../src/components/program/JourneyFormPanel'
import { TripMap } from '../src/components/map/TripMap'
import { journeyMap } from '../src/maps/journeyMap'
import { createTripMapController, type TripMapPoint } from '../src/maps/tripMapModel'
import type { TripMapLoader } from '../src/maps/tripMapSession'
import type { MapLink } from '../src/maps/tripMapTransfers'
import { buildTripBudget } from '../src/money/tripBudget'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
function assert(value:unknown,text:string):asserts value{if(!value)throw new Error(text)}
export async function testJourneyStages(report:(text:string)=>void){
 const previousOffline=connection.getSnapshot().offline;window.dispatchEvent(new Event('online'))
 let placeRequests=0
 const placeProvider={async search(){placeRequests++;return [{id:'fixture-place',name:'Gare recherchée',address:'1 rue TEST',city:'Paris',country:'France',latitude:0,longitude:-1.23456789}]}}
 const name=`roam-v2-test-stages-${crypto.randomUUID()}`,database=new RoamDatabase(name),target=new RoamDatabase(name+'-restore'),repo=createV21Repository(database)
 const host=document.createElement('div');host.style.cssText='width:100%;min-width:0';document.body.append(host);const trigger=document.createElement('button');host.append(trigger);const root=createRoot(host)
 const trip:Trip={id:'stages',destination:'Paris',country:'France',startDate:'2026-12-31',endDate:'2027-01-02',travelers:1,image:''}
 const wait=async(check:()=>boolean)=>{for(let i=0;i<400&&!check();i++)await new Promise(r=>setTimeout(r,20));assert(check(),'Étapes non actualisées : '+host.textContent?.slice(-700))}
 const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text)!
 const click=(text:string)=>{assert(button(text),'Bouton absent '+text);flushSync(()=>button(text).click())}
 const change=(text:string,value:string)=>{const label=[...host.querySelectorAll('label')].find(l=>l.textContent?.trim()===text||l.firstChild?.textContent?.trim()===text);const input=label?.querySelector<HTMLInputElement|HTMLSelectElement>('input,select');assert(input,'Champ absent '+text);flushSync(()=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
 let saved:import('../src/evolution/v21/contracts').Journey|undefined
 try{
  await database.trips.add(trip)
  const now=new Date().toISOString(),hotel=await repo.saveAccommodation(trip.id,{id:crypto.randomUUID(),tripId:trip.id,place:{name:'Hôtel étapes',latitude:0,longitude:-179},arrivalDate:trip.startDate,departureDate:trip.endDate,createdAt:now,updatedAt:now})
  flushSync(()=>root.render(<JourneyFormPanel placeProvider={placeProvider} trip={trip} activities={[]} accommodations={[hotel]} initialDate={trip.startDate} repository={repo} trigger={trigger} onClose={()=>{}} onSaved={row=>{saved=row}}/>))
  change('Lieu de départ','Maison étapes');change('Lieu d’arrivée','Aéroport étapes')
  click('Ajouter une étape');change('Lieu étape 1','Gare étapes');click('Ajouter une étape');change('Lieu étape 2','Port étapes')
  assert(placeRequests===0,'Recherche déclenchée à l’ouverture')
  const search=async(index:number,keyboard:boolean,replace=true)=>{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    const input=host.querySelectorAll<HTMLInputElement>('[role="combobox"]')[index];assert(input,'Recherche absente sur une étape');input.focus()
    flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Gare TEST');input.dispatchEvent(new Event('input',{bubbles:true}))})
    await wait(()=>!!input.closest('.activity-place-search')?.querySelector('[role="option"]'))
    flushSync(()=>{if(keyboard)input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));else input.closest('.activity-place-search')!.querySelector<HTMLElement>('[role="option"]')!.click()})
    assert(host.textContent?.includes('Remplacer la localisation saisie'),'Lieu manuel écrasé sans confirmation')
    click(replace?'Remplacer la localisation':'Conserver ma saisie');await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
  }
  await search(0,true);await search(1,false);await search(3,true)
  assert(host.querySelectorAll('[role="combobox"]').length===4,'Recherche absente au départ/étapes/arrivée')
  const beforeOffline=placeRequests;flushSync(()=>window.dispatchEvent(new Event('offline')))
  assert([...host.querySelectorAll<HTMLInputElement>('[role="combobox"]')].every(input=>input.disabled)&&host.textContent?.includes('La saisie manuelle reste disponible'),'Repli offline absent')
  change('Lieu étape 2','Port étapes manuel offline');assert(placeRequests===beforeOffline,'Appel réseau offline')
  flushSync(()=>window.dispatchEvent(new Event('online')))
  change('Mode de transport','walk');change('Durée segment 1 (minutes)','12');change('Mode du segment 2','train');change('Durée segment 2 (minutes)','45');change('Mode du segment 3','plane')
  change('Coût estimé','30');change('Montant payé','10');change('Référence de confirmation','NE-PAS-PERDRE')
  click('Créer le déplacement');await wait(()=>!!saved)
  const original=saved!;assert(original.stops[0].place.latitude===0&&original.stops[0].place.longitude===-1.23456789&&original.stops[1].place.address==='1 rue TEST'&&original.stops[3].place.name==='Gare recherchée','Recherche perd nom/adresse/GPS numériques');assert(original.stops.length===4&&original.segments.length===3&&original.segments[1].durationMinutes===45,'Étapes/modes/durées non persistés')
  const draft=journeyDraft(trip,trip.startDate,original);draft.intermediate.reverse();const reordered=draftJourney(trip.id,reconcileSegments(draft),original)
  assert(reordered.stops[1].id===original.stops[2].id&&reordered.stops[2].id===original.stops[1].id&&reordered.segments.every(s=>s.durationMinutes===undefined),'Réordre perd identité ou recycle durée')
  const reversed=reconcileSegments(draft);reversed.intermediate.reverse();const undone=draftJourney(trip.id,reconcileSegments(reversed),original);assert(undone.segments[1].id===original.segments[1].id&&undone.segments[1].durationMinutes===45,'Annuler un réordre perd les données du segment')
  assert(original.segments[1].durationMinutes===45&&reordered.reservation?.reference==='NE-PAS-PERDRE'&&reordered.paidAmount===10,'Mutation ou champs avancés perdus')
  // Reopen the real form with a revision; reorder and remove only after confirmation.
  const baseline=await repo.read('journeys',trip.id,original.id);saved=undefined
  flushSync(()=>root.render(<JourneyFormPanel placeProvider={placeProvider} key="edit" trip={trip} activities={[]} accommodations={[hotel]} initialDate={trip.startDate} baseline={original} version={baseline.revision} repository={repo} trigger={trigger} onClose={()=>{}} onSaved={row=>{saved=row}}/>))
  await search(0,true)
  flushSync(()=>host.querySelector<HTMLButtonElement>('[aria-label="Descendre étape 1"]')!.click())
  click('Supprimer étape 2');click('Continuer la saisie');assert(host.querySelectorAll('.journey-endpoint legend').length>=4,'Suppression non confirmée')
  click('Supprimer étape 2');click('Confirmer la suppression de l’étape')
  change('Référence étape 1',`accommodation:${hotel.id}`);click('Remplacer le lieu')
  await search(1,false,false) // Cancelling search must preserve the accommodation link.
  click('Enregistrer les modifications');await wait(()=>!!saved)
  let row=saved!;assert(row.stops.length===3&&row.stops[1].link?.kind==='accommodation'&&row.stops[1].place.latitude===0&&row.paidAmount===10,'Edition multi/hébergement/finances perdus')
  const snapshot=await repo.read('journeys',trip.id,row.id)
  row=await repo.saveJourney(trip.id,{...row,stops:row.stops.map((stop,i)=>({...stop,place:{...stop.place,...(i===0?{latitude:0,longitude:179}:i===2?{latitude:-1,longitude:179}:{})}}))},snapshot.revision)
  const view=journeyMap([row],trip.id);assert(view.points.length===3&&view.links.length===2&&view.links[0].geometry.type==='MultiLineString'&&view.links[0].geometry.coordinates.length===2,'GPS zéro/négatifs/dateline incorrects')
  const sameGps={...row,stops:row.stops.map(stop=>({...stop,place:{...stop.place,latitude:0,longitude:0}}))};assert(journeyMap([sameGps],trip.id).links.every(link=>link.geometry.type==='Point'),'Même point invente un parcours')
  assert(journeyMap([row],trip.id,'2027-01-02').rows.length===0,'Filtre date ignoré')
  const noGps={...row,stops:row.stops.map((stop,i)=>i===1?{...stop,place:{name:'Sans GPS'}}:stop)}
  assert(journeyMap([noGps],trip.id).links.length===0&&journeyMap([noGps],trip.id).points.length===2,'Liaison inventée à travers étape sans GPS')
  const manual={...row,id:'manual-no-gps',title:'Gatwick → East Croydon',stops:row.stops.slice(0,2).map((stop,i)=>({...stop,place:{name:i?'East Croydon':'Gatwick'}})),segments:row.segments.slice(0,1)}
  const manualMap=journeyMap([manual],trip.id);assert(manualMap.rows.length===1&&manualMap.points.length===0&&manualMap.links.length===0&&manualMap.coverage.get(manual.id)?.displayed===0,'Trajet manuel sans GPS perdu ou coordonnées inventées')
  assert(journeyMap([manual],trip.id,'2027-01-02').rows.length===0,'Filtre de date ignoré pour trajet sans GPS')
  const manualSaved=await repo.saveJourney(trip.id,manual)
  const budget=buildTripBudget(trip,[],[row]);assert(budget.totals.status==='calculated'&&budget.totals.estimated.amount===30&&budget.totals.paid.amount===10&&budget.entries.length===1,'Budget dupliqué par segment')
  const prepared=await prepareRestore((await buildExportArchive(await readExportSnapshot({mode:'full'},database))).blob)
  await restoreBackup(prepared,await previewRestore(prepared,target),target)
  assert(JSON.stringify((await target.journeys.get(row.id))?.stops)===JSON.stringify(row.stops),'ZIP2 étapes altérées')
  flushSync(()=>root.render(<JourneyProgram trip={trip} activities={[]} date={trip.startDate} repository={repo} readJourneys={id=>repo.listJourneys(id)} />))
  await wait(()=>!!host.querySelector('.journey-card button'))
  assert(host.querySelector('.journey-card button')?.textContent?.includes(row.stops.map(stop=>stop.place.name).join(' → ')),'Programme omet ou réordonne les étapes')
  assert(host.scrollWidth<=host.clientWidth+1,'Carte du déplacement déborde dans le Programme mobile')
  let points:readonly TripMapPoint[]=[],links:readonly MapLink[]=[],fits=0,loads=0
  const load:TripMapLoader=async()=>({mountTripMap(container,initial,notify,select,selectLink){loads++;const control=createTripMapController(initial,{markers(next){points=next;container.replaceChildren(...next.map(point=>{const b=document.createElement('button');b.textContent=point.title;b.onclick=()=>select?.([point.id]);return b}))},fit(){fits++;notify({phase:'ready',interactive:true,message:'Simulation carte prête'})},dispose(){container.replaceChildren()}});return {...control,transfers(next){links=next;const b=document.createElement('button');b.textContent='Liaison simulée';b.onclick=()=>selectLink?.(next.length?[next[0].transfer.id]:[]);container.append(b)}}}})
  const readJourneys=(id:string)=>repo.listJourneys(id),readAccommodations=(id:string)=>repo.listAccommodations(id),readActivities=async()=>[]
  flushSync(()=>root.render(<TripMap trip={trip} repository={repo} readJourneys={readJourneys} readAccommodations={readAccommodations} readActivities={readActivities} load={load}/>))
  await wait(()=>points.length===4&&links.length===2)
  assert(host.textContent?.includes('aucun point ne possède de coordonnées GPS affichables')&&button(manualSaved.title),'Diagnostic sans GPS ou accès fiche absent')
  assert(fits===1&&points.some(p=>p.kind==='accommodation')&&host.textContent?.includes('aucun itinéraire réel'),'Carte native/hôtel/avertissement absent')
  flushSync(()=>[...host.querySelectorAll<HTMLButtonElement>('.trip-map-canvas button')].find(b=>b.textContent?.includes('Gare recherchée'))!.click())
  await wait(()=>!!button(`Voir le déplacement ${row.title}`));click(`Voir le déplacement ${row.title}`);await wait(()=>!!host.querySelector('#journey-detail-title'))
  assert(host.querySelectorAll('.journey-segments li').length===2,'Détail omet les segments')
  click('Fermer');assert(fits===1&&loads===1,'Retour détail recentre/remonte carte')
  const toggle=[...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0];flushSync(()=>toggle.click());await wait(()=>links.length===0&&points.length===1)
  assert(fits===1,'Masquage recentre automatiquement');flushSync(()=>toggle.click());await wait(()=>links.length===2)
  assert(host.scrollWidth<=host.clientWidth+1,'Carte étapes déborde sur mobile')
  flushSync(()=>window.dispatchEvent(new Event('offline')));await wait(()=>host.textContent?.includes('hors connexion')===true);assert(host.textContent?.includes(row.title)&&host.textContent?.includes('Hôtel étapes'),'Liste locale perdue offline');flushSync(()=>window.dispatchEvent(new Event('online')))
  const activitiesRepo=createActivityRepository(database),bridge=createTransferRepository(database)
  const activityA=await activitiesRepo.createActivity(trip.id,{title:'Ancien départ',category:'visit',date:trip.startDate,scheduleType:'unscheduled',period:null}),activityB=await activitiesRepo.createActivity(trip.id,{title:'Ancienne arrivée',category:'visit',date:trip.startDate,scheduleType:'unscheduled',period:null})
  const legacy=await bridge.saveTransfer(trip.id,{fromActivityId:activityA.id,toActivityId:activityB.id,mode:'train',currency:'EUR',estimatedCost:5,paidAmount:0})
  assert(legacy&&JSON.stringify(await database.journeys.get(row.id))===JSON.stringify(row),'Création ancien transfert écrase un déplacement autonome')
  const migrated=(await repo.listJourneys(trip.id)).find(j=>j.legacy?.id===legacy.id)!,migrationVersion=await repo.read('journeys',trip.id,migrated.id)
  const multiDraft=journeyDraft(trip,trip.startDate,migrated);multiDraft.intermediate=[{id:crypto.randomUUID(),kind:'station',reference:'',place:{name:'Correspondance'}}]
  const multi=await repo.saveJourney(trip.id,draftJourney(trip.id,reconcileSegments(multiDraft),migrated),migrationVersion.revision)
  const operations=await database.syncOutbox.count();let stale=false;try{await bridge.saveTransfer(trip.id,{...legacy,notes:'Obsolète'},legacy.id,transferKey(legacy))}catch{stale=true}
  assert(stale&&await database.syncOutbox.count()===operations&&(await database.journeys.get(multi.id))?.stops.length===3,'Ancien formulaire écrase le trajet multi-étapes')
  const version=await repo.read('journeys',trip.id,multi.id);await repo.remove('journeys',trip.id,multi.id,version.revision)
  stale=false;try{await bridge.saveTransfer(trip.id,legacy,legacy.id,transferKey(legacy))}catch{stale=true}assert(stale&&!await database.journeys.get(multi.id),'Projection ressuscite un déplacement supprimé')
  await database.close();await database.open();assert((await database.journeys.get(row.id))?.stops.length===3,'Réouverture perd étapes')
  report('Multi-étapes : UI ajout/réordre/suppression confirmée, IDs/modes/durées, hébergement, montants/réservation, ZIP2, GPS zéro/négatifs/±180 et manquants, carte/détail/caméra/filtres, offline et mobile.')
 }finally{window.dispatchEvent(new Event(previousOffline?'offline':'online'));flushSync(()=>root.unmount());host.remove();database.close();target.close();await database.delete();await target.delete()}
}
