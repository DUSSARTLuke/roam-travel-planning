import { ActivityEditConflict, type ActivityRevision } from './activityRevision'
import { createId } from '../utils/createId'
import { db, type RoamDatabase } from './database'
import { createActivityRepository } from './activities'
import type { TripActivityInput } from './activityModel'
import { MAX_ACTIVITY_DOCUMENTS, detectDocumentMime, prepareDocuments, type ActivityDocument, type PreparedDocument } from './documentModel'

function storageFailure(error: unknown, subject = 'les documents'): never {
  const failure = error as { name?: string; inner?: { name?: string }; failures?: { name?: string }[] } | null
  const names = [failure?.name, failure?.inner?.name,
    ...(Array.isArray(failure?.failures) ? failure.failures.map((item) => item?.name) : [])]
  let message: string
  if (names.includes('QuotaExceededError')) {
    message = 'Espace de stockage local insuffisant. Aucun changement enregistré ; tes saisies et fichiers restent en attente.'
  } else if (error instanceof ActivityEditConflict || error instanceof Error && error.name === 'Error') {
    // Business validation errors stay readable and are never reclassified as I/O.
    throw error
  } else if (names.includes('PrematureCommitError') || names.includes('TransactionInactiveError')) {
    // A premature commit cannot honestly be described as a confirmed rollback.
    message = 'La transaction de stockage s’est terminée trop tôt. Vérifie la liste des activités avant de réessayer ; tes saisies sont conservées.'
  } else if (names.includes('SecurityError') || names.includes('InvalidStateError') || names.includes('OpenFailedError')) {
    message = `Le navigateur refuse ou ne permet pas l’accès au stockage local pour ${subject}. Aucun changement enregistré ; vérifie ses autorisations et réessaie.`
  } else if (names.includes('NotReadableError')) {
    message = 'Un fichier sélectionné ne peut pas être lu. Aucun changement enregistré ; sélectionne-le à nouveau.'
  } else {
    const code = typeof failure?.name === 'string' ? ` (${failure.name})` : ''
    message = `Impossible d’enregistrer ${subject} dans le stockage local${code}. Aucun changement enregistré ; tes saisies sont conservées.`
  }
  // Keep the original exception/stack and Dexie inner error for diagnostics.
  throw new Error(message, { cause: error })
}

export function createDocumentRepository(database: RoamDatabase = db) {
  const activityRepository = createActivityRepository(database)
  const writeTables = [database.trips, database.activities, database.activityDocuments, database.activityDocumentBlobs]

  async function requireAccess(tripId: string, activityId: string, writable: boolean) {
    const trip = await database.trips.get(tripId)
    const activity = await database.activities.get(activityId)
    if (!trip || !activity || activity.tripId !== tripId) throw new Error('Activité inaccessible pour ce voyage.')
    if (writable && (trip.deletedAt !== undefined || trip.archived)) throw new Error('Restaure le voyage avant de modifier ses documents.')
  }

  async function store(activityId: string, prepared: PreparedDocument[]): Promise<ActivityDocument[]> {
    if (prepared.length === 0) return []
    const count = await database.activityDocuments.where('activityId').equals(activityId).count()
    if (count + prepared.length > MAX_ACTIVITY_DOCUMENTS) throw new Error('Maximum 5 documents par activité. Aucun document importé ; tes saisies sont conservées.')
    const importedAt = new Date().toISOString()
    const metadata = prepared.map(({ name, mime, size }) => ({ id: createId(), activityId, name, mime, size, importedAt }))
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
      }).catch((error) => storageFailure(error))
    },

    async importDocuments(tripId: string, activityId: string, files: readonly File[]): Promise<ActivityDocument[]> {
      const prepared = await prepareDocuments(files)
      return database.transaction('rw', writeTables, async () => {
        await requireAccess(tripId, activityId, true)
        return store(activityId, prepared)
      }).catch((error) => storageFailure(error))
    },

    // Activity changes and documents commit together, or both roll back. The
    // nested activity repository transactions reuse this wider transaction.
    async saveActivityWithDocuments(tripId: string, input: TripActivityInput, activityId: string | null, files: readonly File[], expected?: ActivityRevision) {
      const subject = files.length ? 'l’activité et ses documents' : 'l’activité'
      // File reads remain outside IDB; an empty selection never touches the
      // document stores. Existing attachments are kept, not rewritten.
      const prepared = await prepareDocuments(files).catch((error) => storageFailure(error, subject))
      const tables = prepared.length ? writeTables : [database.trips, database.activities]
      return database.transaction('rw', tables, async () => {
        const activity = activityId !== null
          ? await activityRepository.updateActivity(tripId, activityId, input, expected)
          : await activityRepository.createActivity(tripId, input)
        if (prepared.length) await store(activity.id, prepared)
        return activity
      }).catch((error) => storageFailure(error, subject))
    },
  }
}

export const { listDocuments, getDocument, deleteDocument, importDocuments, saveActivityWithDocuments } = createDocumentRepository()
