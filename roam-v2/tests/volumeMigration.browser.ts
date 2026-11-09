import Dexie from 'dexie'
import { RoamDatabase, type Trip } from '../src/db/database'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { sha256 } from '../src/backup/sha256'
import { timedFixture } from './dayPlanning.core'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testVolumeMigration(report: (message: string) => void) {
  const name = `roam-v2-test-volume-${crypto.randomUUID()}`, legacy = new Dexie(name)
  legacy.version(4).stores({ trips: 'id,destination,startDate,endDate', metadata: 'key', activities: 'id,tripId,[tripId+date]', activityDocuments: 'id,activityId', activityDocumentBlobs: 'id' })
  const stamp = '2026-11-09T12:00:00.000Z'
  const trip: Trip = { id: 'paris-test', destination: 'Paris — test isolé', country: 'France', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '', referenceCurrency: 'EUR', plannedBudget: { amount: 500, currency: 'EUR' }, participants: [{ id: 'p', name: 'Test' }], manualTransfers: [{ id: 't', fromActivityId: 'a0', toActivityId: 'a1', mode: 'metro', durationMinutes: 15, currency: 'EUR', estimatedCost: 2, createdAt: stamp, updatedAt: stamp }], preparationTasks: [{ id: 'task', title: 'Billets de test', category: 'documents', priority: 'normal', completed: false, createdAt: stamp, updatedAt: stamp }], practicalRecords: [{ id: 'contact', title: 'Hôtel fictif', kind: 'contact', category: 'accommodation', phone: '+33123456789', email: 'test@example.invalid', createdAt: stamp, updatedAt: stamp }] }
  const activities = Array.from({ length: 300 }, (_, index) => ({ ...timedFixture(`a${index}`, '10:00', '11:00', index), tripId: trip.id, title: `Activité ${index}`, location: 'Paris', address: 'Adresse de test', latitude: 48.8566, longitude: 2.3522, estimatedCost: 10, paidAmount: 0, currency: 'EUR', reservationStatus: 'confirmed' as const, reservationReference: `REF-${index}` }))
  const payloads = Array.from({ length: 31 }, (_, index) => {
    const bytes = new Uint8Array((index === 30 ? 15 : 1) * 1024 * 1024); bytes.set(new TextEncoder().encode('%PDF-1.7\nFixture binaire — pas de vrai billet')); bytes[bytes.length - 1] = index
    return { id: `d${index}`, blob: new Blob([bytes], { type: 'application/pdf' }) }
  })
  const documents = payloads.map((payload, index) => ({ id: payload.id, activityId: `a${index}`, name: `Test ${index}.pdf`, mime: 'application/pdf' as const, size: payload.blob.size, importedAt: stamp }))
  await legacy.table('trips').add(trip); await legacy.table('activities').bulkAdd(activities); await legacy.table('activityDocuments').bulkAdd(documents); await legacy.table('activityDocumentBlobs').bulkAdd(payloads); await legacy.table('metadata').add({ key: 'initialization', initialized: true })
  const timestamp = new Date().toISOString()
  const oldZip = await buildExportArchive({ trips: [trip], activities, documents, payloads, metadata: [{ key: 'initialization', initialized: true }], scope: { mode: 'full' }, snapshotAt: timestamp, databaseVersion: 4 } as Parameters<typeof buildExportArchive>[0])
  legacy.close()
  const migrated = new RoamDatabase(name), oldTarget = new RoamDatabase(name + '-old'), newTarget = new RoamDatabase(name + '-new')
  try {
    await migrated.open()
    assert(migrated.verno === 5 && JSON.stringify(await migrated.trips.get(trip.id)) === JSON.stringify(trip), 'Migration perd budget, préparatifs, contacts ou déplacements.')
    assert(JSON.stringify(await migrated.activities.bulkGet(activities.map((row) => row.id))) === JSON.stringify(activities) && await migrated.activityDocuments.count() === 31 && await migrated.syncEntities.count() === 363, 'Migration volumineuse altère les activités, réservations ou relations.')
    const beforeId = (await migrated.syncMeta.get('installation'))!.installationId, beforeCount = await migrated.syncOutbox.count()
    migrated.close(); await migrated.open()
    assert((await migrated.syncMeta.get('installation'))!.installationId === beforeId && await migrated.syncOutbox.count() === beforeCount, 'Réouverture répète la migration.')
    const newZip = await buildExportArchive(await readExportSnapshot({ mode: 'full' }, migrated))
    for (const [archive, target] of [[oldZip, oldTarget], [newZip, newTarget]] as const) {
      const prepared = await prepareRestore(archive.blob), preview = await previewRestore(prepared, target)
      await restoreBackup(prepared, preview, target)
      assert(JSON.stringify(await target.trips.get(trip.id)) === JSON.stringify(trip) && await target.activities.where('tripId').equals(trip.id).count() === 300, 'Restauration V4/V5 perd des données.')
      for (const payload of payloads) assert(await sha256((await target.activityDocumentBlobs.get(payload.id))!.blob) === await sha256(payload.blob), 'Document volumineux altéré.')
    }
    report('Volume : 300 activités, réservations, déplacements, budget, préparatifs et contacts ; 31 PDF fictifs / 45 Mio dont un fichier de 15 Mio ; ZIP avant migration V4, upgrade V5 intacte, réouverture stable, restauration V4/V5 et SHA-256 binaires identiques.')
  } finally { await migrated.delete(); await oldTarget.delete(); await newTarget.delete() }
}
