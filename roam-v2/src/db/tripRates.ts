import { db, type RoamDatabase, type Trip } from './database'
import { tripReferenceCurrency, validateCurrency } from './currency'
import { mergeManualRates, validateManualRates, type ManualExchangeRate } from '../money/manualRates'

export type TripEditableFields = Omit<Trip, 'id' | 'archived' | 'deletedAt' | 'manualExchangeRates' | 'automaticExchangeRates'>
export async function saveTripWithRates(id: string, fields: TripEditableFields, baseline: readonly ManualExchangeRate[], desired: readonly ManualExchangeRate[], database: RoamDatabase = db, originalFields?: TripEditableFields): Promise<void> {
  const before = validateManualRates(baseline)
  const after = validateManualRates(desired)
  await database.transaction('rw', database.trips, async () => {
    const latest = await database.trips.get(id)
    if (!latest) throw new Error('Ce voyage est introuvable.')
    if (latest.deletedAt !== undefined) throw new Error('Restaure le voyage avant de le modifier.')
    const rates = mergeManualRates(before, after, validateManualRates(latest.manualExchangeRates))
    const patch: Partial<TripEditableFields> = {}
    const keys = ['destination', 'country', 'startDate', 'endDate', 'travelers', 'image', 'referenceCurrency'] as const
    for (const key of keys) {
      if (originalFields && fields[key] === originalFields[key]) continue
      const current = key === 'referenceCurrency' ? tripReferenceCurrency(latest) : latest[key]
      if (originalFields && current !== originalFields[key]) throw new Error('Les informations du voyage ont changé dans un autre onglet. Ferme puis rouvre le formulaire après avoir conservé tes saisies.')
      Object.assign(patch, { [key]: fields[key] })
    }
    const combined = { ...latest, ...patch }
    if (combined.endDate < combined.startDate) throw new Error('Les dates du voyage ont changé : vérifie les dates de départ et de retour.')
    if (combined.referenceCurrency !== undefined) validateCurrency(combined.referenceCurrency)
    // Patch only editable fields and the merged rates; never put a stale trip.
    await database.trips.update(id, { ...patch, ...(latest.manualExchangeRates !== undefined || rates.length ? { manualExchangeRates: rates } : {}) })
  })
}
