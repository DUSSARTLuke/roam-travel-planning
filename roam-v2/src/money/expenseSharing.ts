import { validateCurrency, tripReferenceCurrency } from '../db/currency'
import type { Trip } from '../db/database'
import type { TripActivity } from '../db/activityModel'
import { createTripRateResolver } from './automaticRates'
import { convertMoney, type RateResolution } from './conversion'

export type TripParticipant = { id: string; name: string }
export type ExpenseReference = { kind: 'activity' | 'transfer' | 'journey' | 'accommodation'; expenseId: string }
export type ExpenseShare = ExpenseReference & { payerId: string; shares: { participantId: string; weight: number }[]; amount: number; currency: string; updatedAt: string }
export const expenseReferenceKey = (item: ExpenseReference) => `${item.kind}:${item.expenseId}`
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Données de partage invalides.'); return value as Record<string, unknown> }
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Identifiant de partage invalide.') }
export function participantName(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new Error('Le nom doit comporter entre 1 et 80 caractères.'); return value.trim() }
export function validateParticipants(value: unknown): TripParticipant[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100) throw new Error('La liste est limitée à 100 participants.')
  const ids = new Set<string>()
  return value.map((raw) => { const item = object(raw); id(item.id); if (ids.has(item.id)) throw new Error('Participant dupliqué.'); ids.add(item.id); const name = participantName(item.name); if (name !== item.name) throw new Error('Nom de participant non normalisé.'); return { id: item.id, name } })
}
export function validateExpenseShares(value: unknown, participants: readonly TripParticipant[]): ExpenseShare[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 30000) throw new Error('Liste de partages invalide ou excessive.')
  const ids = new Set(participants.map((item) => item.id)), seen = new Set<string>()
  return value.map((raw) => {
    const item = object(raw)
    if (!['activity','transfer','journey','accommodation'].includes(item.kind as string)) throw new Error('Type de dépense partagé invalide.')
    id(item.expenseId); id(item.payerId)
    const key = expenseReferenceKey(item as ExpenseShare)
    if (seen.has(key)) throw new Error('Cette dépense est déjà partagée.'); seen.add(key)
    if (!ids.has(item.payerId)) throw new Error('Le payeur est introuvable dans ce voyage.')
    if (!Array.isArray(item.shares) || item.shares.length < 1 || item.shares.length > 100) throw new Error('Choisis au moins un bénéficiaire.')
    const beneficiaries = new Set<string>()
    const shares = item.shares.map((rawShare) => {
      const share = object(rawShare); id(share.participantId)
      if (!ids.has(share.participantId) || beneficiaries.has(share.participantId)) throw new Error('Bénéficiaire absent ou dupliqué.')
      beneficiaries.add(share.participantId)
      if (!Number.isSafeInteger(share.weight) || (share.weight as number) <= 0 || (share.weight as number) > 1000000) throw new Error('Les parts doivent être des entiers entre 1 et 1 000 000.')
      return { participantId: share.participantId, weight: share.weight as number }
    })
    if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount < 0) throw new Error('Le montant payé doit être positif ou nul et fini.')
    const currency = validateCurrency(item.currency)
    if (currency !== item.currency) throw new Error('Devise du partage non normalisée.')
    if (typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updatedAt) || !Number.isFinite(Date.parse(item.updatedAt)) || new Date(item.updatedAt).toISOString() !== item.updatedAt) throw new Error('Date de partage invalide.')
    return { kind: item.kind as ExpenseReference['kind'], expenseId: item.expenseId, payerId: item.payerId, amount: item.amount, currency, shares, updatedAt: item.updatedAt }
  })
}
export function validateTripSharing(trip: { id: string; participants?: unknown; expenseShares?: unknown; manualTransfers?: readonly { id: string }[] }, activities: ReadonlyMap<string, TripActivity>) {
  const participants = validateParticipants(trip.participants), expenses = validateExpenseShares(trip.expenseShares, participants)
  for (const expense of expenses) {
    if (expense.kind !== 'activity' && expense.kind !== 'transfer') throw new Error('Partage V6 non autorisé dans les données historiques.')
    if (expense.kind === 'activity' ? activities.get(expense.expenseId)?.tripId !== trip.id : !trip.manualTransfers?.some((item) => item.id === expense.expenseId)) throw new Error('Partage sans dépense du voyage parent.')
  }
  return { participants, expenses }
}
export function sharingSources(trip: Trip, activities: readonly TripActivity[]) {
  const local = activities.filter((item) => item.tripId === trip.id), byId = new Map(local.map((item) => [item.id, item]))
  return [
    ...local.map((item) => ({ kind: 'activity' as const, expenseId: item.id, label: item.title, paidAmount: item.paidAmount, currency: item.currency })),
    ...(trip.manualTransfers ?? []).filter((item) => byId.has(item.fromActivityId) && byId.has(item.toActivityId)).map((item) => ({ kind: 'transfer' as const, expenseId: item.id, label: `${byId.get(item.fromActivityId)!.title} → ${byId.get(item.toActivityId)!.title}`, paidAmount: item.paidAmount, currency: item.currency })),
  ]
}
export function sharingVersion(source: { paidAmount?: number; currency?: string }, share: ExpenseShare | undefined): string { return JSON.stringify([source.paidAmount ?? null, source.currency ?? null, share ?? null]) }
export function parseSharingAmount(text: string): number {
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text.trim())) throw new Error('Saisis un montant payé avec un point ou une virgule.')
  const value = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) throw new Error('Montant payé invalide.')
  return value
}
export function sharingMinorUnits(amount: number, digits: number): number {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Montant partagé invalide.')
  const [base, exponent = '0'] = amount.toString().split('e')
  const units = Math.round(Number(`${base}e${Number(exponent) + digits}`))
  if (!Number.isSafeInteger(units)) throw new Error('Montant trop élevé pour un partage précis.')
  return units
}
export function formatSharingMinorUnits(minor: number, code: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Montant en unités monétaires invalide.')
  const currency = validateCurrency(code), formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
  const digits = formatter.resolvedOptions().maximumFractionDigits!, factor = 10n ** BigInt(digits), units = BigInt(minor)
  const fraction = (units % factor).toString().padStart(digits, '0')
  const text = formatter.formatToParts(units / factor).map((part) => part.type === 'fraction' ? fraction : part.value).join('')
  return text.includes(currency) ? text : `${text} ${currency}`
}
export function allocateSharingUnits(units: number, shares: ExpenseShare['shares']): Map<string, bigint> {
  if (!Number.isSafeInteger(units) || units < 0 || !shares.length || new Set(shares.map((share) => share.participantId)).size !== shares.length || shares.some((share) => !Number.isSafeInteger(share.weight) || share.weight <= 0 || share.weight > 1000000)) throw new Error('Répartition invalide.')
  const sum = shares.reduce((total, share) => total + BigInt(share.weight), 0n)
  const rows = shares.map((share) => { const product = BigInt(units) * BigInt(share.weight); return { id: share.participantId, value: product / sum, remainder: product % sum } })
  let left = BigInt(units) - rows.reduce((total, row) => total + row.value, 0n)
  const ordered = [...rows].sort((a, b) => a.remainder === b.remainder ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0 : a.remainder > b.remainder ? -1 : 1)
  for (const row of ordered) { if (left === 0n) break; row.value++; left-- }
  return new Map(rows.map((row) => [row.id, row.value]))
}
export type SharingSource = ExpenseReference & {label: string; paidAmount?: number; currency?: string}
export function calculateExpenseSharing(trip: Trip, activities: readonly TripActivity[], canonicalSources?: readonly SharingSource[]) {
  const issues: { key: string; label: string; reason: string }[] = []
  let participants: TripParticipant[], expenses: ExpenseShare[], currency: string
  try { participants = validateParticipants(trip.participants); expenses = validateExpenseShares(trip.expenseShares, participants); currency = validateCurrency(tripReferenceCurrency(trip)) }
  catch (error) { return { status: 'invalid' as const, reason: error instanceof Error ? error.message : 'Partage invalide.' } }
  const digits = new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!, factor = 10 ** digits
  const sources = new Map((canonicalSources ?? sharingSources(trip, activities)).map((item) => [expenseReferenceKey(item), item]))
  const balances = new Map(participants.map((item) => [item.id, { ...item, paid: 0n, owed: 0n }]))
  const resolve = createTripRateResolver(trip), rateCache = new Map<string, RateResolution>()
  let included = 0
  for (const expense of expenses) {
    const key = expenseReferenceKey(expense), source = sources.get(key)
    try {
      if (!source) throw new Error('Dépense supprimée ou inaccessible.')
      if (source.paidAmount === undefined || source.paidAmount !== expense.amount || (typeof source.currency === 'string' ? source.currency.trim().toUpperCase() : undefined) !== expense.currency) throw new Error('Paiement ou devise modifiés/inconnus : rouvre et revalide le partage.')
      let converted = convertMoney({ amount: source.paidAmount, sourceCurrency: source.currency, targetCurrency: currency })
      if (converted.status === 'unavailable' && converted.reason === 'missing-rate') {
        const rate = rateCache.get(expense.currency) ?? resolve(expense.currency, currency)
        rateCache.set(expense.currency, rate)
        if (rate.status !== 'available') throw new Error('Conversion indisponible : taux manquant ou invalide.')
        converted = convertMoney({ amount: expense.amount, sourceCurrency: expense.currency, targetCurrency: currency, rate: rate.rate })
      }
      if (converted.status !== 'converted') throw new Error('Conversion ou montant indisponible.')
      const units = sharingMinorUnits(converted.amount, digits), portions = allocateSharingUnits(units, expense.shares)
      balances.get(expense.payerId)!.paid += BigInt(units)
      for (const [id, owed] of portions) balances.get(id)!.owed += owed
      included++
    } catch (error) { issues.push({ key, label: source?.label ?? key, reason: error instanceof Error ? error.message : 'Partage non calculable.' }) }
  }
  const limit = BigInt(Number.MAX_SAFE_INTEGER)
  if ([...balances.values()].some((row) => row.paid > limit || row.owed > limit)) return { status: 'invalid' as const, reason: 'Totaux trop élevés pour un partage précis.' }
  const rows = [...balances.values()].map((row) => ({ id: row.id, name: row.name, paidMinor: Number(row.paid), owedMinor: Number(row.owed), balanceMinor: Number(row.paid - row.owed) }))
  const creditors = rows.filter((row) => row.balanceMinor > 0).map((row) => ({ id: row.id, units: row.balanceMinor })).sort((a, b) => a.id.localeCompare(b.id))
  const debtors = rows.filter((row) => row.balanceMinor < 0).map((row) => ({ id: row.id, units: -row.balanceMinor })).sort((a, b) => a.id.localeCompare(b.id))
  const reimbursements: { from: string; to: string; minor: number }[] = []
  for (const debtor of debtors) for (const creditor of creditors) {
    const units = Math.min(debtor.units, creditor.units)
    if (units) { reimbursements.push({ from: debtor.id, to: creditor.id, minor: units }); debtor.units -= units; creditor.units -= units }
  }
  return { status: 'calculated' as const, currency, digits, factor, rows, reimbursements, issues, included, unshared: [...sources.keys()].filter((key) => !expenses.some((expense) => expenseReferenceKey(expense) === key)).length }
}
