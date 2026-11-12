import { validateActivityParticipants } from '../db/activityParticipants'
import { validateParticipants } from '../money/expenseSharing'
import { validateV6Graph } from '../evolution/v21/graph'
import { validateSyncLineage } from '../sync/backup'
import { validatePracticalRecords } from '../practical/model'
import { validateReservationType } from '../db/activityModel'
import { validatePreparationTasks } from '../preparation/tasks'
import { validatePlannedBudget } from '../money/budgetTracking'
import { validateTripSharing } from '../money/expenseSharing'
import { sha256 } from './sha256'
import { validateTripTransfers } from '../db/transferModel'
import { beginSensitiveOperation } from '../pwa/reloadSafety'
import { db, type RoamDatabase } from '../db/database'
import { detectDocumentMime } from '../db/documentModel'
import { createStoredZip, type ZipEntry } from './zip'

export type BackupScope = { mode: 'full' } | { mode: 'trip'; tripId: string }
let exporting = false

export async function readExportSnapshot(scope: BackupScope, database: RoamDatabase = db) {
  return database.transaction('r', [database.trips, database.activities, database.metadata, database.activityDocuments, database.activityDocumentBlobs, database.syncEntities, database.journeys, database.accommodations], async () => {
    const trips = scope.mode === 'full' ? await database.trips.toArray() : await database.trips.where('id').equals(scope.tripId).toArray()
    if (scope.mode === 'trip' && trips.length !== 1) throw new Error('Le voyage à exporter est introuvable.')
    const activities = scope.mode === 'full' ? await database.activities.toArray() : await database.activities.where('tripId').equals(trips[0].id).toArray()
    const documents = scope.mode === 'full' ? await database.activityDocuments.toArray()
      : await database.activityDocuments.filter(document => document.tripId === scope.tripId || activities.some(activity => activity.id === document.activityId)).toArray()
    const payloads = scope.mode === 'full' ? await database.activityDocumentBlobs.toArray()
      : await database.activityDocumentBlobs.bulkGet(documents.map((document) => document.id))
    const metadata = scope.mode === 'full' ? await database.metadata.toArray() : []
    const sync = (await database.syncEntities.toArray()).filter((state) => scope.mode === 'full' || state.tripId === scope.tripId)
    const journeys = scope.mode === 'full' ? await database.journeys.toArray() : await database.journeys.where('tripId').equals(scope.tripId).toArray()
    const accommodations = scope.mode === 'full' ? await database.accommodations.toArray() : await database.accommodations.where('tripId').equals(scope.tripId).toArray()
    return { journeys, accommodations, sync, scope: { ...scope }, snapshotAt: new Date().toISOString(), databaseVersion: database.verno, trips, activities, documents, payloads, metadata }
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


export async function buildExportArchive(snapshot: ExportSnapshot, onProgress: (message: string) => void = () => {}) {
  const { activities, payloads, metadata } = snapshot
  const journeys = snapshot.journeys ?? [], accommodations = snapshot.accommodations ?? []
  const trips: import('../db/database').Trip[] = snapshot.databaseVersion >= 6 ? snapshot.trips.map(({ manualTransfers: _projection, ...trip }) => trip) : snapshot.trips
  const documents = snapshot.documents.map(document => ({ ...document, tripId: document.tripId ?? activities.find(a => a.id === document.activityId)?.tripId, owner: document.owner ?? {kind: 'activity' as const, id: document.activityId!} }))
  const isV6 = snapshot.databaseVersion >= 6
  if (![4,5,6].includes(snapshot.databaseVersion) || (!isV6 && (journeys.length || accommodations.length))) throw new Error('Schéma de sauvegarde incohérent ; aucune archive produite.')
  if (isV6) for (const trip of snapshot.trips) validateTripTransfers(trip.manualTransfers, trip.id, new Map(activities.map(activity => [activity.id, activity])))
  if (isV6) validateV6Graph(trips, activities, journeys, accommodations, documents)
  assertUnique(trips.map((trip) => trip.id), 'voyages')
  assertUnique(activities.map((activity) => activity.id), 'activités')
  assertUnique(documents.map((document) => document.id), 'documents')
  const tripIds = new Set(trips.map((trip) => trip.id))
  const activityIds = new Set(activities.map((activity) => activity.id))
  if (activities.some((activity) => !tripIds.has(activity.tripId)) || documents.some((document) => document.owner.kind === 'activity' && !activityIds.has(document.owner.id))) {
    throw new Error('Des données n’ont plus de parent. Export interrompu pour éviter une sauvegarde incomplète.')
  }
  for (const activity of activities) {
    validateReservationType(activity.reservationType)
    validateActivityParticipants(activity.participantIds, validateParticipants(trips.find(trip => trip.id === activity.tripId)?.participants))
  }
  const transferActivities = new Map(activities.map((activity) => [activity.id, activity]))
  for (const trip of trips) { if (!isV6) { validateTripTransfers(trip.manualTransfers, trip.id, transferActivities); validateTripSharing(trip, transferActivities) }; validatePlannedBudget(trip.plannedBudget); validatePreparationTasks(trip.preparationTasks); validatePracticalRecords(trip.practicalRecords) }
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
  if (isV6) { await add('data/journeys.json', jsonBlob(journeys)); await add('data/accommodations.json', jsonBlob(accommodations)) }
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
  const localSync = 'sync' in snapshot ? validateSyncLineage({ version: 1, entities: snapshot.sync }, { trips, activities, documents, journeys, accommodations }, snapshot.scope) : undefined
  const manifest = {
    ...(localSync ? { localSync } : {}),
    format: 'roam-v2-backup', formatVersion: isV6 ? 2 : 1, databaseVersion: snapshot.databaseVersion,
    exportedAt: new Date().toISOString(), snapshotAt: snapshot.snapshotAt, scope: snapshot.scope,
    encrypted: false, counts: { trips: trips.length, activities: activities.length, documents: documents.length, metadata: metadata.length, ...(isV6 ? {journeys: journeys.length, accommodations: accommodations.length} : {}) },
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
