import { db, type RoamDatabase } from './database'
import { createActivityRepository } from './activities'
import type { TripActivityInput } from './activityModel'
import { MAX_ACTIVITY_DOCUMENTS, detectDocumentMime, prepareDocuments, type ActivityDocument, type PreparedDocument } from './documentModel'

function storageFailure(error: unknown): never {
  const failure = error as { name?: string; failures?: { name?: string }[] }
  if (failure?.name === 'QuotaExceededError' || failure?.failures?.some((item) => item.name === 'QuotaExceededError')) {
    throw new Error('Espace de stockage local insuffisant. Aucun changement enregistré ; tes saisies et fichiers restent en attente.')
  }
  if (error instanceof Error && error.name === 'Error') throw error
  throw new Error('Impossible d’enregistrer les documents dans le stockage local. Aucun changement enregistré ; réessaie.')
}

export function createDocumentRepository(database: RoamDatabase = db) {
  const activityRepository = createActivityRepository(database)
  const writeTables = [database.trips, database.activities, database.activityDocuments, database.activityDocumentBlobs]

  async function requireAccess(tripId: string, activityId: string, writable: boolean) {
    const trip = await database.trips.get(tripId)
    const activity = await database.activities.get(activityId)
    if (!trip || !activity || activity.tripId !== tripId) throw new Error('Activité inaccessible pour ce voyage.')
    if (writable && trip.deletedAt !== undefined) throw new Error('Restaure le voyage avant de modifier ses documents.')
  }

  async function store(activityId: string, prepared: PreparedDocument[]): Promise<ActivityDocument[]> {
    const count = await database.activityDocuments.where('activityId').equals(activityId).count()
    if (count + prepared.length > MAX_ACTIVITY_DOCUMENTS) throw new Error('Maximum 5 documents par activité. Aucun document importé ; tes saisies sont conservées.')
    const importedAt = new Date().toISOString()
    const metadata = prepared.map(({ name, mime, size }) => ({ id: crypto.randomUUID(), activityId, name, mime, size, importedAt }))
    await database.activityDocuments.bulkAdd(metadata)
    await database.activityDocumentBlobs.bulkAdd(metadata.map((document, index) => ({ id: document.id, blob: prepared[index].blob })))
    return metadata
  }

  return {
    // This read transaction deliberately excludes the Blob store.
    async listDocuments(tripId: string, activityId: string): Promise<ActivityDocument[]> {
      return database.transaction('r', [database.trips, database.activities, database.activityDocuments], async () => {
        await requireAccess(tripId, activityId, false)
        return (await database.activityDocuments.where('activityId').equals(activityId).toArray())
          .sort((a, b) => a.importedAt.localeCompare(b.importedAt) || a.id.localeCompare(b.id))
      })
    },

    async getDocument(tripId: string, activityId: string, id: string) {
      const stored = await database.transaction('r', writeTables, async () => {
        await requireAccess(tripId, activityId, false)
        const metadata = await database.activityDocuments.get(id)
        if (!metadata || metadata.activityId !== activityId) throw new Error('Document supprimé ou inaccessible pour cette activité.')
        const payload = await database.activityDocumentBlobs.get(id)
        if (!payload || !(payload.blob instanceof Blob)) throw new Error('Le fichier est manquant dans le stockage local.')
        return { metadata, blob: payload.blob }
      })
      const mime = detectDocumentMime(new Uint8Array(await stored.blob.slice(0, 32).arrayBuffer()))
      if (mime !== stored.metadata.mime || stored.blob.size !== stored.metadata.size) throw new Error('Le fichier est endommagé ou son format ne correspond pas aux métadonnées.')
      return { metadata: stored.metadata, blob: stored.blob.slice(0, stored.blob.size, stored.metadata.mime) }
    },

    async deleteDocument(tripId: string, activityId: string, id: string): Promise<void> {
      await database.transaction('rw', writeTables, async () => {
        await requireAccess(tripId, activityId, true)
        const metadata = await database.activityDocuments.get(id)
        if (!metadata || metadata.activityId !== activityId) throw new Error('Document supprimé ou inaccessible pour cette activité.')
        await database.activityDocumentBlobs.delete(id)
        await database.activityDocuments.delete(id)
      }).catch(storageFailure)
    },

    async importDocuments(tripId: string, activityId: string, files: readonly File[]): Promise<ActivityDocument[]> {
      const prepared = await prepareDocuments(files)
      return database.transaction('rw', writeTables, async () => {
        await requireAccess(tripId, activityId, true)
        return store(activityId, prepared)
      }).catch(storageFailure)
    },

    // Activity changes and documents commit together, or both roll back. The
    // nested activity repository transactions reuse this wider transaction.
    async saveActivityWithDocuments(tripId: string, input: TripActivityInput, activityId: string | null, files: readonly File[]) {
      const prepared = await prepareDocuments(files)
      return database.transaction('rw', writeTables, async () => {
        if (activityId !== null) await requireAccess(tripId, activityId, true)
        const activity = activityId !== null
          ? await activityRepository.updateActivity(tripId, activityId, input)
          : await activityRepository.createActivity(tripId, input)
        await store(activity.id, prepared)
        return activity
      }).catch(storageFailure)
    },
  }
}

export const { listDocuments, getDocument, deleteDocument, importDocuments, saveActivityWithDocuments } = createDocumentRepository()
