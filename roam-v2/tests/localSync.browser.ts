import { validateSyncLineage } from '../src/sync/backup'
import Dexie from 'dexie'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { entityKey } from '../src/sync/model'
import { runLocalCommand, LocalRevisionConflict } from '../src/sync/commands'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { timedFixture } from './dayPlanning.core'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) { try { await action() } catch (error) { return error }; throw new Error('Opération invalide acceptée.') }
export async function testLocalSync(report: (message: string) => void) {
  const name = `roam-v2-test-local-sync-${crypto.randomUUID()}`
  const legacy = new Dexie(name)
  legacy.version(4).stores({ trips: 'id,destination,startDate,endDate', metadata: 'key', activities: 'id,tripId,[tripId+date]', activityDocuments: 'id,activityId', activityDocumentBlobs: 'id' })
  const trip: Trip = { id: 'legacy-not-uuid', destination: 'Historique', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '', practicalRecords: [], participants: [{ id: 'p', name: 'Test' }] }
  await legacy.table('trips').add(trip); await legacy.table('metadata').add({ key: 'initialization', initialized: true })
  const activity = { ...timedFixture('a', '10:00', '11:00'), tripId: trip.id }
  await legacy.table('activities').add(activity)
  const blob = new Blob(['%PDF-1.7\nlocal test'], { type: 'application/pdf' })
  const document = { id: 'd', activityId: activity.id, name: 'Test.pdf', mime: 'application/pdf', size: blob.size, importedAt: '2026-11-06T12:00:00.000Z' }
  await legacy.table('activityDocuments').add(document); await legacy.table('activityDocumentBlobs').add({ id: 'd', blob }); legacy.close()
  const database = new RoamDatabase(name), other = new RoamDatabase(name), target = new RoamDatabase(name + '-target')
  const key = entityKey('trips', trip.id)
  try {
    await database.open()
    assert(database.verno === 6 && JSON.stringify(await database.trips.get(trip.id)) === JSON.stringify(trip) && JSON.stringify(await database.activities.get('a')) === JSON.stringify(activity), 'Migration réécrit des données métier.')
    assert(await database.syncEntities.count() === 4 && await database.syncOutbox.where('status').equals('pending').count() === 4 && (await database.activityDocumentBlobs.get('d'))!.blob.size === blob.size, 'Amorçage ou Blob perdu.')
    const installation = (await database.syncMeta.get('installation'))!.installationId
    const initial = (await database.syncEntities.get(key))!
    assert(initial.revision >= 2 && initial.serverRevision === null && initial.identity !== trip.id, 'Identité ancienne ou révision incorrecte.')
    const baselineOperations = await database.syncOutbox.count()
    database.close(); await database.open(); await other.open()
    assert((await other.syncMeta.get('installation'))!.installationId === installation && await database.syncOutbox.count() === baselineOperations, 'Réouverture réamorce le journal.')
    await Promise.all([database.trips.update(trip.id, { country: 'A' }), other.trips.update(trip.id, { travelers: 3 })])
    assert((await database.syncEntities.get(key))!.revision === initial.revision + 2 && (await database.trips.get(trip.id))!.country === 'A' && (await database.trips.get(trip.id))!.travelers === 3, 'Concurrence perd une révision ou un champ.')
    const count = await database.syncOutbox.count(), revision = (await database.syncEntities.get(key))!.revision
    await rejects(() => database.transaction('rw', database.trips, async () => { await database.trips.update(trip.id, { destination: 'Rollback' }); throw new Error('abort') }))
    assert(await database.syncOutbox.count() === count && (await database.syncEntities.get(key))!.revision === revision && (await database.trips.get(trip.id))!.destination === trip.destination, 'Rollback partiel du journal.')
    const command = { id: 'command-1', fingerprint: 'rename-v1', expected: [{ key, revision, identity: initial.identity }] }
    let executions = 0
    const action = async () => { executions++; await database.trips.update(trip.id, { destination: 'Rejouable' }) }
    await runLocalCommand(database, command, action); await runLocalCommand(other, command, async () => { throw new Error('Commande rejouée') })
    assert(executions === 1 && await database.syncOutbox.count() === count + 1, 'Commande dupliquée.')
    await rejects(() => runLocalCommand(database, { ...command, fingerprint: 'autre' }, action))
    const conflict = await rejects(() => runLocalCommand(database, { ...command, id: 'stale' }, action))
    assert(conflict instanceof LocalRevisionConflict && executions === 1, 'Conflit non détecté avant écriture.')
    const copy = { ...trip, id: 'copy', destination: 'Copie' }; await database.trips.add(copy)
    assert((await database.syncEntities.get(entityKey('trips', copy.id)))!.identity !== initial.identity, 'Duplication partage une identité.')
    const snapshot = await readExportSnapshot({ mode: 'full' }, database)
    const zip = await buildExportArchive(snapshot)
    const validated = await validateRestoreArchive(zip.blob)
    assert(validated.localSync?.entities.length === 5, 'ZIP V5 perd les identités.')
    await target.open()
    const prepared = await prepareRestore(zip.blob), preview = await previewRestore(prepared, target)
    await restoreBackup(prepared, preview, target)
    assert((await target.syncMeta.get('installation'))!.installationId !== installation && (await target.syncEntities.get(key))!.identity === initial.identity, 'Restauration clone l’installation ou perd la filiation.')
    assert((await target.activityDocumentBlobs.get('d'))!.blob.size === blob.size && (await target.trips.get(trip.id))!.destination === 'Rejouable', 'ZIP altère données/Blob.')
    await rejects(async () => validateSyncLineage({ version: 1, entities: snapshot.sync.slice(1) }, snapshot, snapshot.scope))
    await rejects(async () => validateSyncLineage({ version: 1, entities: snapshot.sync.map((state, index) => index ? state : { ...state, identity: 'invalid' }) }, snapshot, snapshot.scope))
    await rejects(async () => validateSyncLineage({ version: 1, entities: snapshot.sync, token: 'forbidden' }, snapshot, snapshot.scope))
    const outboxCount = await target.syncOutbox.count()
    await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert(await target.syncOutbox.count() === outboxCount, 'Import répété rejoue des opérations sur un voyage ignoré.')
    const oldSnapshot = { ...snapshot, databaseVersion: 4 }; delete (oldSnapshot as { sync?: unknown }).sync
    const oldZip = await buildExportArchive(oldSnapshot)
    assert((await validateRestoreArchive(oldZip.blob)).localSync === undefined, 'ZIP V4 ancien refusé.')
    await updateTripTrash(trip.id, 'trash', undefined, database)
    const deletedAt = (await database.trips.get(trip.id))!.deletedAt!
    await updateTripTrash(trip.id, 'delete', deletedAt, database)
    const tombstones = await database.syncEntities.toArray()
    assert(tombstones.filter((item) => item.deleted).length === 4 && !await database.trips.get(trip.id) && !await database.activities.get('a') && !await database.activityDocuments.get('d') && !await database.activityDocumentBlobs.get('d'), 'Cascade perd ses tombstones ou conserve un orphelin.')
    assert((await database.syncOutbox.toArray()).filter((item) => item.entityKey !== entityKey('trips', 'copy')).every((item) => item.payload === undefined), 'Suppression définitive conserve les anciens contenus/Blob dans la file.')
    const deletes = (await database.syncOutbox.toArray()).filter((item) => item.kind === 'delete')
    assert(deletes.length === 4 && new Set(deletes.map((item) => item.groupId)).size === 1 && deletes.every((item) => item.payload === undefined), 'Suppression non groupée ou données personnelles en tombstone.')
    const deletedZip = await buildExportArchive(await readExportSnapshot({ mode: 'full' }, database))
    assert((await validateRestoreArchive(deletedZip.blob)).localSync?.entities.filter((state) => state.deleted).length === 4, 'ZIP perd les suppressions.')
    await rejects(async () => previewRestore(await prepareRestore(deletedZip.blob), target))
    const receiver = new RoamDatabase(name + '-tombstones')
    try {
      const restore = await prepareRestore(deletedZip.blob)
      await restoreBackup(restore, await previewRestore(restore, receiver), receiver)
      assert((await receiver.syncEntities.toArray()).filter((state) => state.deleted).length === 4 && (await receiver.syncOutbox.toArray()).filter((op) => op.kind === 'delete').length === 4, 'Restauration perd le suivi des tombstones.')
    } finally { await receiver.delete() }
    const collisionReceiver = new RoamDatabase(name + '-legacy-collision')
    try {
      await collisionReceiver.trips.add({ ...trip, id: 'other' })
      await collisionReceiver.activities.add({ ...activity, tripId: 'other' })
      await collisionReceiver.activities.delete(activity.id)
      await rejects(async () => previewRestore(await prepareRestore(oldZip.blob), collisionReceiver))
      assert(!await collisionReceiver.trips.get(trip.id) && (await collisionReceiver.syncEntities.get(entityKey('activities', activity.id)))!.deleted, 'Ancien ZIP ressuscite ou remplace une identité enfant supprimée.')
    } finally { await collisionReceiver.delete() }
    const oldReceiver = new RoamDatabase(name + '-old-zip')
    try {
      const restore = await prepareRestore(oldZip.blob)
      await restoreBackup(restore, await previewRestore(restore, oldReceiver), oldReceiver)
      assert((await oldReceiver.trips.get(trip.id))!.destination === 'Rejouable' && (await oldReceiver.syncEntities.get(key))!.identity !== initial.identity, 'Ancien ZIP non restauré ou filiation inventée.')
    } finally { await oldReceiver.delete() }
    // Fail the journal insert itself: domain write and revision must roll back.
    const sequence = (await database.syncMeta.get('installation'))!.sequence!
    const id = `${installation}:${sequence + 1}`
    const sample = (await database.syncOutbox.toArray())[0]
    await database.syncOutbox.add({ ...sample, id })
    const beforeFailure = (await database.syncEntities.get(entityKey('trips', 'copy')))!.revision
    await rejects(() => database.trips.update('copy', { destination: 'Ne doit pas passer' }))
    assert((await database.trips.get('copy'))!.destination === copy.destination && (await database.syncEntities.get(entityKey('trips', 'copy')))!.revision === beforeFailure, 'Échec journal valide l’écriture métier.')
    const emptyName = name + '-empty', oldEmpty = new Dexie(emptyName)
    oldEmpty.version(4).stores({ trips: 'id', metadata: 'key', activities: 'id,tripId,[tripId+date]', activityDocuments: 'id,activityId', activityDocumentBlobs: 'id' })
    await oldEmpty.table('metadata').add({ key: 'initialization', initialized: true }); oldEmpty.close()
    const upgradedEmpty = new RoamDatabase(emptyName)
    try { await upgradedEmpty.open(); assert(await upgradedEmpty.trips.count() === 0 && await upgradedEmpty.syncOutbox.count() === 0 && Boolean(await upgradedEmpty.syncMeta.get('installation')), 'Migration vide réinsère Londres ou des opérations.') } finally { await upgradedEmpty.delete() }
    report('Sync locale V5 : migration V4 intacte, installation stable, identités distinctes, baseline unique, concurrence deux connexions, journal atomique/rollback, rejeu idempotent/CAS, cascade/tombstones, ZIP V4/V5/filiation/Blob et refus des rapprochements.')
  } finally { other.close(); await database.delete(); await target.delete() }
}
