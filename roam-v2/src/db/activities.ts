import { createId } from '../utils/createId'
import { reorderActivities, schedulingKey, type OrderDirection } from './activityOrganization'
import { validateCoordinates } from './activityLocation'
import { db, type RoamDatabase } from './database'
import { advancedActivityKeys, compareActivities, isActivityDate, validateActivity, type TripActivity, type TripActivityInput } from './activityModel'

// All operations verify the parent within the same transaction as their read
// or write. Including trips serializes writes against permanent trip deletion.
// Reads include trashed trips; writes require restoring the parent first.
export function createActivityRepository(database: RoamDatabase = db) {
  async function requireParent(tripId: string, writable: boolean) {
    if (typeof tripId !== 'string' || !tripId.trim()) throw new Error('Identifiant du voyage invalide.')
    const trip = await database.trips.get(tripId)
    if (!trip) throw new Error('Le voyage parent est introuvable.')
    if (writable && trip.deletedAt !== undefined) throw new Error('Restaure le voyage avant de modifier ses activités.')
  }

  async function requireActivity(tripId: string, id: string): Promise<TripActivity> {
    if (typeof id !== 'string' || !id.trim()) throw new Error("Identifiant de l'activité invalide.")
    const activity = await database.activities.get(id)
    if (!activity || activity.tripId !== tripId) throw new Error('Activité introuvable pour ce voyage.')
    return activity
  }

  return {
    async createActivity(tripId: string, input: TripActivityInput): Promise<TripActivity> {
      const fields = validateActivity(input)
      return database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        const timestamp = new Date().toISOString()
        const activity: TripActivity = { ...fields, id: createId(), tripId, createdAt: timestamp, updatedAt: timestamp }
        await database.activities.add(activity)
        return activity
      })
    },

    async getActivity(tripId: string, id: string): Promise<TripActivity> {
      return database.transaction('r', database.trips, database.activities, async () => {
        await requireParent(tripId, false)
        return requireActivity(tripId, id)
      })
    },

    // undefined: all activities, null: ideas, YYYY-MM-DD: one local day.
    async listActivities(tripId: string, date?: string | null): Promise<TripActivity[]> {
      if (date !== undefined && date !== null && !isActivityDate(date)) throw new Error('Date de recherche invalide.')
      return database.transaction('r', database.trips, database.activities, async () => {
        await requireParent(tripId, false)
        const activities = typeof date === 'string'
          ? await database.activities.where('[tripId+date]').equals([tripId, date]).toArray()
          : await database.activities.where('tripId').equals(tripId).toArray()
        return (date === null ? activities.filter((activity) => activity.date === null) : activities).sort(compareActivities)
      })
    },

    // Replace the quick fields as a coherent input to remove obsolete times.
    // Omitted optional advanced fields are retained; explicit undefined clears them.
    async updateActivity(tripId: string, id: string, input: TripActivityInput): Promise<TripActivity> {
      if (Object.hasOwn(input, 'latitude') || Object.hasOwn(input, 'longitude')) validateCoordinates(input.latitude, input.longitude)
      return database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        const existing = await requireActivity(tripId, id)
        // Omitted advanced fields survive partial callers; explicit undefined clears them.
        const preserved = Object.fromEntries(advancedActivityKeys
          .filter((key) => !Object.hasOwn(input, key)).map((key) => [key, existing[key]]))
        const fields = validateActivity({ ...preserved, ...input }, existing)
        const activity: TripActivity = { ...fields, id: existing.id, tripId: existing.tripId,
          createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
        await database.activities.put(activity)
        return activity
      })
    },

    // Narrow updates read the latest record and retain every unrelated field.
    async organizeActivity(tripId: string, id: string, change: { date: string | null } | { startTime: string; endTime?: string } | { unscheduled: true }, expected: string): Promise<TripActivity> {
      return database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        const trip = await database.trips.get(tripId)
        if (trip?.archived) throw new Error('Restaure le voyage avant de modifier ses activités.')
        const existing = await requireActivity(tripId, id)
        if (schedulingKey(existing) !== expected) throw new Error('La planification a changé dans un autre onglet. Ferme puis rouvre cette action.')
        const candidate = { ...existing }
        if ('date' in change) candidate.date = change.date
        else {
          delete candidate.startTime
          delete candidate.endTime
          Object.assign(candidate, 'unscheduled' in change
            ? { scheduleType: 'unscheduled', period: null }
            : { scheduleType: 'exact', period: null, startTime: change.startTime, ...(change.endTime ? { endTime: change.endTime } : {}) })
        }
        validateActivity(candidate, existing)
        candidate.updatedAt = new Date().toISOString()
        await database.activities.put(candidate)
        return candidate
      })
    },

    async reorderActivity(tripId: string, id: string, direction: OrderDirection): Promise<void> {
      if (direction !== 'up' && direction !== 'down') throw new Error('Direction invalide.')
      await database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        const trip = await database.trips.get(tripId)
        if (trip?.archived) throw new Error('Restaure le voyage avant de modifier ses activités.')
        const existing = await requireActivity(tripId, id)
        if (existing.scheduleType === 'exact') throw new Error('Seules les activités sans heure précise peuvent être réordonnées.')
        const group = (await database.activities.where('tripId').equals(tripId).toArray())
          .filter((item) => item.date === existing.date && item.scheduleType !== 'exact')
        const changes = reorderActivities(group, id, direction)
        const updatedAt = new Date().toISOString()
        for (const change of changes) await database.activities.update(change.id, { sortOrder: change.sortOrder, updatedAt })
      })
    },

    async deleteActivity(tripId: string, id: string): Promise<void> {
      await database.transaction('rw', [database.trips, database.activities, database.activityDocuments, database.activityDocumentBlobs], async () => {
        await requireParent(tripId, true)
        await requireActivity(tripId, id)
        const documentIds = await database.activityDocuments.where('activityId').equals(id).primaryKeys()
        await database.activityDocumentBlobs.bulkDelete(documentIds)
        await database.activityDocuments.bulkDelete(documentIds)
        // Explicit cascade: permanent activity deletion also removes its links.
        // trips belongs to this transaction, so no orphan or partial deletion.
        const trip = await database.trips.get(tripId)
        if (trip?.expenseShares) {
          const removedTransfers = new Set((trip.manualTransfers ?? []).filter((item) => item.fromActivityId === id || item.toActivityId === id).map((item) => item.id))
          await database.trips.update(tripId, { expenseShares: trip.expenseShares.filter((item) => item.kind === 'activity' ? item.expenseId !== id : !removedTransfers.has(item.expenseId)) })
        }
        if (trip?.manualTransfers?.some((item) => item.fromActivityId === id || item.toActivityId === id)) {
          await database.trips.update(tripId, { manualTransfers: trip.manualTransfers.filter((item) => item.fromActivityId !== id && item.toActivityId !== id) })
        }
        await database.activities.delete(id)
      })
    },
  }
}

export const { createActivity, getActivity, listActivities, updateActivity, organizeActivity, reorderActivity, deleteActivity } = createActivityRepository()
