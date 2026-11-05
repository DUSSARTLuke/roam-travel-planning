import { createId } from '../utils/createId'
import { db, type RoamDatabase } from './database'
import { transferKey, validateTransferInput, type TransferInput, type ManualTransfer } from './transferModel'

export function createTransferRepository(database: RoamDatabase = db) {
  async function parent(tripId: string) {
    const trip = await database.trips.get(tripId)
    if (!trip) throw new Error('Voyage introuvable.')
    if (trip.archived || trip.deletedAt !== undefined) throw new Error('Restaure le voyage avant de modifier ses déplacements.')
    return trip
  }
  return {
    async saveTransfer(tripId: string, input: TransferInput, id?: string, expected?: string): Promise<ManualTransfer> {
      const fields = validateTransferInput(input)
      return database.transaction('rw', database.trips, database.activities, async () => {
        const trip = await parent(tripId)
        const transfers = trip.manualTransfers ?? []
        const existing = id === undefined ? undefined : transfers.find((item) => item.id === id)
        if (id !== undefined && (!existing || transferKey(existing) !== expected)) throw new Error('Ce déplacement a changé ou a été supprimé. Ferme puis rouvre le formulaire.')
        if (!existing && transfers.length >= 10000) throw new Error('La limite de déplacements de ce voyage est atteinte.')
        const from = await database.activities.get(fields.fromActivityId)
        const to = await database.activities.get(fields.toActivityId)
        if (!from || !to || from.tripId !== tripId || to.tripId !== tripId) throw new Error('Choisis deux activités existantes de ce voyage.')
        if (from.date === null || from.date !== to.date) throw new Error('Les activités doivent appartenir à la même journée datée.')
        const now = new Date().toISOString()
        const transfer = { ...fields, ...(!Object.hasOwn(input, 'paidAmount') && existing?.paidAmount !== undefined ? { paidAmount: existing.paidAmount } : {}), id: existing?.id ?? createId(), createdAt: existing?.createdAt ?? now, updatedAt: now }
        await database.trips.update(tripId, { manualTransfers: existing ? transfers.map((item) => item.id === id ? transfer : item) : [...transfers, transfer] })
        return transfer
      })
    },
    async deleteTransfer(tripId: string, id: string, expected: string): Promise<void> {
      await database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId)
        const existing = trip.manualTransfers?.find((item) => item.id === id)
        if (!existing || transferKey(existing) !== expected) throw new Error('Ce déplacement a changé ou a été supprimé. Actualise la fiche.')
        await database.trips.update(tripId, { manualTransfers: trip.manualTransfers!.filter((item) => item.id !== id), ...(trip.expenseShares ? { expenseShares: trip.expenseShares.filter((item) => item.kind !== 'transfer' || item.expenseId !== id) } : {}) })
      })
    },
  }
}
export const { saveTransfer, deleteTransfer } = createTransferRepository()
