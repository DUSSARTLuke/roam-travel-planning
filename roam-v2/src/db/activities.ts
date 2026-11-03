import { db, type RoamDatabase } from './database'
import { compareActivities, isActivityDate, validateActivity, type TripActivity, type TripActivityInput } from './activityModel'

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
        const activity: TripActivity = { ...fields, id: crypto.randomUUID(), tripId, createdAt: timestamp, updatedAt: timestamp }
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

    // Replace editable fields as a complete coherent input, not a partial patch
    // that could leave obsolete times when switching schedule modes.
    async updateActivity(tripId: string, id: string, input: TripActivityInput): Promise<TripActivity> {
      const fields = validateActivity(input)
      return database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        const existing = await requireActivity(tripId, id)
        const activity: TripActivity = { ...fields, id: existing.id, tripId: existing.tripId,
          createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
        await database.activities.put(activity)
        return activity
      })
    },

    async deleteActivity(tripId: string, id: string): Promise<void> {
      await database.transaction('rw', database.trips, database.activities, async () => {
        await requireParent(tripId, true)
        await requireActivity(tripId, id)
        await database.activities.delete(id)
      })
    },
  }
}

export const { createActivity, getActivity, listActivities, updateActivity, deleteActivity } = createActivityRepository()
