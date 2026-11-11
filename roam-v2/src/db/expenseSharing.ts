import { refreshLegacyProjection } from '../evolution/v21/projection'
import { readLegacyTransfers } from './transfers'
import { db, type RoamDatabase } from './database'
import { createId } from '../utils/createId'
import { withSensitiveOperation } from '../pwa/reloadSafety'
import { validateCurrency } from './currency'
import { expenseReferenceKey, participantName, sharingVersion, validateParticipants, validateExpenseShares, type ExpenseReference, type ExpenseShare } from '../money/expenseSharing'

export function createExpenseSharingRepository(database: RoamDatabase = db) {
  async function parent(tripId: string) {
    const trip = await database.trips.get(tripId)
    if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Ce voyage est inaccessible. Restaure-le avant de modifier les partages.')
    return trip
  }
  return {
    async saveParticipant(tripId: string, name: string, id?: string, expectedName?: string) {
      const normalized = participantName(name)
      return withSensitiveOperation('Enregistrement d’un participant.', () => database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId), participants = validateParticipants(trip.participants)
        const existing = participants.find((item) => item.id === id)
        if (id !== undefined && (!existing || existing.name !== expectedName)) throw new Error('Ce participant a changé. Ferme puis rouvre sa modification.')
        if (!id && participants.length >= 100) throw new Error('La limite de 100 participants est atteinte.')
        const participant = { id: id ?? createId(), name: normalized }
        await database.trips.update(tripId, { participants: existing ? participants.map((item) => item.id === id ? participant : item) : [...participants, participant] })
        return participant
      }))
    },
    async deleteParticipant(tripId: string, id: string, expectedName: string) {
      return withSensitiveOperation('Suppression d’un participant.', () => database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId), participants = validateParticipants(trip.participants), expenses = validateExpenseShares(trip.expenseShares, participants)
        if (participants.find((item) => item.id === id)?.name !== expectedName) throw new Error('Ce participant a changé. Actualise la liste.')
        if (expenses.some((expense) => expense.payerId === id || expense.shares.some((share) => share.participantId === id))) throw new Error('Ce participant est utilisé par un partage. Modifie ou retire ces partages avant de le supprimer ; aucun historique n’a été effacé.')
        await database.trips.update(tripId, { participants: participants.filter((item) => item.id !== id) })
      }))
    },
    async saveShare(tripId: string, reference: ExpenseReference, input: Pick<ExpenseShare, 'amount' | 'payerId' | 'shares'>, expected: string) {
      return withSensitiveOperation('Enregistrement du paiement et de son partage.', () => database.transaction('rw', database.tables, async () => {
        const trip = await parent(tripId), participants = validateParticipants(trip.participants), expenses = validateExpenseShares(trip.expenseShares, participants)
        const key = expenseReferenceKey(reference), old = expenses.find((item) => expenseReferenceKey(item) === key)
        const activity = reference.kind === 'activity' ? await database.activities.get(reference.expenseId) : undefined
        const canonical = reference.kind === 'transfer' ? await readLegacyTransfers(database,tripId) : undefined
        const transfer = canonical?.projection.find(item => item.id === reference.expenseId)
        const nativeTable = reference.kind === 'journey' ? 'journeys' : reference.kind === 'accommodation' ? 'accommodations' : undefined
        const nativeEntity = nativeTable ? await database.table(nativeTable).get(reference.expenseId) : undefined
        const source = nativeTable ? (nativeEntity?.tripId === tripId ? nativeEntity : undefined) : activity?.tripId === tripId ? activity : transfer
        const journey = reference.kind === 'journey' ? nativeEntity : transfer ? canonical!.rows.find(row=>row.legacy?.id===transfer.id) : undefined
        if (journey && expenses.some(share => reference.kind === 'journey' ? share.kind === 'transfer' && share.expenseId === journey.legacy?.id : share.kind === 'journey' && share.expenseId === journey.id)) throw new Error('Ce trajet possède déjà un partage via un autre identifiant.')
        if(reference.kind==='accommodation'&&nativeEntity?.budgetExcluded)throw new Error('Cet hébergement est exclu du budget : ses montants sont suivis ailleurs.')
        if (!source) throw new Error('La dépense est introuvable dans ce voyage.')
        if (transfer) {
          const from = await database.activities.get(transfer.fromActivityId), to = await database.activities.get(transfer.toActivityId)
          if (from?.tripId !== tripId || to?.tripId !== tripId) throw new Error('Déplacement sans activités du voyage.')
        }
        if (sharingVersion(source, old) !== expected) throw new Error('Le paiement ou ce partage a changé dans un autre onglet. Ferme puis rouvre le formulaire après avoir conservé ta saisie.')
        const candidate = { ...reference, ...input, currency: validateCurrency(source.currency), updatedAt: new Date().toISOString() }
        const share = validateExpenseShares([candidate], participants)[0]
        const next = [...expenses.filter((item) => expenseReferenceKey(item) !== key), share]
        if (activity && source.paidAmount !== share.amount) await database.activities.update(activity.id, { paidAmount: share.amount, updatedAt: share.updatedAt })
        if (transfer) {
          const journey=canonical!.rows.find(row=>row.legacy?.id===transfer.id)!
          if (journey.paidAmount !== share.amount) { await database.journeys.update(journey.id,{paidAmount:share.amount,updatedAt:share.updatedAt}); await refreshLegacyProjection(database,tripId) }
        }
        if (nativeTable && source.paidAmount !== share.amount) {
          await database.table(nativeTable).update(nativeEntity.id,{paidAmount:share.amount,updatedAt:share.updatedAt})
          if (nativeTable === 'journeys') await refreshLegacyProjection(database,tripId)
        }
        await database.trips.update(tripId,{expenseShares:next})
        return share
      }))
    },
    async removeShare(tripId: string, reference: ExpenseReference, expected: string) {
      return withSensitiveOperation('Retrait d’un partage.', () => database.transaction('rw', database.trips, async () => {
        const trip = await parent(tripId), shares = validateExpenseShares(trip.expenseShares, validateParticipants(trip.participants)), key = expenseReferenceKey(reference)
        const share = shares.find((item) => expenseReferenceKey(item) === key)
        if (!share || JSON.stringify(share) !== expected) throw new Error('Ce partage a changé. Actualise la liste.')
        await database.trips.update(tripId, { expenseShares: shares.filter((item) => expenseReferenceKey(item) !== key) })
        // Deliberately retain the actual payment on its activity/transfer.
      }))
    },
  }
}
export const expenseSharingRepository = createExpenseSharingRepository()
