import { parseSharingAmount } from './expenseSharing'
import { validateCurrency, tripReferenceCurrency } from '../db/currency'
import type { Trip } from '../db/database'
import { convertMoney, type RateResolution } from './conversion'
import { createTripRateResolver } from './automaticRates'
import type { BudgetCategory } from './budgetCategories'
import type { BudgetDistributionMode, BudgetEntry, TripBudget } from './tripBudget'

export function parsePlannedBudgetAmount(value: string): number {
  try { return parseSharingAmount(value) }
  catch { throw new Error('Saisis un budget positif ou nul, avec un point ou une virgule.') }
}
export type PlannedBudget = { amount: number; currency: string }
export function validatePlannedBudget(value: unknown): PlannedBudget | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Budget prévisionnel invalide.')
  const item = value as Record<string, unknown>
  if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0) throw new Error('Le budget doit être un montant positif ou nul et fini.')
  const currency = validateCurrency(item.currency)
  if (currency !== item.currency) throw new Error('Devise du budget non normalisée.')
  return { amount: item.amount, currency }
}
export const copyPlannedBudget = (trip: Pick<Trip, 'plannedBudget'>) => {
  const value = validatePlannedBudget(trip.plannedBudget)
  return value === undefined ? {} : { plannedBudget: { ...value } }
}
export type PaymentFilter = 'all' | 'unknown' | 'unpaid' | 'partial' | 'paid'
export type BudgetViewState = { mode: BudgetDistributionMode; category: BudgetCategory | 'all'; day: string; payment: PaymentFilter; selectedDay: string | null; sharingExpense?: string }
export const initialBudgetView: BudgetViewState = { mode: 'estimated', category: 'all', day: 'all', payment: 'all', selectedDay: null }
export function paymentStatus(entry: BudgetEntry): Exclude<PaymentFilter, 'all'> {
  if (entry.paidAmount === undefined || !Number.isFinite(entry.paidAmount) || entry.paidAmount < 0) return 'unknown'
  if (entry.paidAmount === 0) return 'unpaid'
  if (entry.estimatedCost === undefined || !Number.isFinite(entry.estimatedCost) || entry.estimatedCost < 0) return 'unknown'
  return entry.paidAmount < entry.estimatedCost ? 'partial' : 'paid'
}
export function filterBudgetEntries(budget: TripBudget, view: BudgetViewState) {
  const days = new Set(budget.dailyTotals.map((day) => day.date))
  return budget.entries.filter((entry) => (view.category === 'all' || entry.category === view.category)
    && (view.day === 'all' || (view.day === 'undated' ? entry.date === null : view.day === 'outside' ? entry.date !== null && !days.has(entry.date) : entry.date === view.day))
    && (view.payment === 'all' || paymentStatus(entry) === view.payment))
}
export function plannedBudgetPosition(trip: Trip, budget: TripBudget) {
  const planned = validatePlannedBudget(trip.plannedBudget)
  if (!planned) return { status: 'absent' as const }
  const target = tripReferenceCurrency(trip)
  let usedRate: Extract<RateResolution, { status: 'available' }> | undefined
  let conversion = convertMoney({ amount: planned.amount, sourceCurrency: planned.currency, targetCurrency: target })
  if (conversion.status === 'unavailable' && conversion.reason === 'missing-rate') {
    const rate = createTripRateResolver(trip)(planned.currency, target)
    if (rate.status === 'available') { usedRate = rate; conversion = convertMoney({ amount: planned.amount, sourceCurrency: planned.currency, targetCurrency: target, rate: rate.rate }) }
  }
  const estimate = budget.totals.status === 'calculated' ? budget.totals.estimated : null
  if (conversion.status !== 'converted' || !estimate || estimate.status === 'invalid') return { status: 'unavailable' as const }
  // No expenses: known spend is zero. Unknown expenses never become zero records.
  const known = estimate.amount ?? 0
  return { status: 'calculated' as const, usedRate, amount: conversion.amount, remaining: conversion.amount - known,
    incomplete: estimate.absentCount > 0 || estimate.excluded.length > 0 || budget.issues.length > 0,
    missing: estimate.absentCount, excluded: estimate.excluded.length + budget.issues.length }
}
