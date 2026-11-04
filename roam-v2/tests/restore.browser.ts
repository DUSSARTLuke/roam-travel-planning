import Dexie from 'dexie'
import { RoamDatabase, type Trip } from '../src/db/database'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { createStoredZip } from '../src/backup/zip'
import { readBackupZip, RESTORE_LIMITS } from '../src/backup/readZip'
import { parseBackupJson } from '../src/backup/safeJson'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Une restauration invalide a été acceptée.')
}
async function empty(database: RoamDatabase) {
  await database.transaction('rw', database.tables, async () => { for (const table of database.tables) await table.clear() })
}
async function fingerprint(database: RoamDatabase) {
  return database.transaction('r', database.tables, async () => {
    const records = await Promise.all(database.tables.filter((table) => table.name !== 'activityDocumentBlobs').map((table) => table.toArray()))
    const blobs = await database.activityDocumentBlobs.toArray()
    return { records: JSON.stringify(records), blobs }
  })
}
async function unchanged(database: RoamDatabase, before: Awaited<ReturnType<typeof fingerprint>>) {
  const after = await fingerprint(database)
  assert(after.records === before.records && after.blobs.length === before.blobs.length, 'Échec a modifié les données locales.')
  for (const blob of after.blobs) {
    const original = before.blobs.find((item) => item.id === blob.id)
    assert(original && new Uint8Array(await original.blob.arrayBuffer()).join() === new Uint8Array(await blob.blob.arrayBuffer()).join(), 'Blob local altéré.')
  }
}

export async function testRestore(report: (message: string) => void) {
  const source = new RoamDatabase(`roam-v2-test-restore-source-${crypto.randomUUID()}`)
  const target = new RoamDatabase(`roam-v2-test-restore-target-${crypto.randomUUID()}`)
  try {
    await source.open(); await target.open(); await empty(source); await empty(target)
    const base: Trip = { id: 'restore-active', destination: 'Test restauration', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: 'https://example.com/photo.jpg' }
    const trips = [base, { ...base, id: 'restore-archived', archived: true }, { ...base, id: 'restore-trash', deletedAt: '2026-11-03T00:00:00Z' }]
    await source.trips.bulkAdd(trips)
    await source.metadata.put({ key: 'initialization', initialized: true })
    await source.table('metadata').put({ key: 'global-test', value: 'origin' })
    const original = new Blob(['%PDF-1.7\nTest binaire\0'], { type: 'application/pdf' })
    for (const trip of trips) {
      const activityId = `activity-${trip.id}`
      await source.activities.add({ id: activityId, tripId: trip.id, title: 'Test activité', category: 'visit', date: null,
        scheduleType: 'exact', startTime: '09:30', period: null, sortOrder: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', paidAmount: 0, currency: 'GBP',
        reservationStatus: 'confirmed', reservationReference: 'REF', links: [{ id: 'link', title: 'Site', url: 'https://example.com' }] })
      await source.activityDocuments.add({ id: `document-${trip.id}`, activityId, name: 'Original été.pdf', mime: 'application/pdf', size: original.size, importedAt: '2026-01-01T00:00:00Z' })
      await source.activityDocumentBlobs.add({ id: `document-${trip.id}`, blob: original })
    }
    const images = [
      { mime: 'image/jpeg' as const, bytes: [255, 216, 255, 224], extension: 'jpg' },
      { mime: 'image/png' as const, bytes: [137, 80, 78, 71, 13, 10, 26, 10], extension: 'png' },
      { mime: 'image/webp' as const, bytes: [82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80], extension: 'webp' },
    ]
    for (const image of images) {
      const id = `restore-image-${image.extension}`
      const blob = new Blob([new Uint8Array(image.bytes)], { type: image.mime })
      await source.activityDocuments.add({ id, activityId: `activity-${base.id}`, name: `image.${image.extension}`, mime: image.mime, size: blob.size, importedAt: '2026-01-01T00:00:00Z' })
      await source.activityDocumentBlobs.add({ id, blob })
    }
    const documentCount = await source.activityDocuments.count()
    const snapshot = await readExportSnapshot({ mode: 'full' }, source)
    const archive = (await buildExportArchive(snapshot)).blob
    const beforePreparation = await fingerprint(target)
    const prepared = await prepareRestore(archive)
    const preview = await previewRestore(prepared, target)
    await rejects(() => previewRestore({ ...prepared }, target))
    await rejects(() => restoreBackup(prepared, { ...preview }, target))
    await unchanged(target, beforePreparation)
    assert(preview.importing.length === 3 && preview.activities === 3 && preview.documents === documentCount, 'Aperçu base vide incorrect.')
    const result = await restoreBackup(prepared, preview, target)
    assert(result.importedTrips === 3 && result.documents === documentCount, 'Restauration incomplète.')
    assert(JSON.stringify(await target.trips.toArray()) === JSON.stringify(await source.trips.toArray()), 'Voyages/dates/archives/corbeille altérés.')
    assert(JSON.stringify(await target.metadata.toArray()) === JSON.stringify(await source.metadata.toArray()), 'Métadonnées globales non restaurées.')
    assert(JSON.stringify(await target.activities.toArray()) === JSON.stringify(await source.activities.toArray()), 'Activités avancées altérées.')
    assert(JSON.stringify(await target.activityDocuments.toArray()) === JSON.stringify(await source.activityDocuments.toArray()), 'Métadonnées de documents altérées.')
    for (const payload of await target.activityDocumentBlobs.toArray()) {
      const originalPayload = (await source.activityDocumentBlobs.get(payload.id))!
      assert(new Uint8Array(await payload.blob.arrayBuffer()).join() === new Uint8Array(await originalPayload.blob.arrayBuffer()).join(), 'Octets binaires PDF/image altérés.')
    }
    target.close(); await target.open()
    assert(await target.activityDocumentBlobs.count() === documentCount, 'Restauration non persistée.')
    report('Restauration : validation/aperçu sans écriture, base vide, identifiants/relations, archives/corbeille, champs avancés, Blob et persistance.')

    await target.trips.update(base.id, { destination: 'Local à conserver' })
    await target.activities.update(`activity-${base.id}`, { notes: 'Notes locales' })
    const beforeConflict = await fingerprint(target)
    const allSkipped = await previewRestore(prepared, target)
    assert(allSkipped.importing.length === 0 && allSkipped.activities === 0 && allSkipped.documents === 0, 'Enfants d’un voyage existant inclus.')
    await restoreBackup(prepared, allSkipped, target)
    await unchanged(target, beforeConflict)

    await empty(target)
    await target.trips.add({ ...base, destination: 'Déjà présent' })
    await target.metadata.put({ key: 'initialization', initialized: true })
    await target.table('metadata').put({ key: 'global-test', value: 'local' })
    const mixed = await previewRestore(prepared, target)
    assert(mixed.importing.length === 2 && mixed.skipped.length === 1, 'Conflits mixtes incorrects.')
    await restoreBackup(prepared, mixed, target)
    assert((await target.table('metadata').get('global-test')).value === 'local', 'Métadonnée locale écrasée.')
    assert((await target.trips.get(base.id))!.destination === 'Déjà présent' && !await target.activities.get(`activity-${base.id}`), 'Voyage existant écrasé ou complété.')
    report('Restauration : voyage existant ignoré intégralement, données locales conservées et conflits mixtes.')

    await empty(target)
    const obsolete = await previewRestore(prepared, target)
    await target.trips.add(base)
    const beforeRace = await fingerprint(target)
    await rejects(() => restoreBackup(prepared, obsolete, target))
    await unchanged(target, beforeRace)
    const refreshed = await previewRestore(prepared, target)
    await restoreBackup(prepared, refreshed, target)
    await empty(target)
    await target.trips.add({ ...base, id: 'other-local-trip' })
    await target.activities.add({ ...snapshot.activities[0], tripId: 'other-local-trip' })
    const beforeCollision = await fingerprint(target)
    await rejects(() => previewRestore(prepared, target))
    await unchanged(target, beforeCollision)

    await empty(target)
    const rollbackPreview = await previewRestore(prepared, target)
    function failWrite() { throw new DOMException('Test quota', 'QuotaExceededError') }
    target.activityDocumentBlobs.hook('creating', failWrite)
    const beforeFailure = await fingerprint(target)
    await rejects(() => restoreBackup(prepared, rollbackPreview, target))
    await unchanged(target, beforeFailure)
    target.activityDocumentBlobs.hook('creating').unsubscribe(failWrite)
    function interruptWrite() { Dexie.currentTransaction?.abort(); throw new Error('Interruption de test') }
    target.activityDocumentBlobs.hook('creating', interruptWrite)
    await rejects(async () => restoreBackup(prepared, await previewRestore(prepared, target), target))
    await unchanged(target, beforeFailure)
    target.activityDocumentBlobs.hook('creating').unsubscribe(interruptWrite)
    await restoreBackup(prepared, await previewRestore(prepared, target), target)
    report('Restauration : conflits réévalués, collision enfant refusée et rollback total d’un import interrompu/quota.')

    const entries = await readBackupZip(archive)
    const corrupt = new Uint8Array(await archive.arrayBuffer()); corrupt[40] ^= 1
    await rejects(() => prepareRestore(new Blob([corrupt])))
    const beforeCorruption = await fingerprint(target)
    async function changedFile(path: string, content: Blob) {
      return createStoredZip([...entries].map(([name, blob]) => ({ path: name, blob: name === path ? content : blob })))
    }
    // CRC is recomputed, but the original SHA-256 must still reject tampering.
    await rejects(async () => prepareRestore(await changedFile('data/trips.json', new Blob(['[]']))))
    const manifest = JSON.parse(await entries.get('manifest.json')!.text())
    manifest.formatVersion = 999
    await rejects(async () => prepareRestore(await changedFile('manifest.json', new Blob([JSON.stringify(manifest)]))))
    await rejects(async () => prepareRestore(await createStoredZip([...entries].filter(([name]) => !name.startsWith('documents/')).map(([path, blob]) => ({ path, blob })))))
    await rejects(() => parseBackupJson('{"id":"first","id":"second"}'))
    await rejects(() => parseBackupJson('{"__proto__":{"polluted":true}}'))
    await rejects(() => parseBackupJson('['.repeat(60) + '0' + ']'.repeat(60)))
    await rejects(() => prepareRestore(new Blob(['not zip'])))
    const oversized = new Blob(['test-size-limit'])
    Object.defineProperty(oversized, 'size', { value: RESTORE_LIMITS.archiveBytes + 1 })
    await rejects(() => prepareRestore(oversized))
    await unchanged(target, beforeCorruption)
    async function alteredData(path: string, value: unknown) {
      const data = new Blob([JSON.stringify(value)], { type: 'application/json' })
      const next = JSON.parse(await entries.get('manifest.json')!.text())
      const item = next.inventory.find((entry: { path: string }) => entry.path === path)
      item.size = data.size
      item.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (Array.isArray(value)) next.counts[path.split('/')[1].split('.')[0]] = value.length
      return createStoredZip([...entries].map(([name, blob]) => ({ path: name, blob: name === path ? data : name === 'manifest.json' ? new Blob([JSON.stringify(next)]) : blob })))
    }
    await rejects(async () => prepareRestore(await alteredData('data/activities.json', snapshot.activities.map((activity) => ({ ...activity, tripId: 'absent' })))))
    await rejects(async () => prepareRestore(await alteredData('data/trips.json', [...snapshot.trips, snapshot.trips[0]])))
    await rejects(async () => prepareRestore(await alteredData('data/trips.json', snapshot.trips.map((trip) => ({ ...trip, travelers: -1 })))))
    await rejects(async () => prepareRestore(await alteredData('data/documents.json', snapshot.documents.map((document) => ({ ...document, activityId: 'absent' })))))
    await rejects(async () => prepareRestore(await createStoredZip([...entries].map(([path, blob]) => ({ path, blob })).concat({ path: 'unexpected.txt', blob: new Blob(['extra']) }))))
    const dangerousPath = new Uint8Array(await archive.arrayBuffer())
    const zipView = new DataView(dangerousPath.buffer)
    let directory = zipView.getUint32(dangerousPath.length - 6, true)
    const encoder = new TextEncoder()
    for (let index = 0; index < entries.size; index++) {
      const nameLength = zipView.getUint16(directory + 28, true)
      const path = new TextDecoder().decode(dangerousPath.slice(directory + 46, directory + 46 + nameLength))
      if (path === 'data/trips.json') {
        const local = zipView.getUint32(directory + 42, true)
        dangerousPath.set(encoder.encode('../x/trips.json'), directory + 46)
        dangerousPath.set(encoder.encode('../x/trips.json'), local + 30)
      }
      directory += 46 + nameLength
    }
    await rejects(() => prepareRestore(new Blob([dangerousPath])))
    await unchanged(target, beforeCorruption)
    const individual = await prepareRestore((await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: 'restore-trash' }, source))).blob)
    await empty(target)
    await restoreBackup(individual, await previewRestore(individual, target), target)
    assert(await target.trips.count() === 1 && (await target.trips.get('restore-trash'))!.deletedAt !== undefined, 'Export individuel corbeille non restauré.')
    await empty(source); await empty(target)
    const emptyArchive = await prepareRestore((await buildExportArchive(await readExportSnapshot({ mode: 'full' }, source))).blob)
    await restoreBackup(emptyArchive, await previewRestore(emptyArchive, target), target)
    assert(await target.trips.count() === 0, 'Sauvegarde vide a ajouté un voyage.')
    report('Restauration : corruption CRC/SHA, version/fichiers/JSON invalides, limites, individuel et base vide.')
  } finally {
    source.close(); target.close()
    await source.delete(); await target.delete()
  }
}
