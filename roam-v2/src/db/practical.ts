import { db, type RoamDatabase } from './database'
import { createId } from '../utils/createId'
import { withSensitiveOperation } from '../pwa/reloadSafety'
import { validatePracticalRecords, normalizePracticalInput, MAX_PRACTICAL_RECORDS, type PracticalInput, type PracticalRecord } from '../practical/model'
export function copyPracticalRecords(value: unknown) {
  if (value === undefined) return {}
  const now = new Date().toISOString()
  return { practicalRecords: validatePracticalRecords(value, { allowInvalidContacts: true }).map((record) => ({ ...record, id: createId(), createdAt: now, updatedAt: now })) }
}
export function createPracticalRepository(database: RoamDatabase = db) {
  async function parent(tripId: string) {
    const trip = await database.trips.get(tripId)
    if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Ce voyage est inaccessible. Restaure-le pour accéder à son carnet pratique.')
    return trip
  }
  function existing(records: PracticalRecord[], id: string, expected: string) {
    const record = records.find((item) => item.id === id)
    if (!record || JSON.stringify(record) !== expected) throw new Error('Cette fiche a changé ou a été supprimée dans un autre onglet. Ferme puis rouvre sa modification ; ta saisie est conservée.')
    return record
  }
  return {
    async read(tripId: string) {
      return database.transaction('r', database.trips, database.activities, async () => {
        const trip = await parent(tripId)
        return { trip, records: validatePracticalRecords(trip.practicalRecords, { allowInvalidContacts: true }), activities: await database.activities.where('tripId').equals(tripId).toArray() }
      })
    },
    async save(tripId: string, input: PracticalInput, id?: string, expected?: string) {
      const fields = normalizePracticalInput(input)
      return withSensitiveOperation('Enregistrement du carnet pratique.', () => database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId), records = validatePracticalRecords(trip.practicalRecords, { allowInvalidContacts: true })
        const old = id === undefined ? undefined : existing(records, id, expected ?? '')
        if (old && old.kind !== fields.kind) throw new Error('Le type d’une fiche existante ne peut pas être changé. Crée une nouvelle fiche pour changer de type.')
        if (!old && records.length >= MAX_PRACTICAL_RECORDS) throw new Error('Le carnet est limité à 300 fiches.')
        const now = new Date().toISOString()
        const record = validatePracticalRecords([{ ...fields, id: old?.id ?? createId(), createdAt: old?.createdAt ?? now, updatedAt: now }])[0]
        await database.trips.update(tripId, { practicalRecords: old ? records.map((item) => item.id === id ? record : item) : [...records, record] })
        return record
      }))
    },
    async remove(tripId: string, id: string, expected: string) {
      return withSensitiveOperation('Suppression d’une fiche pratique.', () => database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId), records = validatePracticalRecords(trip.practicalRecords, { allowInvalidContacts: true })
        existing(records, id, expected)
        await database.trips.update(tripId, { practicalRecords: records.filter((record) => record.id !== id) })
      }))
    },
  }
}
export const practicalRepository = createPracticalRepository()
