import Dexie from 'dexie'
import { isReplayableOperation } from '../src/sync/model'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createTransferRepository } from '../src/db/transfers'
import { createActivityRepository } from '../src/db/activities'
import { transferKey } from '../src/db/transferModel'
import { createV21Repository } from '../src/evolution/v21/repository'
import type { Journey } from '../src/evolution/v21/contracts'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) { try { await action() } catch { return }; throw new Error('Écriture de projection obsolète acceptée : résurrection possible.') }
export async function testLegacyBridge(report: (text: string) => void) {
  const name = `roam-v2-test-bridge-${crypto.randomUUID()}`, database = new RoamDatabase(name), other = new RoamDatabase(name), restored = new RoamDatabase(name+'-restored')
  const legacy = createTransferRepository(database), concurrent = createTransferRepository(other), native = createV21Repository(database), activities = createActivityRepository(database)
  const trip: Trip = {id:'trip',destination:'Test',country:'France',startDate:'2026-12-31',endDate:'2027-01-01',travelers:1,image:''}
  try {
    await database.trips.add(trip)
    const a = await activities.createActivity('trip',{title:'A',category:'visit',date:trip.startDate,scheduleType:'unscheduled',period:null,location:'Lieu A',latitude:0,longitude:-1})
    const b = await activities.createActivity('trip',{title:'B',category:'visit',date:trip.startDate,scheduleType:'unscheduled',period:null,location:'Lieu B'})
    const input={fromActivityId:a.id,toActivityId:b.id,mode:'train' as const,currency:'EUR',estimatedCost:20,paidAmount:7}
    const original=await legacy.saveTransfer('trip',input)
    assert(await database.journeys.count()===1,'Création V2 sans Journey')
    await legacy.deleteTransfer('trip',original.id,transferKey(original))
    const deletedCount=await database.syncOutbox.count()
    await rejects(()=>database.trips.update('trip',{manualTransfers:[original]}))
    assert(await database.journeys.count()===0 && await database.syncOutbox.count()===deletedCount,'Projection ressuscite une Journey supprimée ou journalise un refus')
    const created=await legacy.saveTransfer('trip',input)
    const current=(await database.journeys.toArray())[0], snapshot=await native.read('journeys','trip',current.id)
    await native.saveJourney('trip',{...snapshot.entity as Journey,reservation:{status:'confirmed',reference:'CONF'},title:'Titre autonome'},snapshot.revision)
    await rejects(()=>legacy.saveTransfer('trip',{...input,notes:'Ancienne version'},created.id,transferKey(created)))
    const refreshed=(await database.trips.get('trip'))!.manualTransfers![0]
    const result=await legacy.saveTransfer('trip',{...input,estimatedCost:25,notes:'V2'},created.id,transferKey(refreshed))
    const canonical=(await database.journeys.toArray())[0]
    assert(canonical.reservation?.reference==='CONF'&&canonical.title==='Titre autonome'&&canonical.stops[0].link?.id===a.id&&canonical.estimatedCost===25&&canonical.paidAmount===7,'Édition V2 perd des champs autonomes ou des références')
    const writes=await Promise.allSettled([legacy.saveTransfer('trip',{...input,notes:'A'},result.id,transferKey(result)),concurrent.deleteTransfer('trip',result.id,transferKey(result))])
    assert(writes.filter(r=>r.status==='fulfilled').length===1,'Concurrence V2 accepte deux versions')
    const beforeOpen=await database.journeys.count(), beforeRepair=JSON.stringify(await database.journeys.toArray()), operations=await database.syncOutbox.count()
    other.close(); database.close()
    const oldClient=new Dexie(name); await oldClient.open(); await oldClient.table('trips').update('trip',{manualTransfers:[original]}); oldClient.close()
    await database.open()
    assert(JSON.stringify(await database.journeys.toArray())===beforeRepair && await database.syncOutbox.count()===operations,'Réparer le cache modifie le canonique ou le journal')
    assert(!(await database.trips.get('trip'))!.manualTransfers?.some(t=>t.id===original.id),'Un ancien cache réintroduit le transfert supprimé')
    assert(!isReplayableOperation({status:'superseded',protocolVersion:2} as never) && !isReplayableOperation({status:'pending'} as never),'Une opération V5 est rejouable')
    assert(await database.journeys.count()===beforeOpen,'Réouverture duplique les trajets')
    const archive=await buildExportArchive(await readExportSnapshot({mode:'trip',tripId:'trip'},database)), prepared=await prepareRestore(archive.blob)
    await restoreBackup(prepared,await previewRestore(prepared,restored),restored)
    assert(await restored.journeys.count()===beforeOpen,'ZIP duplique ou perd les trajets')
    await restoreBackup(prepared,await previewRestore(prepared,restored),restored)
    assert(await restored.journeys.count()===beforeOpen,'Deuxième restauration duplique les trajets')
    report('Pont V2 : source canonique, refus du rejeu de projection, création/modification/suppression, champs autonomes conservés, CAS concurrent, réouverture et ZIP sans doublon.')
  } finally {other.close();await database.delete();await restored.delete()}
}
