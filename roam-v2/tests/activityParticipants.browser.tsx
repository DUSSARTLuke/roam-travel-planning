import { activityVersion } from '../src/db/activityRevision'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createExpenseSharingRepository } from '../src/db/expenseSharing'
import { validateActivity, type TripActivity } from '../src/db/activityModel'
import { activityIncludesParticipant } from '../src/db/activityParticipants'
import { initialActivityValues, activityFormInput } from '../src/components/program/activityFormModel'
import { buildDayPlanning } from '../src/components/program/dayPlanning'
import { TripProgram } from '../src/components/program/TripProgram'
import { ActivityFormPanel } from '../src/components/program/ActivityFormPanel'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function refused(action: () => unknown | Promise<unknown>) { let failed=false; try { await action() } catch { failed=true } assert(failed,'Invalid participants accepted') }
async function waitFor(test:()=>boolean) { const end=performance.now()+5000; while(!test()&&performance.now()<end) await new Promise(resolve=>setTimeout(resolve,20)); assert(test(),'Participant UI timeout') }
export async function testActivityParticipants(report:(message:string)=>void) {
 const database=new RoamDatabase(`roam-v2-test-participants-${crypto.randomUUID()}`), copies:RoamDatabase[]=[]
 const host=document.createElement('div');host.style.maxWidth='375px';document.body.append(host);const root=createRoot(host)
 const trip:Trip={id:'participants',destination:'Test',country:'Test',startDate:'2028-02-29',endDate:'2028-03-01',travelers:2,image:'',participants:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}]}
 const repo=createActivityRepository(database)
 try {
 await database.trips.put(trip)
 const input={title:'Collective',category:'visit' as const,date:trip.startDate,scheduleType:'exact' as const,startTime:'09:00',endTime:'11:00',period:null}
 const collective=await repo.createActivity(trip.id,input),alice=await repo.createActivity(trip.id,{...input,title:'Alice seule',participantIds:['a']}),bob=await repo.createActivity(trip.id,{...input,title:'Bob seul',startTime:'10:00',participantIds:['b']})
 const pair=(a:TripActivity,b:TripActivity)=>buildDayPlanning([a,b]).conflictCount
 assert(pair(alice,bob)===0,'Disjoint participants overlap')
 assert(pair(alice,{...bob,participantIds:['a']})===2,'Shared overlap missed')
 assert(pair(alice,{...bob,startTime:'09:00',participantIds:['a']})===2,'Shared same start missed')
 assert(pair(alice,{...bob,startTime:'09:00'})===0,'Disjoint same start conflict')
 assert(pair(alice,collective)===2&&pair(collective,{...bob,participantIds:[]})===0,'Collective/empty conflict semantics')
 assert(pair(alice,{...bob,startTime:'11:00',endTime:'12:00',participantIds:['a']})===0,'Adjacent interval conflict')
 assert(activityIncludesParticipant(collective,'b')&&!activityIncludesParticipant(alice,'b'),'Legacy filter semantics')
 assert(initialActivityValues(null,trip.startDate,trip.startDate).participantIds===undefined,'Default must select all')
 const roundtrip=activityFormInput(initialActivityValues(alice,alice.date,trip.startDate),alice)
 assert(roundtrip.participantIds?.[0]==='a','Form loses participants')
 await refused(()=>repo.createActivity(trip.id,{...input,participantIds:['foreign']}))
 for(const ids of [['a','a'],[4],null,'a']) await refused(()=>validateActivity({...input,participantIds:ids} as never))
 const updated=await repo.updateActivity(trip.id,alice.id,{...input,title:'Alice seule'}, activityVersion(await repo.getActivity(trip.id,alice.id)))
 assert(updated.participantIds?.[0]==='a','Partial update loses participants')
 database.close();await database.open();assert((await database.activities.get(collective.id))?.participantIds===undefined,'Legacy activity rewritten')
 report('Participants : défaut collectif, sélection, validation, modification partielle, réouverture ; conflits communs/disjoints/même début/adjacence/collectif/vide.')
 for(const version of [5,6]) {
  const snapshot=await readExportSnapshot({mode:'trip',tripId:trip.id},database)
  const archive=await buildExportArchive({...snapshot,databaseVersion:version,sync:snapshot.sync})
  const prepared=await prepareRestore(archive.blob),copy=new RoamDatabase(`roam-v2-test-participant-zip${version}-${crypto.randomUUID()}`);copies.push(copy)
  await restoreBackup(prepared,await previewRestore(prepared,copy),copy)
  assert((await copy.activities.get(alice.id))?.participantIds?.[0]==='a'&&(await copy.activities.get(collective.id))?.participantIds===undefined,'ZIP loses participants or legacy semantics')
 }
 const bad=await readExportSnapshot({mode:'trip',tripId:trip.id},database);bad.activities[0].participantIds=['foreign'];await refused(()=>buildExportArchive(bad))
 report('ZIP1→V6 et ZIP2 : export/restauration des sélections et des activités historiques ; export orphelin refusé.')
 const render=()=>flushSync(()=>root.render(<TripProgram trip={trip} readActivities={()=>repo.listActivities(trip.id)} readAccommodations={async()=>[]} readJourneys={async()=>[]} />))
 render();await waitFor(()=>host.querySelectorAll('.activity-card').length===3)
 assert(host.textContent?.includes('Participants : Alice'),'Names missing')
 const filter=host.querySelector<HTMLSelectElement>('.program-participant-filter select')!;filter.value='b';filter.dispatchEvent(new Event('change',{bubbles:true}))
 await waitFor(()=>host.querySelectorAll('.activity-card').length===2)
 assert(!Array.from(host.querySelectorAll('.activity-card')).some(card=>card.textContent?.includes('Alice seule')),'Filter leaves other traveler')
 assert(host.scrollWidth<=host.clientWidth+1,'Mobile program overflows')
 const modes=Array.from(host.querySelectorAll<HTMLButtonElement>('.program-mode-switch button'))
 flushSync(()=>modes[1].click());assert(host.querySelectorAll('.activity-card').length===2,'Multi-day ignores participant filter')
 flushSync(()=>modes[0].click());filter.value='';filter.dispatchEvent(new Event('change',{bubbles:true}))
 await waitFor(()=>host.querySelectorAll('.activity-card').length===3)
 filter.value='a';filter.dispatchEvent(new Event('change',{bubbles:true}))
 await waitFor(()=>host.querySelectorAll('.activity-card').length===2)
 assert(!Array.from(host.querySelectorAll('.activity-card')).some(card=>card.textContent?.includes('Bob seul')),'Alice filter leaves Bob')
 const fallback={current:null};flushSync(()=>root.render(<ActivityFormPanel participants={trip.participants} referenceCurrency="EUR" tripId={trip.id} activity={null} initialDate={trip.startDate} fallbackDate={trip.startDate} fallbackFocusRef={fallback} onClose={()=>{}} onSaved={()=>{}} />))
 const boxes=Array.from(host.querySelectorAll<HTMLInputElement>('.activity-participants input'));assert(boxes.length===3&&boxes.every(box=>box.checked),'Default UI not all selected')
 flushSync(()=>boxes[2].click());assert(boxes[1].checked&&!boxes[2].checked,'Individual selection failed')
 for(const label of host.querySelectorAll<HTMLElement>('.activity-participants label')) assert(label.getBoundingClientRect().height>=44,'Mobile touch target too small')
 report('Programme mobile : noms, filtre Tous/voyageur, collectives conservées, absence de débordement, sélection réelle et cibles tactiles ≥44px.')
 const sharing=createExpenseSharingRepository(database)
 await sharing.deleteParticipant(trip.id,'a','Alice')
 assert((await database.activities.get(alice.id))?.participantIds?.length===0,'Deletion turns solo activity collective')
 assert((await database.activities.get(collective.id))?.participantIds===undefined,'Deletion rewrites collective')
 await refused(()=>repo.updateActivity(trip.id,alice.id,{...input,participantIds:['a']}))
 assert((await database.activities.get(bob.id))?.participantIds?.[0]==='b','Deletion affects unrelated participant')
 report('Suppression voyageur : retrait atomique, vide explicite conservé, collectives et autres voyageurs préservés, ancienne saisie refusée.')
 } finally { flushSync(()=>root.unmount());host.remove();database.close();await database.delete();for(const copy of copies){copy.close();await copy.delete()} }
}
