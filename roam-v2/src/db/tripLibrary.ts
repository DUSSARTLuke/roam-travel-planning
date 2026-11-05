import { db, type RoamDatabase } from './database'
import { compareActivities } from './activityModel'
// A single consistent snapshot of activities + metadata. Never read the Blob store.
export function createTripLibraryReader(database: RoamDatabase = db) {
  return async (tripId: string) => database.transaction('r', [database.trips, database.activities, database.activityDocuments], async () => {
    const trip = await database.trips.get(tripId)
    if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Ce voyage est inaccessible. Restaure-le avant de consulter cet espace.')
    const activities = (await database.activities.where('tripId').equals(tripId).toArray()).sort(compareActivities)
    const documents = activities.length ? await database.activityDocuments.where('activityId').anyOf(activities.map((activity) => activity.id)).toArray() : []
    return { activities, documents }
  })
}
export const readTripLibrary = createTripLibraryReader()
