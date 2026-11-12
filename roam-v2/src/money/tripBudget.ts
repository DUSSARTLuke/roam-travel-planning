import { matchingActivityReservations } from '../accommodations/model'
import type { Journey, Accommodation } from '../evolution/v21/contracts'
import { getTripDays, parseDate } from '../components/program/dates'
import { activityBudgetCategory, budgetCategories, type BudgetCategory } from './budgetCategories'
import type { TripActivity } from '../db/activityModel'
import type { Trip } from '../db/database'
import { tripReferenceCurrency } from '../db/currency'
import { validateTransfer, type ManualTransfer } from '../db/transferModel'
import { createTripRateResolver } from './automaticRates'
import { calculateFinancialTotals, type FinancialItem, type FinancialTotals, type RateResolution, type RateResolver } from './conversion'

export type BudgetEntry = FinancialItem & { kind: 'activity' | 'transfer' | 'accommodation'; category: BudgetCategory; label: string; date: string | null; dateIssue?: string }
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
export function buildTripBudget(trip: Trip, activities: readonly TripActivity[], journeys: readonly Journey[] = [], accommodations:readonly Accommodation[] = []) {
  const issues: BudgetIssue[] = []
  const local = unique(activities.filter((item) => item.tripId === trip.id), (a, b) => sameMoney(a, b) && a.category === b.category && a.date === b.date, issues)
  const byId = new Map(local.map((item) => [item.id, item]))
  const entries: BudgetEntry[] = local.map((item) => ({ id: `activity:${item.id}`, kind: 'activity', category: activityBudgetCategory(item.category), label: item.title,
    currency: item.currency, estimatedCost: item.estimatedCost, paidAmount: item.paidAmount, date: typeof item.date === 'string' && parseDate(item.date) ? item.date : null,
    ...(item.date !== null && !(typeof item.date === 'string' && parseDate(item.date)) ? { dateIssue: 'Date absente ou invalide' } : {}) }))
  const transfers = unique(trip.manualTransfers ?? [], (a: ManualTransfer, b: ManualTransfer) => sameMoney(a, b) && a.fromActivityId === b.fromActivityId && a.toActivityId === b.toActivityId, issues)
  for (const raw of transfers) {
    try {
      const item = validateTransfer(raw)
      const from = byId.get(item.fromActivityId), to = byId.get(item.toActivityId)
      if (!from || !to) throw new Error('Une activité liée est absente ou appartient à un autre voyage.')
      // Date/order/GPS changes do not erase an existing expense. The map's
      // display eligibility is intentionally unrelated to financial inclusion.
      entries.push({ id: `transfer:${item.id}`, kind: 'transfer', category: 'transport', label: `${from.title} → ${to.title}`,
        estimatedCost: item.estimatedCost, paidAmount: item.paidAmount, currency: item.currency,
        date: typeof from.date === 'string' && from.date === to.date && parseDate(from.date) ? from.date : null,
        ...(typeof from.date === 'string' && from.date === to.date && parseDate(from.date) ? {} : { dateIssue: 'Les activités du déplacement n’ont pas de journée commune valide.' }) })
    } catch (error) { issues.push({ label: `Déplacement ${raw.id}`, reason: error instanceof Error ? error.message : 'Données du déplacement invalides.' }) }
  }
  const projectedIds = new Set(transfers.map(transfer=>transfer.id))
  const autonomous = unique(journeys.filter(journey=>journey.tripId===trip.id && journey.purpose !== 'activity-connection' && (!journey.legacy || !projectedIds.has(journey.legacy.id))),sameMoney,issues)
  for (const journey of autonomous) entries.push({id:`journey:${journey.id}`,kind:'transfer',category:'transport',label:journey.title,estimatedCost:journey.estimatedCost,paidAmount:journey.paidAmount,currency:journey.currency,date:journey.departure?.date??null})
  const stays=unique(accommodations.filter(stay=>stay.tripId===trip.id),(a,b)=>sameMoney(a,b)&&a.budgetExcluded===b.budgetExcluded,issues)
  for(const stay of stays){if(stay.budgetExcluded){issues.push({label:stay.place.name,reason:'Montants de cet hébergement exclus volontairement : déjà suivis ailleurs.'});continue}if(matchingActivityReservations(stay,local).length){issues.push({label:stay.place.name,reason:'Référence déjà présente dans une activité : hébergement non intégré, doublon à vérifier. Les montants sont conservés.'});continue}entries.push({id:`accommodation:${stay.id}`,kind:'accommodation',category:'accommodation',label:stay.place.name,estimatedCost:stay.estimatedCost,paidAmount:stay.paidAmount,currency:stay.currency,date:null,dateIssue:'Coût global du séjour, sans répartition artificielle par nuit.'})}
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
  const dates = getTripDays(trip.startDate, trip.endDate), inTrip = new Set(dates)
  const buckets = new Map<string, BudgetEntry[]>(), undated: BudgetEntry[] = [], outside: BudgetEntry[] = []
  for (const item of entries) {
    if (item.date === null) undated.push(item)
    else if (!inTrip.has(item.date)) outside.push(item)
    else { const bucket = buckets.get(item.date) ?? []; bucket.push(item); buckets.set(item.date, bucket) }
  }
  const group = (items: BudgetEntry[]) => ({ entries: items, totals: totalsFor(items, target, resolve) })
  const dailyTotals = dates.map((date) => ({ date, ...group(buckets.get(date) ?? []) }))
  const entryTotals = new Map(entries.map((item) => [item.id, totalsFor([item], target, resolve)]))
  return {
    entries, issues, totals, remaining, dailyTotals, entryTotals, undated: group(undated), outside: group(outside), unknownRemaining, overpaidCount, usedRates,
    hasAmounts: entries.some((item) => item.estimatedCost !== undefined || item.paidAmount !== undefined),
    categoryTotals: budgetCategories.map((category) => ({ ...category, totals: totalsFor(entries.filter((item) => item.category === category.id), target, resolve) })),
    accommodationTotals:totalsFor(entries.filter(item=>item.kind==='accommodation'),target,resolve),
    activityTotals: totalsFor(entries.filter((item) => item.kind === 'activity'), target, resolve),
    transferTotals: totalsFor(entries.filter((item) => item.kind === 'transfer'), target, resolve),
  }
}
export type TripBudget = ReturnType<typeof buildTripBudget>

export type BudgetDistributionMode = 'estimated' | 'paid'
// This projection never converts or rounds money: it uses the exact same ledger,
// resolver snapshot and totalsFor calculations as the dashboard.
export function budgetCategoryDistribution(budget: TripBudget, mode: BudgetDistributionMode) {
  const total = budget.totals.status === 'calculated' ? budget.totals[mode] : null
  const amount = total?.amount ?? null
  const drawable = total?.status !== 'invalid' && amount !== null && amount > 0
  const rows = budget.categoryTotals.map((category) => {
    const value = category.totals.status === 'calculated' ? category.totals[mode] : null
    const percentage = drawable && value?.amount !== null && value?.amount !== undefined && value.status !== 'invalid'
      ? (value.amount / amount!) * 100 : null
    return { ...category, value, percentage }
  })
  // Close only the SVG's floating-point seam. Financial amounts/percentages above
  // remain unrounded, and percentages always refer to the dashboard's known sum.
  const positive = rows.filter((row) => row.percentage !== null && row.percentage > 0)
  let offset = 0
  const segments = positive.map((row, index) => {
    const size = index === positive.length - 1 ? Math.max(0, 100 - offset) : Math.max(0, Math.min(100 - offset, row.percentage!))
    const segment = { id: row.id, color: row.color, offset, size }
    offset += size
    return segment
  })
  return { mode, total, rows, segments, drawable, currency: budget.totals.status === 'calculated' ? budget.totals.currency : null }
}

// Select a precomputed money stream. No conversion or date inference in the UI.
export function budgetDayDistribution(budget: TripBudget, mode: BudgetDistributionMode) {
  const rows = budget.dailyTotals.map((day) => ({ ...day, value: day.totals.status === 'calculated' ? day.totals[mode] : null }))
  const maximum = rows.reduce((max, day) => day.value?.amount !== null && day.value?.amount !== undefined && day.value.status !== 'invalid' ? Math.max(max, day.value.amount) : max, 0)
  return { mode, maximum, currency: budget.totals.status === 'calculated' ? budget.totals.currency : null,
    rows: rows.map((day) => ({ ...day, highest: maximum > 0 && day.value?.amount === maximum,
      height: maximum > 0 && day.value?.amount !== null && day.value?.amount !== undefined && day.value.status !== 'invalid' ? day.value.amount / maximum * 100 : 0 })) }
}
