import { RoamDatabase, type Trip } from '../src/db/database'
import { buildExportArchive, exportBackup, readExportSnapshot } from '../src/backup/exportBackup'
import { crc32 } from '../src/backup/zip'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Une sauvegarde incohérente a été produite.')
}
// Test-only inspection of this ZIP STORE format; no restoration or DB writes.
async function inspectZip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert(view.getUint16(offset + 8, true) === 0, 'Compression ZIP inattendue.')
    const size = view.getUint32(offset + 18, true)
    const nameSize = view.getUint16(offset + 26, true)
    const extra = view.getUint16(offset + 28, true)
    const path = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameSize))
    const start = offset + 30 + nameSize + extra
    const data = bytes.slice(start, start + size)
    assert(crc32(data) === view.getUint32(offset + 14, true), 'CRC ZIP invalide.')
    assert(!files.has(path), 'Chemin dupliqué.')
    files.set(path, data)
    offset = start + size
  }
  assert(view.getUint32(offset, true) === 0x02014b50, 'Répertoire ZIP absent.')
  const end = bytes.length - 22
  assert(view.getUint32(end, true) === 0x06054b50 && view.getUint16(end + 10, true) === files.size, 'Fin de ZIP invalide.')
  assert(view.getUint32(end + 16, true) === offset && view.getUint32(end + 12, true) === end - offset, 'Offsets ZIP invalides.')
  const json = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!))
  const manifest = json('manifest.json')
  assert(manifest.format === 'roam-v2-backup' && manifest.formatVersion === 2 && manifest.encrypted === false, 'Manifeste invalide.')
  for (const entry of manifest.inventory) {
    const data = files.get(entry.path)
    assert(data && data.length === entry.size, 'Inventaire incomplet.')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data))), (byte) => byte.toString(16).padStart(2, '0')).join('')
    assert(hash === entry.sha256, 'Empreinte invalide.')
  }
  assert(files.size === manifest.inventory.length + 1, 'Fichier hors inventaire.')
  return { files, json, manifest }
}

export async function testBackups(report: (message: string) => void) {
  const database = new RoamDatabase(`roam-v2-test-backups-${crypto.randomUUID()}`)
  try {
    await database.open()
    await database.transaction('rw', database.tables, async () => { for (const table of database.tables) await table.clear() })
    const trip: Trip = { id: 'active', destination: 'Test export', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 2, image: 'https://example.com/image.jpg' }
    await database.trips.bulkAdd([trip, { ...trip, id: 'archived', archived: true }, { ...trip, id: 'trash', deletedAt: '2026-11-01T00:00:00Z' }])
    await database.metadata.put({ key: 'initialization', initialized: true })
    const original = new Blob(['%PDF-1.7\nTest export binaire\n'], { type: 'application/pdf' })
    for (const id of ['active', 'archived', 'trash']) {
      await database.activities.add({ id: `activity-${id}`, tripId: id, title: 'Titre avant', category: 'visit', date: null,
        scheduleType: 'unscheduled', period: null, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        estimatedCost: 0, paidAmount: 12, currency: 'GBP', reservationStatus: 'confirmed', reservationReference: 'REF',
        links: [{ id: 'link', title: 'Site', url: 'https://example.com' }] })
      await database.activityDocuments.add({ id: `document-${id}`, activityId: `activity-${id}`, name: '../billet été.pdf', mime: 'application/pdf', size: original.size, importedAt: '2026-01-01T00:00:00Z' })
      await database.activityDocumentBlobs.add({ id: `document-${id}`, blob: original })
    }
    const before = JSON.stringify(await Promise.all(database.tables.filter((table) => table.name !== 'activityDocumentBlobs').map((table) => table.toArray())))
    const full = await inspectZip((await exportBackup({ mode: 'full' }, undefined, database)).blob)
    assert(full.manifest.counts.trips === 3 && full.manifest.counts.activities === 3 && full.manifest.counts.documents === 3, 'Voyages exclus de la sauvegarde complète.')
    assert(full.json('data/trips.json').some((trip: { archived?: boolean }) => trip.archived === true) && full.json('data/trips.json').some((trip: { deletedAt?: string }) => trip.deletedAt !== undefined), 'État archive/corbeille perdu.')
    assert(full.json('data/activities.json')[0].paidAmount === 12 && full.json('data/activities.json')[0].links[0].id === 'link', 'Champs avancés perdus.')
    const document = full.json('data/documents.json')[0]
    const entry = full.manifest.inventory.find((item: { documentId?: string }) => item.documentId === document.id)
    assert(document.name === '../billet été.pdf' && entry && !entry.path.includes('..'), 'Nom original ou chemin sécurisé perdu.')
    assert(new TextDecoder().decode(full.files.get(entry.path)!) === await original.text(), 'Fichier binaire altéré.')
    const after = JSON.stringify(await Promise.all(database.tables.filter((table) => table.name !== 'activityDocumentBlobs').map((table) => table.toArray())))
    assert(before === after, 'Export a modifié les données.')
    const individual = await inspectZip((await exportBackup({ mode: 'trip', tripId: 'archived' }, undefined, database)).blob)
    assert(individual.json('data/trips.json').length === 1 && individual.json('data/trips.json')[0].id === 'archived', 'Mauvais voyage individuel.')
    assert(individual.json('data/activities.json')[0].tripId === 'archived' && individual.manifest.counts.documents === 1 && individual.manifest.counts.metadata === 0, 'Données hors périmètre individuel.')
    report('Sauvegarde : ZIP/CRC/SHA-256, complet, archives/corbeille, individuel, binaires, relations et absence de mutation.')

    const snapshot = await readExportSnapshot({ mode: 'full' }, database)
    await database.transaction('rw', database.activities, database.activityDocumentBlobs, async () => {
      await database.activities.update('activity-active', { title: 'Titre après' })
      await database.activityDocumentBlobs.put({ id: 'document-active', blob: new Blob(['nouveau']) })
    })
    const coherent = await inspectZip((await buildExportArchive(snapshot)).blob)
    assert(coherent.json('data/activities.json').every((activity: { title: string }) => activity.title === 'Titre avant'), 'Snapshot changé après sa capture.')
    await rejects(() => exportBackup({ mode: 'full' }, undefined, database))
    await database.activityDocumentBlobs.put({ id: 'document-active', blob: original })
    await database.activityDocumentBlobs.delete('document-active')
    await rejects(() => exportBackup({ mode: 'full' }, undefined, database))
    await database.activityDocumentBlobs.put({ id: 'document-active', blob: original })
    await database.activityDocumentBlobs.put({ id: 'orphan', blob: original })
    await rejects(() => exportBackup({ mode: 'full' }, undefined, database))
    await database.activityDocumentBlobs.delete('orphan')
    await database.activities.update('activity-active', { tripId: 'absent' })
    await rejects(() => exportBackup({ mode: 'full' }, undefined, database))
    await database.activities.update('activity-active', { tripId: 'active' })
    await rejects(() => exportBackup({ mode: 'trip', tripId: 'absent' }, undefined, database))
    await exportBackup({ mode: 'full' }, undefined, database)
    await database.transaction('rw', database.tables, async () => { for (const table of database.tables) await table.clear() })
    const empty = await inspectZip((await exportBackup({ mode: 'full' }, undefined, database)).blob)
    assert(empty.manifest.counts.trips === 0 && empty.manifest.counts.documents === 0 && empty.files.size === 7 && empty.manifest.counts.journeys === 0 && empty.manifest.counts.accommodations === 0, 'Base vide incorrecte.')
    report('Sauvegarde : snapshot immuable, incohérences refusées, erreur puis nouvelle tentative et base vide.')
  } finally { database.close(); await database.delete() }
}
