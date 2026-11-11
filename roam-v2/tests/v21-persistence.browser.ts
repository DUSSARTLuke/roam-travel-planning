import { createExpenseSharingRepository } from '../src/db/expenseSharing'
import { sharingVersion } from '../src/money/expenseSharing'
import { v6FinancialTotals, v6ExpenseSharing } from '../src/evolution/v21/financial'
import Dexie from 'dexie'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { seedLocalJournal } from '../src/sync/journal'
import { createV21Repository } from '../src/evolution/v21/repository'
import { createActivityRepository } from '../src/db/activities'
import { entityKey } from '../src/sync/model'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { sha256 } from '../src/backup/sha256'
import { timedFixture } from './dayPlanning.core'
import type { Accommodation, Journey } from '../src/evolution/v21/contracts'
const stamp = '2026-11-10T12:00:00.000Z'
function assert(value: unknown, text: string): asserts value { if (!value) throw new Error(text) }
async function rejects(action: () => Promise<unknown>) { try { await action() } catch { return }; throw new Error('Opération invalide acceptée') }
export async function testV21Persistence(report: (text: string) => void) {
  const name = `roam-v2-test-v6-${crypto.randomUUID()}`
  const old = new Dexie(name)
  old.version(5).stores({ trips: 'id,destination,startDate,endDate', metadata: 'key', activities: 'id,tripId,[tripId+date]', activityDocuments: 'id,activityId', activityDocumentBlobs: 'id', syncMeta: 'key', syncEntities: 'key,[table+entityId],identity,tripId,activityId', syncOutbox: 'id,groupId,entityKey,[entityKey+revision],status', syncCommands: 'id', syncConflicts: 'id,entityKey,status' })
  const trip: Trip = { id: 'trip', destination: 'Paris', country: 'France', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '', manualTransfers: [{ id: 'legacy', fromActivityId: 'a', toActivityId: 'b', mode: 'train', durationMinutes: 30, estimatedCost: 20, paidAmount: 7, currency: 'EUR', notes: 'Billet conservé', createdAt: stamp, updatedAt: stamp }] }
  const activities = Array.from({length: 300}, (_,i) => ({ ...timedFixture(i === 0 ? 'a' : i === 1 ? 'b' : `a${i}`, '10:00','11:00'), tripId: trip.id, location: `Lieu ${i}`, latitude: 0, longitude: -1, reservationStatus: 'confirmed' as const }))
  const bytes = new Uint8Array(1024*1024); bytes.set(new TextEncoder().encode('%PDF-1.7\nfixture-v6'))
  const blob = new Blob([bytes], {type:'application/pdf'})
  await old.table('trips').add(trip); await old.table('metadata').add({key:'initialization',initialized:true})
  await old.table('activities').bulkAdd(activities)
  await old.table('activityDocuments').add({id:'d',activityId:'a',name:'Ticket.pdf',mime:blob.type,size:blob.size,importedAt:stamp})
  await old.table('activityDocumentBlobs').add({id:'d',blob})
  await old.transaction('rw', old.tables, () => seedLocalJournal(Dexie.currentTransaction!))
  const goneKey = entityKey('activities','gone'), goneIdentity = crypto.randomUUID()
  await old.table('syncEntities').add({key:goneKey,table:'activities',entityId:'gone',tripId:'trip',identity:goneIdentity,revision:3,serverRevision:null,deleted:true,updatedAt:stamp})
  await old.table('syncOutbox').add({id:'historic-delete',groupId:'historic-delete',installationId:(await old.table('syncMeta').get('installation')).installationId,entityKey:goneKey,identity:goneIdentity,revision:3,previousRevision:2,kind:'delete',status:'pending',createdAt:stamp})
  const receipts = await old.table('syncOutbox').toArray(), identity = await old.table('syncEntities').get(entityKey('activities','a'))
  old.close()
  const database = new RoamDatabase(name), other = new RoamDatabase(name), target = new RoamDatabase(name+'-target')
  try {
    await database.open(); await other.open()
    assert(database.verno === 6 && await database.activities.count() === 300, 'Migration V6 perd des activités')
    const routes = await database.journeys.toArray(); assert(routes.length === 1 && routes[0].legacy?.id === 'legacy' && routes[0].paidAmount === 7, 'Transfert perdu ou dupliqué')
    assert(routes[0].stops[0].place.latitude === 0 && routes[0].stops[0].place.name === 'Lieu 0', 'Lieu/GPS perdu')
    assert((await database.activityDocuments.get('d'))?.owner?.id === 'a' && await sha256((await database.activityDocumentBlobs.get('d'))!.blob) === await sha256(blob), 'Document altéré')
    assert((await database.syncEntities.get(identity.key))?.identity === identity.identity, 'Identité existante remplacée')
    for (const receipt of receipts) { const current = await database.syncOutbox.get(receipt.id); assert(current?.status === 'superseded' && JSON.stringify(current.payload) === JSON.stringify(receipt.payload), 'Historique V5 perdu/rejouable') }
    assert((await database.syncOutbox.where('status').equals('pending').toArray()).every(op => op.protocolVersion === 2 && !(op.entityKey === entityKey('trips','trip') && (op.payload as Trip)?.manualTransfers)), 'Rejeu V5 possible')
    assert((await database.syncEntities.get(goneKey))?.deleted && (await database.syncOutbox.where('entityKey').equals(goneKey).toArray()).some(op => op.status==='pending' && op.kind==='delete' && op.protocolVersion===2),'Tombstone V5 non réémis en V6')
    const count = await database.syncOutbox.count(); database.close(); await database.open(); assert(await database.syncOutbox.count() === count, 'Upgrade rejoué')
    const repository = createV21Repository(database), concurrent = createV21Repository(other)
    const first = await repository.read('journeys','trip',routes[0].id)
    const writes = await Promise.allSettled([
      repository.saveJourney('trip',{...first.entity as Journey,title:'A'},first.revision),
      concurrent.saveJourney('trip',{...first.entity as Journey,title:'B'},first.revision),
    ])
    assert(writes.filter(r=>r.status==='fulfilled').length===1, 'Écriture obsolète acceptée')
    const before = await database.syncOutbox.count()
    await rejects(()=>repository.saveJourney('trip',{...first.entity as Journey,title:'Obsolète'},first.revision))
    assert(await database.syncOutbox.count()===before,'Conflit écrit dans le journal')
    const stay: Accommodation = { id:'hotel',tripId:'trip',place:{name:'Hôtel',latitude:0,longitude:0},arrivalDate:'2026-12-31',departureDate:'2027-01-02',checkInTime:'15:00',reservation:{status:'confirmed',reference:'REF'},estimatedCost:100,paidAmount:0,currency:'EUR',createdAt:stamp,updatedAt:stamp }
    const beforeAtomic = await database.syncOutbox.count()
    const failBlob = () => { throw new Error('QuotaExceededError simulée') }
    database.activityDocumentBlobs.hook('creating', failBlob)
    await rejects(() => repository.saveWithDocuments('accommodations','trip',{...stay,id:'rollback'},[new File([blob],'Fail.pdf',{type:blob.type})]))
    database.activityDocumentBlobs.hook('creating').unsubscribe(failBlob)
    assert(!await database.accommodations.get('rollback') && await database.syncOutbox.count() === beforeAtomic, 'Sauvegarde entité/document partielle')
    await repository.saveAccommodation('trip',stay)
    const migratedCurrent = await repository.read('journeys','trip',routes[0].id)
    const threeSteps = migratedCurrent.entity as Journey
    await repository.saveJourney('trip',{...threeSteps,stops:[...threeSteps.stops,{id:'extra',kind:'free',place:{name:'Étape libre'}}],segments:[...threeSteps.segments,{id:'extra-segment',fromStopId:threeSteps.stops[1].id,toStopId:'extra',mode:'walk'}]},migratedCurrent.revision)
    assert((await database.journeys.get(routes[0].id))?.stops.length===3,'Projection efface le trajet passé à trois étapes')
    const native: Journey = { id:'native',tripId:'trip',currency:'EUR',title:'Domicile → Hôtel',stops:[{id:'s1',kind:'home',place:{name:'Domicile'}},{id:'s2',kind:'accommodation',place:stay.place,link:{kind:'accommodation',id:stay.id,state:'linked'}}],segments:[{id:'g1',fromStopId:'s1',toStopId:'s2',mode:'taxi'}],createdAt:stamp,updatedAt:stamp }
    await repository.saveJourney('trip',native)
    await repository.importDocuments('trip',{kind:'accommodation',id:'hotel'},[new File([blob],'Hotel.pdf',{type:blob.type})])
    const file = (await repository.listDocuments('trip',{kind:'accommodation',id:'hotel'}))[0]
    assert(await sha256((await repository.getDocument('trip',{kind:'accommodation',id:'hotel'},file.id)).blob)===await sha256(blob),'Fichier hébergement altéré')
    await rejects(()=>repository.getDocument('trip',{kind:'journey',id:'native'},file.id))
    const financial = v6FinancialTotals(trip, [], await repository.listJourneys('trip'), await repository.listAccommodations('trip'))
    assert(financial.status === 'calculated' && financial.estimated.amount === 120 && financial.paid.amount === 7, 'Budget canonique double compte ou perd un paiement')
    const sharing = createExpenseSharingRepository(database), person = await sharing.saveParticipant('trip','Personne test')
    const sharesInput = {payerId:person.id,shares:[{participantId:person.id,weight:1}]}
    await sharing.saveShare('trip',{kind:'accommodation',expenseId:'hotel'},{...sharesInput,amount:50},sharingVersion(stay,undefined))
    await sharing.saveShare('trip',{kind:'journey',expenseId:'native'},{...sharesInput,amount:12},sharingVersion(native,undefined))
    const migratedJourney=(await database.journeys.get(routes[0].id))!
    await sharing.saveShare('trip',{kind:'journey',expenseId:migratedJourney.id},{...sharesInput,amount:7},sharingVersion(migratedJourney,undefined))
    const nativeConflictCount=await database.syncOutbox.count()
    await rejects(()=>sharing.saveShare('trip',{kind:'accommodation',expenseId:'hotel'},{...sharesInput,amount:60},sharingVersion(stay,undefined)))
    assert(await database.syncOutbox.count()===nativeConflictCount && (await database.accommodations.get('hotel'))!.paidAmount===50,'Partage natif obsolète accepté')
    const beforeFailure=(await database.journeys.get('native'))!, existingShare=(await database.trips.get('trip'))!.expenseShares!.find(s=>s.kind==='journey'&&s.expenseId==='native')
    const failShare=()=>{throw new Error('Échec partage natif simulé')}
    database.trips.hook('updating',failShare)
    try { await rejects(()=>sharing.saveShare('trip',{kind:'journey',expenseId:'native'},{...sharesInput,amount:13},sharingVersion(beforeFailure,existingShare))) } finally { database.trips.hook('updating').unsubscribe(failShare) }
    assert(await database.syncOutbox.count()===nativeConflictCount && (await database.journeys.get('native'))!.paidAmount===12,'Paiement natif partiel après rollback du partage')
    const paidTrip=(await database.trips.get('trip'))!
    const paidTotals=v6FinancialTotals(paidTrip,[],await repository.listJourneys('trip'),await repository.listAccommodations('trip'))
    assert(paidTotals.status==='calculated' && paidTotals.paid.amount===69,'Paiements natifs perdus ou doublés')
    const distribution=v6ExpenseSharing(paidTrip,await database.activities.toArray(),await repository.listJourneys('trip'),await repository.listAccommodations('trip'))
    assert(distribution.status==='calculated' && distribution.included===3,'Partages natifs non calculés')
    assert((await database.accommodations.get('hotel'))?.reservation?.reference==='REF','Paiement remplace la réservation')
    const invalidAlias=await readExportSnapshot({mode:'full'},database)
    invalidAlias.trips.find(t=>t.id==='trip')!.expenseShares!.push({...paidTrip.expenseShares!.find(s=>s.kind==='journey'&&s.expenseId===migratedJourney.id)!,kind:'transfer',expenseId:'legacy'})
    await rejects(()=>buildExportArchive(invalidAlias))
    const zip = await buildExportArchive(await readExportSnapshot({mode:'full'},database))
    assert(zip.manifest.formatVersion===2 && zip.manifest.databaseVersion===6,'Export pas ZIP2')
    const checked = await validateRestoreArchive(zip.blob); assert(checked.trips.find(t=>t.id==='trip')?.expenseShares?.length===3 && checked.journeys.length===2 && checked.accommodations.length===1,'Collections ZIP2 perdues')
    const prepared=await prepareRestore(zip.blob), preview=await previewRestore(prepared,target)
    const interrupted = new RoamDatabase(name+'-interrupted')
    try {
      const confirmation = await previewRestore(prepared, interrupted)
      const fail = () => { throw new Error('Import interrompu simulé') }
      interrupted.journeys.hook('creating',fail)
      await rejects(() => restoreBackup(prepared,confirmation,interrupted))
      interrupted.journeys.hook('creating').unsubscribe(fail)
      assert(!await interrupted.trips.get('trip') && !await interrupted.syncEntities.get(entityKey('trips','trip')) && await interrupted.activityDocumentBlobs.count()===0,'Restauration partielle après interruption')
    } finally { await interrupted.delete() }
    await restoreBackup(prepared,preview,target)
    target.close(); await target.open()
    assert((await target.accommodations.get('hotel'))?.paidAmount===50 && (await target.accommodations.get('hotel'))?.reservation?.reference==='REF' && (await target.trips.get('trip'))?.expenseShares?.length===3,'Hébergement/réservation/partages perdus à la réouverture')
    assert(await target.activityDocumentBlobs.count()===await database.activityDocumentBlobs.count(),'Blob dupliqué par restauration')
    assert(await target.journeys.count()===2 && await target.accommodations.count()===1,'Restauration ZIP2 incomplète')
    assert(await sha256((await target.activityDocumentBlobs.get(file.id))!.blob)===await sha256(blob),'Binaire restauré altéré')
    const skipped=await previewRestore(prepared,target); assert(skipped.importing.length===0,'Conflit voyage non ignoré')
    const damaged = new Uint8Array(await zip.blob.arrayBuffer()); damaged[80]^=1
    await rejects(()=>validateRestoreArchive(new Blob([damaged])))
    const activityRepo=createActivityRepository(database)
    await activityRepo.deleteActivity('trip','a',JSON.stringify(await database.activities.get('a')))
    assert((await database.journeys.get(routes[0].id))?.stops[0].link?.state==='deleted','Suppression activité détruit son trajet')
    const latestStay=await repository.read('accommodations','trip','hotel')
    await repository.remove('accommodations','trip','hotel',latestStay.revision)
    assert((await database.journeys.get('native'))?.stops[1].link?.state==='deleted' && !await database.activityDocumentBlobs.get(file.id),'Cascade hébergement invalide')
    assert(!(await database.trips.get('trip'))!.expenseShares!.some(s=>s.kind==='accommodation'),'Partage hébergement orphelin après suppression')
    const trash=await database.trips.get('trip'); await updateTripTrash('trip','trash',undefined,database)
    const deletedAt=(await database.trips.get('trip'))!.deletedAt
    await updateTripTrash('trip','delete',deletedAt,database)
    assert(await database.journeys.count()===0 && await database.accommodations.count()===0 && await database.activityDocumentBlobs.count()===0,'Cascade voyage V6 incomplète')
    assert(trash !== undefined,'Fixture absente')
    report('V6 : migration 300 activités, document 1 Mio intact, historique V5 gelé, réouverture, CAS deux connexions, lieux autonomes/hôtel, documents isolés, ZIP2/corruption/conflits et cascades non destructives.')
  } finally { other.close(); await database.delete(); await target.delete() }
}

export async function testV6RollbackAndEmpty(report: (text: string) => void) {
  const schema = { trips:'id',metadata:'key',activities:'id,tripId,[tripId+date]',activityDocuments:'id,activityId',activityDocumentBlobs:'id',syncMeta:'key',syncEntities:'key,[table+entityId],identity,tripId,activityId',syncOutbox:'id,groupId,entityKey,[entityKey+revision],status',syncCommands:'id',syncConflicts:'id,entityKey,status' }
  for (const corrupt of [false,true]) {
    const name = `roam-v2-test-v6-upgrade-${crypto.randomUUID()}`, old = new Dexie(name)
    old.version(5).stores(schema)
    await old.table('metadata').add({key:'initialization',initialized:true})
    if (corrupt) {
      await old.table('activityDocuments').add({id:'orphan',activityId:'missing',name:'Orphan.pdf',mime:'application/pdf',size:8,importedAt:stamp})
      await old.table('activityDocumentBlobs').add({id:'orphan',blob:new Blob(['%PDF-1.7'])})
    }
    old.close()
    const next = new RoamDatabase(name)
    try {
      if (corrupt) {
        await rejects(()=>next.open()); next.close()
        await old.open()
        assert(old.verno===5 && !old.tables.some(t=>t.name==='journeys') && await old.table('activityDocuments').count()===1 && (await old.table('metadata').get('initialization')).initialized,'Upgrade échouée non atomique')
      } else {
        await next.open()
        assert(next.verno===6 && await next.trips.count()===0 && await next.journeys.count()===0 && await next.syncOutbox.count()===0,'Base V5 vide peuplée pendant migration')
      }
    } finally { next.close();old.close();await Dexie.delete(name) }
  }
  report('V5→V6 : base vide sans données ajoutées ; orphelin refusé, rollback du schéma et des données V5 confirmé.')
}
