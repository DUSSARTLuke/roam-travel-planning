import { validateTripTransfers } from '../db/transferModel'
import { beginSensitiveOperation } from '../pwa/reloadSafety'
import { db, type RoamDatabase } from '../db/database'
import { detectDocumentMime } from '../db/documentModel'
import { createStoredZip, type ZipEntry } from './zip'

export type BackupScope = { mode: 'full' } | { mode: 'trip'; tripId: string }
let exporting = false

export async function readExportSnapshot(scope: BackupScope, database: RoamDatabase = db) {
  return database.transaction('r', [database.trips, database.activities, database.metadata, database.activityDocuments, database.activityDocumentBlobs], async () => {
    const trips = scope.mode === 'full' ? await database.trips.toArray() : await database.trips.where('id').equals(scope.tripId).toArray()
    if (scope.mode === 'trip' && trips.length !== 1) throw new Error('Le voyage à exporter est introuvable.')
    const activities = scope.mode === 'full' ? await database.activities.toArray() : await database.activities.where('tripId').equals(trips[0].id).toArray()
    const documents = scope.mode === 'full' ? await database.activityDocuments.toArray()
      : await database.activityDocuments.where('activityId').anyOf(activities.map((activity) => activity.id)).toArray()
    const payloads = scope.mode === 'full' ? await database.activityDocumentBlobs.toArray()
      : await database.activityDocumentBlobs.bulkGet(documents.map((document) => document.id))
    const metadata = scope.mode === 'full' ? await database.metadata.toArray() : []
    return { scope: { ...scope }, snapshotAt: new Date().toISOString(), databaseVersion: database.verno, trips, activities, documents, payloads, metadata }
  })
}
export type ExportSnapshot = Awaited<ReturnType<typeof readExportSnapshot>>

function assertUnique(ids: string[], label: string) {
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error(`Identifiants invalides : ${label}. Export interrompu.`)
}
function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Données numériques invalides. Export interrompu.')
    return item
  }, 2)], { type: 'application/json' })
}
async function sha256(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('La vérification de sauvegarde nécessite un navigateur en HTTPS ou localhost.')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function buildExportArchive(snapshot: ExportSnapshot, onProgress: (message: string) => void = () => {}) {
  const { trips, activities, documents, payloads, metadata } = snapshot
  assertUnique(trips.map((trip) => trip.id), 'voyages')
  assertUnique(activities.map((activity) => activity.id), 'activités')
  assertUnique(documents.map((document) => document.id), 'documents')
  const tripIds = new Set(trips.map((trip) => trip.id))
  const activityIds = new Set(activities.map((activity) => activity.id))
  if (activities.some((activity) => !tripIds.has(activity.tripId)) || documents.some((document) => !activityIds.has(document.activityId))) {
    throw new Error('Des données n’ont plus de parent. Export interrompu pour éviter une sauvegarde incomplète.')
  }
  const transferActivities = new Map(activities.map((activity) => [activity.id, activity]))
  for (const trip of trips) validateTripTransfers(trip.manualTransfers, trip.id, transferActivities)
  const blobs = new Map<string, Blob>()
  for (const payload of payloads) {
    if (!payload || !(payload.blob instanceof Blob) || blobs.has(payload.id)) throw new Error('Un fichier est manquant ou invalide. Export interrompu.')
    blobs.set(payload.id, payload.blob)
  }
  if (blobs.size !== documents.length || Array.from(blobs.keys()).some((id) => !documents.some((document) => document.id === id))) {
    throw new Error('Les fichiers et leurs métadonnées ne correspondent pas. Export interrompu.')
  }
  const entries: ZipEntry[] = []
  const inventory: { path: string; size: number; sha256: string; documentId?: string }[] = []
  async function add(path: string, blob: Blob, documentId?: string) {
    entries.push({ path, blob })
    inventory.push({ path, size: blob.size, sha256: await sha256(blob), ...(documentId ? { documentId } : {}) })
  }
  await add('data/trips.json', jsonBlob(trips))
  await add('data/activities.json', jsonBlob(activities))
  await add('data/documents.json', jsonBlob(documents))
  await add('data/metadata.json', jsonBlob(metadata))
  const extensions = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
  for (const [index, document] of documents.entries()) {
    onProgress(`Vérification des documents : ${index + 1}/${documents.length}`)
    const blob = blobs.get(document.id)!
    if (blob.size !== document.size || blob.size === 0 || (blob.type !== '' && blob.type !== document.mime) ||
      detectDocumentMime(new Uint8Array(await blob.slice(0, 32).arrayBuffer())) !== document.mime) {
      throw new Error(`Le document « ${document.name} » est incomplet ou incohérent. Aucun ZIP produit.`)
    }
    await add(`documents/${String(index + 1).padStart(6, '0')}.${extensions[document.mime]}`, blob, document.id)
  }
  const manifest = {
    format: 'roam-v2-backup', formatVersion: 1, databaseVersion: snapshot.databaseVersion,
    exportedAt: new Date().toISOString(), snapshotAt: snapshot.snapshotAt, scope: snapshot.scope,
    encrypted: false, counts: { trips: trips.length, activities: activities.length, documents: documents.length, metadata: metadata.length },
    inventory,
  }
  onProgress('Création du ZIP…')
  const blob = await createStoredZip([{ path: 'manifest.json', blob: jsonBlob(manifest) }, ...entries])
  const filename = `roam-v2-${snapshot.scope.mode === 'full' ? 'sauvegarde' : 'voyage'}-${manifest.exportedAt.replace(/[:.]/g, '-')}.zip`
  return { blob, filename, manifest }
}

export async function exportBackup(scope: BackupScope, onProgress: (message: string) => void = () => {}, database: RoamDatabase = db) {
  if (exporting) throw new Error('Un export est déjà en cours. Attends sa fin avant de réessayer.')
  const release = beginSensitiveOperation('Un export ZIP est en cours.')
  exporting = true
  try {
    onProgress('Lecture cohérente des données locales…')
    const snapshot = await readExportSnapshot(scope, database)
    onProgress('Vérification de l’intégrité…')
    return await buildExportArchive(snapshot, onProgress)
  } finally { exporting = false; release() }
}
