import { entityKey } from '../sync/model'
import { restoreLineage } from '../sync/restore'
import { withSensitiveOperation } from '../pwa/reloadSafety'
import { db, type RoamDatabase } from '../db/database'
import { validateRestoreArchive, type ValidatedRestore } from './validateRestore'

export type RestoreTripSummary = { id: string; destination: string; state: 'active' | 'archived' | 'trash' }
export type PreparedRestore = { readonly trips: readonly Readonly<RestoreTripSummary>[]; readonly activities: number; readonly documents: number }
export type RestorePreview = {
  readonly importing: readonly Readonly<RestoreTripSummary>[]
  readonly skipped: readonly Readonly<RestoreTripSummary>[]
  readonly activities: number; readonly documents: number
  readonly metadata: number; readonly skippedMetadata: number
}
const preparedData = new WeakMap<PreparedRestore, ValidatedRestore>()
const previewData = new WeakMap<RestorePreview, { prepared: PreparedRestore; database: RoamDatabase; planKey: string }>()
function getData(prepared: PreparedRestore) {
  const data = preparedData.get(prepared)
  if (!data) throw new Error('La sauvegarde doit être intégralement vérifiée avant restauration.')
  return data
}

export async function prepareRestore(archive: Blob, progress: (message: string) => void = () => {}): Promise<PreparedRestore> {
  return withSensitiveOperation('Une sauvegarde est en cours de vérification.', async () => {
    const data = await validateRestoreArchive(archive, progress)
    const prepared: PreparedRestore = Object.freeze({
      trips: Object.freeze(data.trips.map((trip) => Object.freeze({ id: trip.id, destination: trip.destination,
        state: trip.deletedAt !== undefined ? 'trash' as const : trip.archived ? 'archived' as const : 'active' as const }))),
      activities: data.activities.length, documents: data.documents.length,
    })
    // Validated records are private, with immutable Blob slices; the UI receives
    // only a frozen summary and cannot change the checked data before commit.
    preparedData.set(prepared, data)
    return prepared
  })
}

async function planRestore(prepared: PreparedRestore, database: RoamDatabase) {
  const data = getData(prepared)
  const existing = await database.trips.bulkGet(data.trips.map((trip) => trip.id))
  const importing = prepared.trips.filter((_, index) => existing[index] === undefined)
  const skipped = prepared.trips.filter((_, index) => existing[index] !== undefined)
  const tripIds = new Set(importing.map((trip) => trip.id))
  const localSync = data.localSync?.entities.filter((state) => state.deleted ? state.tripId === undefined || !existing.some((trip) => trip?.id === state.tripId) : state.table === 'trips' ? tripIds.has(state.entityId) : tripIds.has(state.tripId!)) ?? []
  for (const state of localSync) {
    const current = await database.syncEntities.get(state.key)
    if (current || state.deleted && await database.table(state.table).get(state.entityId)) throw new Error('Une identité ou suppression locale entre en conflit avec la sauvegarde. Aucun rapprochement automatique effectué.')
  }
  for (const trip of importing) if (await database.syncEntities.get(entityKey('trips', trip.id))) throw new Error('Ce voyage possède déjà une identité locale ou une suppression en attente. Aucun rapprochement automatique effectué.')
  const activities = data.activities.filter((activity) => tripIds.has(activity.tripId))
  const activityIds = new Set(activities.map((activity) => activity.id))
  const documents = data.documents.filter((document) => activityIds.has(document.activityId))
  const ids = documents.map((document) => document.id)
  const childStates = await database.syncEntities.bulkGet([
    ...activities.map((activity) => entityKey('activities', activity.id)),
    ...ids.flatMap((id) => [entityKey('activityDocuments', id), entityKey('activityDocumentBlobs', id)]),
  ])
  if (childStates.some(Boolean)) throw new Error('Une activité ou un document possède déjà une identité locale ou une suppression en attente. Aucun rapprochement automatique effectué.')
  const [usedActivities, usedDocuments, usedBlobs, metadata] = await Promise.all([
    database.activities.where('id').anyOf(activities.map((activity) => activity.id)).primaryKeys(),
    database.activityDocuments.where('id').anyOf(ids).primaryKeys(), database.activityDocumentBlobs.where('id').anyOf(ids).primaryKeys(),
    database.metadata.bulkGet(data.metadata.map((item) => item.key)),
  ])
  if (usedActivities.length > 0 || usedDocuments.length > 0 || usedBlobs.length > 0) throw new Error('Un identifiant d’activité ou de document à importer est déjà utilisé localement. Aucun import effectué.')
  const metadataKeys = data.metadata.filter((_, index) => metadata[index] === undefined).map((item) => item.key)
  const preview: RestorePreview = Object.freeze({ importing: Object.freeze(importing), skipped: Object.freeze(skipped),
    activities: activities.length, documents: documents.length, metadata: metadataKeys.length, skippedMetadata: data.metadata.length - metadataKeys.length })
  const planKey = JSON.stringify({ importing: importing.map((trip) => trip.id).sort(), skipped: skipped.map((trip) => trip.id).sort(), metadata: [...metadataKeys].sort() })
  return { localSync, preview, planKey, tripIds, activities, activityIds, documents, metadataKeys }
}

export async function previewRestore(prepared: PreparedRestore, database: RoamDatabase = db): Promise<RestorePreview> {
  const plan = await database.transaction('r', database.tables, () => planRestore(prepared, database))
  previewData.set(plan.preview, { prepared, database, planKey: plan.planKey })
  return plan.preview
}

export async function restoreBackup(prepared: PreparedRestore, confirmedPreview: RestorePreview, database: RoamDatabase = db) {
  const confirmed = previewData.get(confirmedPreview)
  if (!confirmed || confirmed.prepared !== prepared || confirmed.database !== database) throw new Error('Un aperçu confirmé de cette sauvegarde est nécessaire.')
  const data = getData(prepared)
  return withSensitiveOperation('Une restauration ZIP est en cours.', () => database.transaction('rw', database.tables, async () => {
    const plan = await planRestore(prepared, database)
    if (plan.planKey !== confirmed.planKey) throw new Error('Les conflits locaux ont changé depuis l’aperçu. Actualise l’aperçu et confirme à nouveau ; aucune donnée importée.')
    await restoreLineage(database, plan.localSync)
    // add/bulkAdd only: never put, update, clear or delete local records.
    await database.trips.bulkAdd(data.trips.filter((trip) => plan.tripIds.has(trip.id)))
    await database.activities.bulkAdd(plan.activities)
    await database.activityDocuments.bulkAdd(plan.documents)
    const documentIds = new Set(plan.documents.map((document) => document.id))
    await database.activityDocumentBlobs.bulkAdd(data.payloads.filter((payload) => documentIds.has(payload.id)))
    const metadataKeys = new Set(plan.metadataKeys)
    await database.table('metadata').bulkAdd(data.metadata.filter((item) => metadataKeys.has(item.key)))
    return { importedTrips: plan.preview.importing.length, skippedTrips: plan.preview.skipped.length,
      activities: plan.activities.length, documents: plan.documents.length,
      metadata: plan.metadataKeys.length, skippedMetadata: plan.preview.skippedMetadata }
  }))
}
