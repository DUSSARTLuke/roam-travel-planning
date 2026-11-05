import { buildExportArchive, type ExportSnapshot } from '../src/backup/exportBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'

export async function testBackupHttp(report: (message: string) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
  // Simulate LAN HTTP without bypassing any integrity verification.
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined })
  try {
    const timestamp = '2026-01-01T00:00:00.000Z'
    const original = new Blob(['%PDF-1.7\nTest HTTP\n'], { type: 'application/pdf' })
    const snapshot: ExportSnapshot = {
      scope: { mode: 'full' }, snapshotAt: timestamp, databaseVersion: 4,
      trips: [{ id: 'http-trip', destination: 'Test', country: 'Test', startDate: '2026-01-01', endDate: '2026-01-02', travelers: 1, image: '' }],
      activities: [{ id: 'http-activity', tripId: 'http-trip', title: 'Test', category: 'visit', date: null, scheduleType: 'unscheduled', period: null, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp }],
      documents: [{ id: 'http-doc', activityId: 'http-activity', name: 'test.pdf', mime: 'application/pdf', size: original.size, importedAt: timestamp }],
      payloads: [{ id: 'http-doc', blob: original }], metadata: [],
    }
    const archive = await buildExportArchive(snapshot)
    const restored = await validateRestoreArchive(archive.blob)
    if (restored.trips[0]?.id !== 'http-trip' || await restored.payloads[0]?.blob.text() !== await original.text()) throw new Error('Aller-retour ZIP HTTP altéré.')
    const empty = await buildExportArchive({ ...snapshot, trips: [], activities: [], documents: [], payloads: [] })
    if ((await validateRestoreArchive(empty.blob)).trips.length !== 0) throw new Error('ZIP HTTP vide invalide.')
    report('ZIP HTTP sans Web Crypto : export et validation de restauration, relations, PDF intact et base vide (aucune écriture).')
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'subtle', descriptor)
    else Reflect.deleteProperty(globalThis.crypto, 'subtle')
  }
}
