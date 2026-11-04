import { validateCurrency } from '../db/currency'
import { isActivityDate } from '../db/activityModel'
import { createManualRateResolver, type ManualExchangeRate } from './manualRates'
import type { RateResolver } from './conversion'

export const AUTOMATIC_PROVIDER = 'frankfurter-v2' as const
export type AutomaticRate = { sourceCurrency: string; targetCurrency: string; rate: number; rateDate: string; fetchedAt: string; provider: typeof AUTOMATIC_PROVIDER }
export type RateCheck = { sourceCurrency: string; targetCurrency: string; checkedAt: string; status: 'pending' | 'ok' | 'unavailable' | 'error'; diagnostic?: string }
export type AutomaticRateCache = { rates: AutomaticRate[]; checks: RateCheck[]; refresh?: { id: string; startedAt: string } }
export const ratePairKey = (pair: { sourceCurrency: string; targetCurrency: string }) => `${pair.sourceCurrency}/${pair.targetCurrency}`
export function validRateTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Données de taux automatiques invalides.')
  return value as Record<string, unknown>
}
function pair(value: Record<string, unknown>) {
  const sourceCurrency = validateCurrency(value.sourceCurrency)
  const targetCurrency = validateCurrency(value.targetCurrency)
  if (sourceCurrency === targetCurrency) throw new Error('Paire automatique identique invalide.')
  return { sourceCurrency, targetCurrency }
}
export function validateAutomaticCache(value: unknown): AutomaticRateCache {
  if (value === undefined) return { rates: [], checks: [] }
  const cache = object(value)
  function list<T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] {
    if (!Array.isArray(value) || value.length > 30000) throw new Error('Liste de taux automatiques invalide.')
    const seen = new Set<string>()
    return value.map((raw) => {
      const item = object(raw)
      const key = ratePairKey(pair(item))
      if (seen.has(key)) throw new Error('Paire automatique dupliquée.')
      seen.add(key)
      return read(item)
    })
  }
  const rates = list(cache.rates, (item): AutomaticRate => {
    if (item.provider !== AUTOMATIC_PROVIDER) throw new Error('Fournisseur de taux automatique invalide.')
    if (typeof item.rate !== 'number' || !Number.isFinite(item.rate) || item.rate <= 0) throw new Error('Le taux reçu doit être un nombre strictement positif et fini.')
    if (!isActivityDate(item.rateDate)) throw new Error('Date du taux invalide : format YYYY-MM-DD attendu.')
    if (!validRateTimestamp(item.fetchedAt)) throw new Error('Date de récupération du taux invalide.')
    // Provider calendar dates and the client's UTC day can differ around
    // midnight. Allow one calendar day, not an unlimited future-date bypass.
    const latestDay = new Date(Date.parse(`${item.fetchedAt.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    if (item.rateDate > latestDay) throw new Error(`Date du taux ${item.rateDate} trop future pour la récupération ${item.fetchedAt} (tolérance : un jour calendaire). Vérifie la date et l’heure du système.`)
    return { ...pair(item), rate: item.rate, rateDate: item.rateDate, fetchedAt: item.fetchedAt, provider: AUTOMATIC_PROVIDER }
  })
  const checks = list(cache.checks, (item): RateCheck => {
    if (!validRateTimestamp(item.checkedAt) || (typeof item.status !== 'string' || !['pending', 'ok', 'unavailable', 'error'].includes(item.status))) throw new Error('Date ou état de vérification invalide.')
    if (item.diagnostic !== undefined && (item.status !== 'error' || typeof item.diagnostic !== 'string' || item.diagnostic.length > 500)) throw new Error('Diagnostic de taux invalide.')
    return { ...pair(item), checkedAt: item.checkedAt, status: item.status as RateCheck['status'],
      ...(typeof item.diagnostic === 'string' ? { diagnostic: item.diagnostic } : {}) }
  })
  let refresh: AutomaticRateCache['refresh']
  if (cache.refresh !== undefined) {
    const lease = object(cache.refresh)
    if (typeof lease.id !== 'string' || !lease.id || lease.id.length > 128 || !validRateTimestamp(lease.startedAt)) throw new Error('Réservation de taux invalide.')
    refresh = { id: lease.id, startedAt: lease.startedAt }
  }
  return { rates, checks, ...(refresh ? { refresh } : {}) }
}
export function parseFrankfurterRate(value: unknown, sourceCurrency: string, targetCurrency: string, fetchedAt: string): AutomaticRate {
  const row = object(value)
  // V2 returns { date, base, quote, rate }, not V1's rates object.
  if (row.base !== sourceCurrency || row.quote !== targetCurrency) throw new Error('La paire reçue ne correspond pas à la demande.')
  return validateAutomaticCache({ rates: [{ sourceCurrency, targetCurrency, rate: row.rate, rateDate: row.date, fetchedAt, provider: AUTOMATIC_PROVIDER }], checks: [] }).rates[0]
}
export function createTripRateResolver(trip: { manualExchangeRates?: ManualExchangeRate[]; automaticExchangeRates?: AutomaticRateCache }): RateResolver {
  let rates: AutomaticRate[]
  try { rates = validateAutomaticCache(trip.automaticExchangeRates).rates } catch { return createManualRateResolver(trip.manualExchangeRates, () => ({ status: 'invalid' })) }
  return createManualRateResolver(trip.manualExchangeRates, (sourceCurrency, targetCurrency) => {
    const rate = rates.find((item) => item.sourceCurrency === sourceCurrency && item.targetCurrency === targetCurrency)
    return rate ? { status: 'available', rate: rate.rate, source: 'automatic', asOf: rate.rateDate } : { status: 'unavailable' }
  })
}
