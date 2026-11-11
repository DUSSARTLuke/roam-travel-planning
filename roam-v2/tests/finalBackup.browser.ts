import type { EntityState } from '../src/sync/model'
import { buildTripBudget } from '../src/money/tripBudget'
import Dexie from 'dexie'
import { generateFiction } from '../docs/physical-tests/seed-fixture'
import { RoamDatabase } from '../src/db/database'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { sha256 } from '../src/backup/sha256'
import { createV21Repository } from '../src/evolution/v21/repository'
import { entityKey } from '../src/sync/model'
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)}
const stable=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
async function fingerprint(db:RoamDatabase){const result:Record<string,unknown>={};for(const table of db.tables){const rows=await table.toArray();result[table.name]=table.name==='activityDocumentBlobs'?await Promise.all(rows.map(async row=>({id:row.id,sha256:await sha256(row.blob)}))):rows}return stable(result)}
async function refused(action:()=>Promise<unknown>){let failed=false;try{await action()}catch{failed=true}assert(failed,'Une opération invalide a réussi')}
export async function testFinalBackup(report:(message:string)=>void){
 const fixture=await generateFiction(),archive=new Blob([Uint8Array.from(atob(fixture.base64),c=>c.charCodeAt(0))]),checked=await validateRestoreArchive(archive),prepared=await prepareRestore(archive)
 const name=`roam-v2-test-final-backup-${crypto.randomUUID()}`,target=new RoamDatabase(name),interrupted=new RoamDatabase(name+'-interrupted'),deletedCopy=new RoamDatabase(name+'-deleted'),repo=createV21Repository(target)
 try{
  await restoreBackup(prepared,await previewRestore(prepared,target),target);target.close();await target.open()
  for(const table of ['activities','journeys','accommodations'] as const){const expected=checked[table];const actual=await target.table(table).toArray();assert(actual.length===expected.length,`${table}: nombre différent`);for(const row of expected)assert(stable(actual.find(item=>item.id===row.id))===stable(row),`${table}: données/relations/GPS/dates/montants altérés`)}
  const trip=await target.trips.get(fixture.summary.tripId);const cleanTrip=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='manualTransfers'));assert(stable(cleanTrip(trip! as unknown as Record<string,unknown>))===stable(cleanTrip(checked.trips[0] as unknown as Record<string,unknown>)),'Voyage/devise/budget/dates/participants altérés');assert(trip?.expenseShares?.length===1&&trip.participants?.length===2,'Participants/partages perdus')
  assert(stable(buildTripBudget(trip!,await target.activities.toArray(),await target.journeys.toArray(),await target.accommodations.toArray()))===stable(buildTripBudget(checked.trips[0],checked.activities,checked.journeys,checked.accommodations)),'Budget/taux/paiements/exclusions modifiés par restauration')
  const documentRows=await target.activityDocuments.toArray();assert(documentRows.length===3,'Documents dupliqués/perdus')
  for(const document of checked.documents){assert(stable(documentRows.find(row=>row.id===document.id))===stable(document),'Propriétaire ou métadonnées documentaire altérés');const source=checked.payloads.find(row=>row.id===document.id)!,restored=await target.activityDocumentBlobs.get(document.id);assert(restored&&await sha256(restored.blob)===await sha256(source.blob),'Octets documentaires altérés')}
  const before=await fingerprint(target),repeat=await restoreBackup(prepared,await previewRestore(prepared,target),target);assert(repeat.importedTrips===0&&await fingerprint(target)===before,'Import répété écrit ou duplique des données')
  report('ZIP2 final : voyage fictif complet, cinq activités, deux déplacements dont multi-étapes/nuit, trois hébergements, réservations/paiements/partages, GPS/dates/références exacts, trois documents SHA-256, réouverture et répétition sans écriture.')
  await interrupted.trips.add({...checked.trips[0],id:'sentinel-isolated',expenseShares:undefined,manualTransfers:undefined})
  const pristine=await fingerprint(interrupted),preview=await previewRestore(prepared,interrupted)
  const abort=()=>{Dexie.currentTransaction?.abort();throw Error('Interruption simulée au stockage binaire')}
  interrupted.activityDocumentBlobs.hook('creating',abort)
  try{await refused(()=>restoreBackup(prepared,preview,interrupted))}finally{interrupted.activityDocumentBlobs.hook('creating').unsubscribe(abort)}
  assert(await fingerprint(interrupted)===pristine,'Interruption laisse des entités/journal/Blob partiels ou touche la sentinelle')
  await restoreBackup(prepared,await previewRestore(prepared,interrupted),interrupted);assert(await interrupted.accommodations.count()===3,'Relance après interruption impossible')
  const corrupt=new Uint8Array(await archive.arrayBuffer());corrupt[80]^=1;const prior=await fingerprint(target);await refused(()=>prepareRestore(new Blob([corrupt])));assert(await fingerprint(target)===prior,'Corruption modifie la cible')
  report('ZIP2 final : interruption transactionnelle sur Blob, rollback de toutes les tables/journal avec sentinelle préservée, nouvelle tentative réussie et corruption refusée.')
  const stay=checked.accommodations.find(row=>row.reservation?.reference==='TEST-HOTEL')!,journey=checked.journeys.find(row=>row.stops.some(stop=>stop.link?.id===stay.id))!
  const version=await repo.read('accommodations',stay.tripId,stay.id);await repo.remove('accommodations',stay.tripId,stay.id,version.revision)
  assert(!await target.accommodations.get(stay.id)&&(await target.syncEntities.get(entityKey('accommodations',stay.id)))?.deleted,'Hébergement supprimé sans tombstone')
  const retained=await target.journeys.get(journey.id);assert(retained?.stops.some(stop=>stop.link?.id===stay.id&&stop.link.state==='deleted'&&stop.place.name===stay.place.name),'Suppression perd le dernier lieu connu/référence')
  assert(await target.activityDocumentBlobs.count()===2,'Cascade hôtel touche des documents non concernés ou laisse un Blob')
  const afterDelete=await fingerprint(target);await restoreBackup(prepared,await previewRestore(prepared,target),target);assert(await fingerprint(target)===afterDelete,'Ancien ZIP ressuscite un hébergement supprimé')
  const jVersion=await repo.read('journeys',journey.tripId,journey.id);await repo.remove('journeys',journey.tripId,journey.id,jVersion.revision)
  assert(await target.activityDocumentBlobs.count()===1,'Cascade trajet touche le document activité ou laisse un Blob')
  const fresh=await buildExportArchive(await readExportSnapshot({mode:'trip',tripId:stay.tripId},target)),withDeleted=await prepareRestore(fresh.blob)
  await restoreBackup(withDeleted,await previewRestore(withDeleted,deletedCopy),deletedCopy)
  assert(!await deletedCopy.accommodations.get(stay.id)&&!await deletedCopy.journeys.get(journey.id)&&(await deletedCopy.syncEntities.get(entityKey('journeys',journey.id)))?.deleted,'Tombstone perdu après export/restauration')
  const deletedBefore=await fingerprint(deletedCopy);await restoreBackup(withDeleted,await previewRestore(withDeleted,deletedCopy),deletedCopy);assert(await fingerprint(deletedCopy)===deletedBefore,'Réimport avec tombstones ajoute des écritures')
  for(const version of [4,5]){
   const legacy=new RoamDatabase(name+'-zip1-'+version)
   try{
    const oldTrip={...checked.trips[0],id:'legacy-'+version,expenseShares:undefined,manualTransfers:undefined}
    const oldActivities=checked.activities.slice(0,2).map(row=>({...row,tripId:oldTrip.id}))
    const activityDoc=checked.documents.find(doc=>doc.owner?.kind==='activity')!,oldDocuments=[{...activityDoc,activityId:oldActivities[0].id,owner:undefined,tripId:undefined}]
    const state=(table:EntityState['table'],entityId:string,activityId?:string):EntityState=>({key:entityKey(table,entityId),table,entityId,identity:crypto.randomUUID(),revision:1,serverRevision:null,deleted:false,updatedAt:new Date().toISOString(),tripId:oldTrip.id,...(activityId?{activityId}:{})})
    const legacySync=[state('trips',oldTrip.id),...oldActivities.map(row=>state('activities',row.id)),state('activityDocuments',activityDoc.id,oldActivities[0].id),state('activityDocumentBlobs',activityDoc.id,oldActivities[0].id)]
    const oldArchive=await buildExportArchive({scope:{mode:'trip',tripId:oldTrip.id},snapshotAt:new Date().toISOString(),databaseVersion:version,trips:[oldTrip],activities:oldActivities,documents:oldDocuments,payloads:checked.payloads.filter(row=>row.id===activityDoc.id),metadata:[],journeys:[],accommodations:[],...(version===5?{sync:legacySync}:{})} as Parameters<typeof buildExportArchive>[0])
    assert(oldArchive.manifest.formatVersion===1,'Ancienne sauvegarde pas ZIP1')
    const oldPrepared=await prepareRestore(oldArchive.blob);await restoreBackup(oldPrepared,await previewRestore(oldPrepared,legacy),legacy)
    assert(stable(await legacy.activities.get(oldActivities[0].id))===stable(oldActivities[0])&&await legacy.activityDocumentBlobs.count()===1&&await legacy.journeys.count()===0&&await legacy.accommodations.count()===0,'Compatibilité ZIP1 perd données ou invente entités V6')
    assert(await sha256((await legacy.activityDocumentBlobs.get(activityDoc.id))!.blob)===await sha256(checked.payloads.find(row=>row.id===activityDoc.id)!.blob),'ZIP1 binaire altéré')
   }finally{legacy.close();await legacy.delete()}
  }
  report('ZIP1 final : archives schémas V4 et V5 réellement construites puis importées en V6, coordonnées/montants historiques et fichier binaire préservés, aucune entité native inventée.')
  report('ZIP2 final : suppressions hôtel/trajet, cascades documentaires ciblées, dernier lieu connu, tombstones exportés/restaurés et ancienne archive sans résurrection ni journal supplémentaire.')
 }finally{for(const db of [target,interrupted,deletedCopy]){db.close();await db.delete()}}
}
