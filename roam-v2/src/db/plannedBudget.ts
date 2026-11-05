import { db, type RoamDatabase } from './database'
import { validatePlannedBudget, type PlannedBudget } from '../money/budgetTracking'
import { withSensitiveOperation } from '../pwa/reloadSafety'
export async function savePlannedBudget(tripId: string, value: PlannedBudget | undefined, expected: string, database: RoamDatabase = db) {
  const plannedBudget = validatePlannedBudget(value)
  return withSensitiveOperation('Enregistrement du budget prévisionnel.', () => database.transaction('rw', database.trips, async () => {
    const trip = await database.trips.get(tripId)
    if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Ce voyage est inaccessible. Restaure-le avant de modifier son budget.')
    if (JSON.stringify(trip.plannedBudget ?? null) !== expected) throw new Error('Le prévisionnel a changé dans un autre onglet. Annule puis rouvre le formulaire ; ta saisie est conservée.')
    await database.trips.update(tripId, { plannedBudget })
  }))
}
