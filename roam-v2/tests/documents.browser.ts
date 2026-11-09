import { activityVersion } from '../src/db/activityRevision'
import Dexie from 'dexie'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createDocumentRepository } from '../src/db/documents'
import { MAX_DOCUMENT_BYTES, type ActivityDocumentBlob } from '../src/db/documentModel'
import type { TripActivity } from '../src/db/activityModel'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Une opération de document invalide a été acceptée.')
}

// Header fixtures exercise validation/storage, not full image/PDF decoding.
function file(mime = 'application/pdf', size?: number): File {
  const headers: Record<string, number[]> = {
    'application/pdf': [37, 80, 68, 70, 45, 49, 46, 55],
    'image/jpeg': [255, 216, 255, 224],
    'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
    'image/webp': [82, 73, 70, 70, 20, 0, 0, 0, 87, 69, 66, 80],
  }
  const bytes = new Uint8Array(size ?? 32)
  bytes.set(headers[mime])
  return new File([bytes], `test-${mime.replace('/', '.')}`, { type: mime })
}

export async function testDocuments(report: (message: string) => void) {
  const name = `roam-v2-test-documents-${crypto.randomUUID()}`
  const legacy = new Dexie(name)
  const database = new RoamDatabase(name)
  const trip: Trip = { id: 'doc-trip', destination: 'Test documents', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 1, image: '' }
  const activity: TripActivity = { id: 'doc-activity', tripId: trip.id, title: 'Test isolé', category: 'other', date: null,
    scheduleType: 'unscheduled', period: null, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
  try {
    legacy.version(3).stores({ trips: 'id, destination, startDate, endDate', metadata: 'key', activities: 'id, tripId, [tripId+date]' })
    await legacy.table('trips').add(trip)
    await legacy.table('activities').add(activity)
    const marker = { key: 'initialization', initialized: true }
    await legacy.table('metadata').add(marker)
    legacy.close()
    await database.open()
    assert(JSON.stringify(await database.trips.get(trip.id)) === JSON.stringify(trip), 'Migration a modifié le voyage.')
    assert(JSON.stringify(await database.activities.get(activity.id)) === JSON.stringify(activity), 'Migration a modifié l’activité.')
    assert(JSON.stringify(await database.metadata.get('initialization')) === JSON.stringify(marker), 'Migration a modifié les métadonnées.')
    assert(await database.activityDocuments.count() === 0 && await database.activityDocumentBlobs.count() === 0, 'Migration a ajouté des documents.')
    const docs = createDocumentRepository(database)
    const activities = createActivityRepository(database)
    let imported = await docs.importDocuments(trip.id, activity.id, [file(), file('image/jpeg'), file('image/png'), file('image/webp')])
    assert(imported.length === 4 && imported.every((item) => !('blob' in item)), 'Quatre formats/métadonnées incorrects.')
    assert((await database.activityDocumentBlobs.get(imported[0].id))!.blob instanceof Blob, 'Blob absent.')
    await rejects(() => docs.importDocuments(trip.id, activity.id, [new File([], 'empty.pdf', { type: 'application/pdf' })]))
    await rejects(() => docs.importDocuments(trip.id, activity.id, [file('application/pdf', MAX_DOCUMENT_BYTES + 1)]))
    await rejects(() => docs.importDocuments(trip.id, activity.id, [new File(['bad'], 'fake.pdf', { type: 'application/pdf' })]))
    await rejects(() => docs.importDocuments(trip.id, activity.id, [new File([file()], 'wrong.png', { type: 'image/png' })]))
    await rejects(() => docs.importDocuments(trip.id, activity.id, [file(), new File(['bad'], 'bad.txt', { type: 'text/plain' })]))
    assert(await database.activityDocuments.count() === 4, 'Import multiple partiellement validé.')
    await docs.importDocuments(trip.id, activity.id, [file('application/pdf', MAX_DOCUMENT_BYTES)])
    await rejects(() => docs.importDocuments(trip.id, activity.id, [file()]))
    assert(await database.activityDocuments.count() === 5, 'Limite 5 incorrecte.')
    database.close()
    await database.open()
    imported = await docs.listDocuments(trip.id, activity.id)
    assert(imported.length === 5 && imported.some((item) => item.size === MAX_DOCUMENT_BYTES), 'Persistance/limite 15 Mo incorrecte.')
    function failRead() { throw new Error('Lecture Blob interdite pour les métadonnées') }
    database.activityDocumentBlobs.hook('reading', failRead)
    assert((await docs.listDocuments(trip.id, activity.id)).length === 5, 'Lecture des Blob par la liste.')
    database.activityDocumentBlobs.hook('reading').unsubscribe(failRead)
    await rejects(() => docs.listDocuments('wrong-trip', activity.id))
    await rejects(() => docs.importDocuments('wrong-trip', activity.id, [file()]))
    report('Documents : V3→V4 préservée, quatre formats, limites, lot invalide atomique, persistance et métadonnées sans Blob.')

    let blobReads = 0
    function countRead(value: ActivityDocumentBlob) { blobReads++; return value }
    database.activityDocumentBlobs.hook('reading', countRead)
    const opened = await docs.getDocument(trip.id, activity.id, imported[0].id)
    database.activityDocumentBlobs.hook('reading').unsubscribe(countRead)
    assert(blobReads === 1 && opened.metadata.name === imported[0].name && opened.blob.type === imported[0].mime, 'Ouverture ne charge pas exactement le Blob demandé.')
    for (const document of imported) {
      const read = await docs.getDocument(trip.id, activity.id, document.id)
      assert(read.blob.size === document.size, 'Lecture individuelle incorrecte.')
    }
    await rejects(() => docs.getDocument('wrong-trip', activity.id, imported[0].id))
    await rejects(() => docs.getDocument(trip.id, 'wrong-activity', imported[0].id))
    await rejects(() => docs.deleteDocument('wrong-trip', activity.id, imported[0].id))
    await rejects(() => docs.deleteDocument(trip.id, 'wrong-activity', imported[0].id))
    const managedActivity = await activities.createActivity(trip.id, activity)
    const managed = await docs.importDocuments(trip.id, managedActivity.id, [file(), file('image/png')])
    await rejects(() => docs.getDocument(trip.id, managedActivity.id, imported[0].id))
    await rejects(() => docs.deleteDocument(trip.id, managedActivity.id, imported[0].id))
    function failDocumentDelete() { throw new Error('Échec de suppression volontaire') }
    database.activityDocuments.hook('deleting', failDocumentDelete)
    await rejects(() => docs.deleteDocument(trip.id, managedActivity.id, managed[0].id))
    database.activityDocuments.hook('deleting').unsubscribe(failDocumentDelete)
    assert(await database.activityDocuments.get(managed[0].id) && await database.activityDocumentBlobs.get(managed[0].id), 'Suppression individuelle non atomique.')
    await database.activityDocumentBlobs.put({ id: managed[0].id, blob: new Blob(['corrompu']) })
    await rejects(() => docs.getDocument(trip.id, managedActivity.id, managed[0].id))
    await docs.deleteDocument(trip.id, managedActivity.id, managed[0].id)
    await rejects(() => docs.getDocument(trip.id, managedActivity.id, managed[0].id))
    await database.activityDocumentBlobs.delete(managed[1].id)
    await rejects(() => docs.getDocument(trip.id, managedActivity.id, managed[1].id))
    await docs.deleteDocument(trip.id, managedActivity.id, managed[1].id)
    database.close()
    await database.open()
    assert((await docs.listDocuments(trip.id, managedActivity.id)).length === 0 && (await docs.listDocuments(trip.id, activity.id)).length === 5, 'Suppression non persistée ou autre activité affectée.')
    await activities.deleteActivity(trip.id, managedActivity.id)
    report('Lecture/suppression individuelles : un seul Blob, quatre formats, intégrité, manquant/corrompu, isolation, rollback et persistance.')

    const second = await activities.createActivity(trip.id, activity)
    const concurrent = await Promise.allSettled([
      docs.importDocuments(trip.id, second.id, [file(), file(), file()]),
      docs.importDocuments(trip.id, second.id, [file(), file(), file()]),
    ])
    assert(concurrent.filter((result) => result.status === 'fulfilled').length === 1 && (await docs.listDocuments(trip.id, second.id)).length === 3, 'Limite contournée par deux imports concurrents.')
    function failWrite() { throw new DOMException('Quota test', 'QuotaExceededError') }
    database.activityDocumentBlobs.hook('creating', failWrite)
    const activityCount = await database.activities.count()
    await rejects(() => docs.saveActivityWithDocuments(trip.id, { ...activity, title: 'Ne doit pas être créée' }, null, [file()]))
    assert(await database.activities.count() === activityCount, 'Activité orpheline après quota dépassé.')
    await rejects(() => docs.saveActivityWithDocuments(trip.id, { ...activity, title: 'Ne doit pas être modifiée' }, second.id, [file()], activityVersion(second)))
    assert((await database.activities.get(second.id))!.title === activity.title && (await docs.listDocuments(trip.id, second.id)).length === 3, 'Sauvegarde activité/documents non atomique.')
    database.activityDocumentBlobs.hook('creating').unsubscribe(failWrite)
    const secondDocs = await docs.listDocuments(trip.id, second.id)
    await activities.deleteActivity(trip.id, second.id)
    assert(!(await database.activityDocumentBlobs.bulkGet(secondDocs.map((item) => item.id))).some(Boolean), 'Blob orphelin après suppression activité.')
    assert((await docs.listDocuments(trip.id, activity.id)).length === 5, 'Documents d’une autre activité supprimés.')

    // Duplication retains the current contract: trip information only.
    await database.trips.add({ ...trip, id: 'copy-trip', destination: 'Test (copie)' })
    assert((await database.activities.where('tripId').equals('copy-trip').count()) === 0, 'Duplication a copié des activités/documents.')
    await rejects(() => docs.listDocuments('copy-trip', activity.id))
    await database.trips.update(trip.id, { archived: true })
    await updateTripTrash(trip.id, 'trash', undefined, database)
    assert((await docs.listDocuments(trip.id, activity.id)).length === 5, 'Archivage/corbeille a perdu les documents.')
    await rejects(() => docs.importDocuments(trip.id, activity.id, [file()]))
    const token = (await database.trips.get(trip.id))!.deletedAt
    await updateTripTrash(trip.id, 'restore', undefined, database)
    await rejects(() => updateTripTrash(trip.id, 'delete', token, database))
    assert(await database.activityDocumentBlobs.count() === 5, 'Suppression concurrente non protégée.')
    await updateTripTrash(trip.id, 'trash', undefined, database)
    const currentToken = (await database.trips.get(trip.id))!.deletedAt
    function failDelete() { throw new Error('Rollback test') }
    database.trips.hook('deleting', failDelete)
    await rejects(() => updateTripTrash(trip.id, 'delete', currentToken, database))
    database.trips.hook('deleting').unsubscribe(failDelete)
    assert(await database.activityDocuments.count() === 5 && await database.activityDocumentBlobs.count() === 5, 'Cascade ne rollback pas les documents.')
    await updateTripTrash(trip.id, 'delete', currentToken, database)
    assert(await database.activityDocuments.count() === 0 && await database.activityDocumentBlobs.count() === 0, 'Cascade voyage incomplète.')
    report('Documents : isolation, concurrence, quota/rollback, cascades activité/voyage, archives/corbeille et duplication.')
  } finally {
    legacy.close()
    database.close()
    await database.delete()
  }
}
