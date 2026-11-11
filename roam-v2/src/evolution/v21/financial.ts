import { matchingActivityReservations } from '../../accommodations/model'
import { calculateExpenseSharing, type SharingSource } from '../../money/expenseSharing'
import { validateV6Graph } from './graph'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { calculateFinancialTotals, type FinancialItem } from '../../money/conversion'
import { createTripRateResolver } from '../../money/automaticRates'
import { tripReferenceCurrency } from '../../db/currency'
import type { Journey, Accommodation } from './contracts'
// Future UI adapter: use canonical entities ONLY, never also manualTransfers.
export function v6FinancialTotals(trip: Trip, activities: readonly TripActivity[], journeys: readonly Journey[], accommodations: readonly Accommodation[]) {
  const items: FinancialItem[] = [
    ...activities.filter(a => a.tripId === trip.id).map(a => ({...a,id:`activity:${a.id}`})),
    ...journeys.filter(j => j.tripId === trip.id).map(j => ({...j,id:`journey:${j.id}`})),
    ...accommodations.filter(a => a.tripId === trip.id&&!a.budgetExcluded&&!matchingActivityReservations(a,activities).length).map(a => ({...a,id:`accommodation:${a.id}`})),
  ]
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Dépense canonique dupliquée.')
  return calculateFinancialTotals(items, tripReferenceCurrency(trip), createTripRateResolver(trip))
}

// Same rounding/conversion/settlement engine as V2; aliases are not extra payments.
export function v6ExpenseSharing(trip: Trip, activities: readonly TripActivity[], journeys: readonly Journey[], accommodations: readonly Accommodation[]) {
  validateV6Graph([trip],activities.filter(a=>a.tripId===trip.id),journeys.filter(j=>j.tripId===trip.id),accommodations.filter(a=>a.tripId===trip.id),[])
  const sources: SharingSource[] = [
    ...activities.filter(a=>a.tripId===trip.id).map(a=>({kind:'activity' as const,expenseId:a.id,label:a.title,paidAmount:a.paidAmount,currency:a.currency})),
    ...journeys.filter(j=>j.tripId===trip.id).map(j=>{ const legacy = j.legacy && trip.expenseShares?.some(s=>s.kind==='transfer' && s.expenseId===j.legacy!.id); return {kind:legacy?'transfer' as const:'journey' as const,expenseId:legacy?j.legacy!.id:j.id,label:j.title,paidAmount:j.paidAmount,currency:j.currency} }),
    ...accommodations.filter(a=>a.tripId===trip.id&&!a.budgetExcluded&&!matchingActivityReservations(a,activities).length).map(a=>({kind:'accommodation' as const,expenseId:a.id,label:a.place.name,paidAmount:a.paidAmount,currency:a.currency})),
  ]
  return calculateExpenseSharing(trip,activities,sources)
}
