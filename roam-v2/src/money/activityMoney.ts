import type { TripActivity } from '../db/activityModel'
import type { Trip } from '../db/database'
import { tripReferenceCurrency } from '../db/currency'
import { createTripRateResolver } from './automaticRates'
import { convertMoney, formatMoney } from './conversion'

export type ActivityMoneyRow = {
  kind: 'estimatedCost' | 'paidAmount'
  label: string
  original: string
  unavailable?: string
  conversion?: { text: string; provenance: string; date?: string; stale: boolean; future: boolean }
}
// Presentation-only: explicit reference date keeps this function pure and testable.
export function activityMoneyRows(activity: Pick<TripActivity,'tripId'|'estimatedCost'|'paidAmount'|'currency'>, trip: Trip, today: string): ActivityMoneyRow[] {
  const resolve = createTripRateResolver(trip)
  const target = tripReferenceCurrency(trip)
  function money(amount: number, code: string | undefined): string {
    if (code) {
      const formatted = formatMoney(amount, code, 'fr-FR', 'narrowSymbol')
      if (formatted.status === 'formatted') {
        const normalized = code.trim().toUpperCase()
        return formatted.text.includes(normalized) ? formatted.text : `${formatted.text} ${normalized}`
      }
    }
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 20 }).format(amount)} ${code || '(devise non renseignée)'}`
  }
  const rows: ActivityMoneyRow[] = []
  for (const kind of ['estimatedCost', 'paidAmount'] as const) {
    const amount = activity[kind]
    if (amount === undefined || amount === null) continue
    const row: ActivityMoneyRow = { kind, label: kind === 'estimatedCost' ? 'Prix estimé' : 'Montant payé', original: money(amount, activity.currency) }
    rows.push(row)
    if (trip.id !== activity.tripId) { row.unavailable = 'contexte du voyage indisponible'; continue }
    const initial = convertMoney({ amount, sourceCurrency: activity.currency, targetCurrency: target })
    if (initial.status === 'converted') continue // Same currency: no redundant equivalent or rate lookup.
    if (initial.status !== 'unavailable' || initial.reason !== 'missing-rate') {
      row.unavailable = !activity.currency?.trim() ? 'devise de l’activité non renseignée' : 'montant ou devise invalide'
      continue
    }
    const sourceCurrency = activity.currency!.trim().toUpperCase()
    const targetCurrency = target.trim().toUpperCase()
    const resolution = resolve(sourceCurrency, targetCurrency)
    if (resolution.status !== 'available') { row.unavailable = resolution.status === 'invalid' ? 'taux enregistré invalide' : 'aucun taux pour cette paire'; continue }
    const converted = convertMoney({ amount, sourceCurrency, targetCurrency, rate: resolution.rate })
    if (converted.status !== 'converted') { row.unavailable = 'taux ou résultat de conversion invalide'; continue }
    const age = resolution.asOf ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${resolution.asOf.slice(0, 10)}T00:00:00Z`)) / 86400000 : null
    row.conversion = { text: `≈ ${money(converted.amount, targetCurrency)}`,
      provenance: resolution.source === 'manual' ? 'Taux manuel' : 'Taux automatique · Frankfurter V2',
      date: resolution.asOf, stale: resolution.source === 'automatic' && age !== null && age > 3,
      future: age !== null && age < 0 }
  }
  return rows
}
