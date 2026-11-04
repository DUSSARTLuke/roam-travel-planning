import { db, type RoamDatabase, type Trip } from './database'
import { tripReferenceCurrency, validateCurrency } from './currency'
import type { TripActivity } from './activityModel'
import { validateManualRates } from '../money/manualRates'
import { parseFrankfurterRate, ratePairKey, validateAutomaticCache, type AutomaticRate, type RateCheck } from '../money/automaticRates'
import { withSensitiveOperation } from '../pwa/reloadSafety'

export function requiredAutomaticPairs(trip: Trip, activities: readonly TripActivity[]) {
  const targetCurrency = validateCurrency(tripReferenceCurrency(trip))
  const manual = new Set(validateManualRates(trip.manualExchangeRates).map(ratePairKey))
  const pairs = new Map<string, { sourceCurrency: string; targetCurrency: string }>()
  for (const activity of activities) {
    if (activity.tripId !== trip.id || ![activity.estimatedCost, activity.paidAmount].some((amount) => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0)) continue
    let sourceCurrency: string
    try { sourceCurrency = validateCurrency(activity.currency) } catch { continue }
    const pair = { sourceCurrency, targetCurrency }
    if (sourceCurrency !== targetCurrency && !manual.has(ratePairKey(pair))) pairs.set(ratePairKey(pair), pair)
  }
  return [...pairs.values()].sort((a, b) => ratePairKey(a).localeCompare(ratePairKey(b)))
}
export type RefreshResult = { status: 'updated' | 'cached' | 'offline' | 'busy' | 'obsolete'; fetched: number; unavailable: number; errors: number }
type Dependencies = { fetcher?: typeof fetch; now?: () => string; online?: () => boolean; token?: () => string }
export function createAutomaticRateService(database: RoamDatabase = db, dependencies: Dependencies = {}) {
  const fetcher = dependencies.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = dependencies.now ?? (() => new Date().toISOString())
  const online = dependencies.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const token = dependencies.token ?? (() => crypto.randomUUID())
  const result = (status: RefreshResult['status']): RefreshResult => ({ status, fetched: 0, unavailable: 0, errors: 0 })
  async function refresh(tripId: string, force = false): Promise<RefreshResult> {
    if (!online()) return result('offline')
    return withSensitiveOperation('Actualisation des taux de change en cours.', async () => {
      const startedAt = now()
      const id = token()
      const plan = await database.transaction('rw', database.trips, database.activities, async () => {
        const trip = await database.trips.get(tripId)
        if (!trip || trip.deletedAt !== undefined || trip.archived === true) return { status: 'obsolete' as const }
        const cache = validateAutomaticCache(trip.automaticExchangeRates)
        if (cache.refresh && Date.parse(startedAt) >= Date.parse(cache.refresh.startedAt) && Date.parse(startedAt) - Date.parse(cache.refresh.startedAt) < 600000) return { status: 'busy' as const }
        const pairs = requiredAutomaticPairs(trip, await database.activities.where('tripId').equals(tripId).toArray()).filter((pair) => {
          if (force) return true
          const check = cache.checks.find((item) => ratePairKey(item) === ratePairKey(pair))
          const rate = cache.rates.find((item) => ratePairKey(item) === ratePairKey(pair))
          return check?.checkedAt.slice(0, 10) !== startedAt.slice(0, 10) && rate?.fetchedAt.slice(0, 10) !== startedAt.slice(0, 10)
        })
        if (!pairs.length) return { status: 'cached' as const }
        const checks = new Map(cache.checks.map((item) => [ratePairKey(item), item]))
        for (const pair of pairs) checks.set(ratePairKey(pair), { ...pair, checkedAt: startedAt, status: 'pending' })
        await database.trips.update(tripId, { automaticExchangeRates: { ...cache, checks: [...checks.values()], refresh: { id, startedAt } } })
        return { status: 'planned' as const, pairs, target: tripReferenceCurrency(trip) }
      })
      if (plan.status !== 'planned') return result(plan.status)
      const pairs = plan.pairs
      const responses: { check: RateCheck; rate?: AutomaticRate }[] = []
      let cursor = 0
      async function worker() {
        while (cursor < pairs.length) {
          const pair = pairs[cursor++]
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10000)
          let stage = 'réseau'
          try {
            const response = await fetcher(`https://api.frankfurter.dev/v2/rate/${pair.sourceCurrency}/${pair.targetCurrency}`, {
              signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { Accept: 'application/json' },
            })
            stage = 'HTTP'
            if (response.status === 404 || response.status === 422) {
              responses.push({ check: { ...pair, checkedAt: now(), status: 'unavailable' } })
              continue
            }
            if (!response.ok) throw new Error(`HTTP ${response.status}.`)
            if (response.redirected) throw new Error('Redirection inattendue du fournisseur.')
            if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Content-Type JSON attendu.')
            stage = 'lecture JSON'
            const text = await response.text()
            if (text.length > 16384) throw new Error('Réponse excessive.')
            const fetchedAt = now()
            const json: unknown = JSON.parse(text)
            stage = 'validation du taux'
            const rate = parseFrankfurterRate(json, pair.sourceCurrency, pair.targetCurrency, fetchedAt)
            responses.push({ rate, check: { ...pair, checkedAt: fetchedAt, status: 'ok' } })
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'Erreur inconnue.'
            const diagnostic = `${stage} : ${detail}`.slice(0, 500)
            responses.push({ check: { ...pair, checkedAt: now(), status: 'error', diagnostic } })
          } finally { clearTimeout(timeout) }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, pairs.length) }, worker))
      return database.transaction('rw', database.trips, database.activities, async () => {
        const trip = await database.trips.get(tripId)
        if (!trip) return result('obsolete')
        const latest = validateAutomaticCache(trip.automaticExchangeRates)
        if (latest.refresh?.id !== id) return result('obsolete')
        const rates = new Map(latest.rates.map((item) => [ratePairKey(item), item]))
        const checks = new Map(latest.checks.map((item) => [ratePairKey(item), item]))
        const applicable = trip.deletedAt === undefined && trip.archived !== true && tripReferenceCurrency(trip) === plan.target
        // A reference/parent change while fetching invalidates this batch.
        for (const response of applicable ? responses : []) {
          const key = ratePairKey(response.check)
          checks.set(key, response.check)
          const old = rates.get(key)
          if (response.rate && (!old || (response.rate.rateDate >= old.rateDate && response.rate.fetchedAt >= old.fetchedAt))) rates.set(key, response.rate)
        }
        await database.trips.update(tripId, { automaticExchangeRates: { rates: [...rates.values()], checks: [...checks.values()] } })
        if (!applicable) return result('obsolete')
        return { status: 'updated' as const, fetched: responses.filter((item) => item.rate).length,
          unavailable: responses.filter((item) => item.check.status === 'unavailable').length, errors: responses.filter((item) => item.check.status === 'error').length }
      })
    })
  }
  return { refresh }
}
export const automaticRateService = createAutomaticRateService()
