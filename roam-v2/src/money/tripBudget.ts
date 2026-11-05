import type { TripActivity } from '../db/activityModel'
import type { Trip } from '../db/database'
import { tripReferenceCurrency } from '../db/currency'
import { validateTransfer, type ManualTransfer } from '../db/transferModel'
import { createTripRateResolver } from './automaticRates'
import { calculateFinancialTotals, type FinancialItem, type FinancialTotals, type RateResolution, type RateResolver } from './conversion'

export type BudgetEntry = FinancialItem & { kind: 'activity' | 'transfer'; label: string }
export type BudgetIssue = { label: string; reason: string }
export type RemainingUnknown = { id: string; reason: 'missing-estimate' | 'missing-paid' | 'missing-both' | 'invalid-amount' }
export type BudgetRate = Extract<RateResolution, { status: 'available' }> & { sourceCurrency: string; targetCurrency: string }
const validAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

// Namespace IDs: an activity and a transfer may legitimately share a raw ID.
// Repeated records are counted once; contradictory duplicates are not guessed.
function unique<T extends { id: string }>(rows: readonly T[], equal: (a: T, b: T) => boolean, issues: BudgetIssue[]): T[] {
  const found = new Map<string, T>(), conflicts = new Set<string>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id.trim()) { issues.push({ label: 'Élément sans identifiant', reason: 'Identifiant invalide ; montant non intégré.' }); continue }
    const previous = found.get(row.id)
    if (previous && !equal(previous, row)) conflicts.add(row.id)
    else if (!previous) found.set(row.id, row)
  }
  for (const id of conflicts) issues.push({ label: id, reason: 'Plusieurs données contradictoires partagent cet identifiant ; montants non intégrés.' })
  return [...found.values()].filter((row) => !conflicts.has(row.id))
}
const sameMoney = (a: FinancialItem, b: FinancialItem) => a.currency === b.currency && Object.is(a.estimatedCost, b.estimatedCost) && Object.is(a.paidAmount, b.paidAmount)

// Only present amounts enter their own stream. A historical invalid currency
// must not manufacture an excluded payment when no payment was recorded.
function totalsFor(items: readonly FinancialItem[], target: string, resolve: RateResolver): FinancialTotals {
  const estimates = calculateFinancialTotals(items.filter((item) => item.estimatedCost !== undefined), target, resolve)
  const payments = calculateFinancialTotals(items.filter((item) => item.paidAmount !== undefined), target, resolve)
  if (estimates.status !== 'calculated') return estimates
  if (payments.status !== 'calculated') return payments
  return { status: 'calculated', currency: estimates.currency,
    estimated: { ...estimates.estimated, absentCount: items.filter((item) => item.estimatedCost === undefined).length },
    paid: { ...payments.paid, absentCount: items.filter((item) => item.paidAmount === undefined).length } }
}

// Pure snapshot calculation. No currency filling, writes, fetching or rounding.
export function buildTripBudget(trip: Trip, activities: readonly TripActivity[]) {
  const issues: BudgetIssue[] = []
  const local = unique(activities.filter((item) => item.tripId === trip.id), sameMoney, issues)
  const byId = new Map(local.map((item) => [item.id, item]))
  const entries: BudgetEntry[] = local.map((item) => ({ id: `activity:${item.id}`, kind: 'activity', label: item.title,
    currency: item.currency, estimatedCost: item.estimatedCost, paidAmount: item.paidAmount }))
  const transfers = unique(trip.manualTransfers ?? [], (a: ManualTransfer, b: ManualTransfer) => sameMoney(a, b) && a.fromActivityId === b.fromActivityId && a.toActivityId === b.toActivityId, issues)
  for (const raw of transfers) {
    try {
      const item = validateTransfer(raw)
      const from = byId.get(item.fromActivityId), to = byId.get(item.toActivityId)
      if (!from || !to) throw new Error('Une activité liée est absente ou appartient à un autre voyage.')
      // Date/order/GPS changes do not erase an existing expense. The map's
      // display eligibility is intentionally unrelated to financial inclusion.
      entries.push({ id: `transfer:${item.id}`, kind: 'transfer', label: `${from.title} → ${to.title}`,
        estimatedCost: item.estimatedCost, currency: item.currency })
    } catch (error) { issues.push({ label: `Déplacement ${raw.id}`, reason: error instanceof Error ? error.message : 'Données du déplacement invalides.' }) }
  }
  const resolver = createTripRateResolver(trip), rateCache = new Map<string, RateResolution>(), usedRates: BudgetRate[] = []
  const resolve: RateResolver = (sourceCurrency, targetCurrency) => {
    const key = `${sourceCurrency}/${targetCurrency}`
    const cached = rateCache.get(key)
    if (cached) return cached
    const resolution = resolver(sourceCurrency, targetCurrency)
    rateCache.set(key, resolution)
    if (resolution.status === 'available' && Number.isFinite(resolution.rate) && resolution.rate > 0) usedRates.push({ ...resolution, sourceCurrency, targetCurrency })
    return resolution
  }
  const target = tripReferenceCurrency(trip)
  const totals = totalsFor(entries, target, resolve)
  const unknownRemaining: RemainingUnknown[] = [], remainingEntries: FinancialItem[] = []
  let overpaidCount = 0
  for (const item of entries) {
    if (item.estimatedCost === undefined || item.paidAmount === undefined) {
      unknownRemaining.push({ id: item.id, reason: item.estimatedCost === undefined ? item.paidAmount === undefined ? 'missing-both' : 'missing-estimate' : 'missing-paid' })
    } else if (!validAmount(item.estimatedCost) || !validAmount(item.paidAmount)) unknownRemaining.push({ id: item.id, reason: 'invalid-amount' })
    else {
      if (item.paidAmount > item.estimatedCost) overpaidCount++
      remainingEntries.push({ id: item.id, currency: item.currency, estimatedCost: Math.max(0, item.estimatedCost - item.paidAmount) })
    }
  }
  const remaining = totalsFor(remainingEntries, target, resolve)
  return {
    entries, issues, totals, remaining, unknownRemaining, overpaidCount, usedRates,
    hasAmounts: entries.some((item) => item.estimatedCost !== undefined || item.paidAmount !== undefined),
    activityTotals: totalsFor(entries.filter((item) => item.kind === 'activity'), target, resolve),
    transferTotals: totalsFor(entries.filter((item) => item.kind === 'transfer'), target, resolve),
  }
}
export type TripBudget = ReturnType<typeof buildTripBudget>
