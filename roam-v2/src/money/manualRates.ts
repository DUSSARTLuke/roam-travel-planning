import { validateCurrency } from '../db/currency'
import type { RateResolver } from './conversion'

export type ManualExchangeRate = { sourceCurrency: string; targetCurrency: string; rate: number; updatedAt: string }
export type ManualRateDraft = { sourceCurrency: string; targetCurrency: string; value: string; updatedAt?: string }
const pair = (rate: { sourceCurrency: string; targetCurrency: string }) => `${rate.sourceCurrency}/${rate.targetCurrency}`

export function parseManualRate(value: string): number {
  const text = value.trim()
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('Saisis un taux positif avec une virgule ou un point, sans séparateur de milliers.')
  const rate = Number(text.replace(',', '.'))
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Le taux doit être strictement positif et fini.')
  return rate
}
export function validateManualRates(value: unknown): ManualExchangeRate[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Liste de taux manuels invalide.')
  const seen = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Taux manuel invalide.')
    const sourceCurrency = validateCurrency(item.sourceCurrency)
    const targetCurrency = validateCurrency(item.targetCurrency)
    const key = pair({ sourceCurrency, targetCurrency })
    if (sourceCurrency === targetCurrency) throw new Error('Les devises source et cible doivent être différentes.')
    if (seen.has(key)) throw new Error(`La paire ${key} existe déjà.`)
    seen.add(key)
    if (typeof item.rate !== 'number' || !Number.isFinite(item.rate) || item.rate <= 0) throw new Error('Le taux doit être strictement positif et fini.')
    if (typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updatedAt) ||
      !Number.isFinite(Date.parse(item.updatedAt)) || new Date(item.updatedAt).toISOString() !== item.updatedAt) throw new Error('Date de modification du taux invalide.')
    return { sourceCurrency, targetCurrency, rate: item.rate, updatedAt: item.updatedAt }
  })
}
export function manualRateDrafts(rates: readonly ManualExchangeRate[]): ManualRateDraft[] {
  return rates.map((rate) => ({ ...rate, value: String(rate.rate) }))
}
export function prepareManualRates(drafts: readonly ManualRateDraft[], baseline: readonly ManualExchangeRate[], now: string): ManualExchangeRate[] {
  return validateManualRates(drafts.map((draft) => {
    const sourceCurrency = validateCurrency(draft.sourceCurrency)
    const targetCurrency = validateCurrency(draft.targetCurrency)
    const rate = parseManualRate(draft.value)
    const old = baseline.find((item) => pair(item) === pair({ sourceCurrency, targetCurrency }))
    return { sourceCurrency, targetCurrency, rate, updatedAt: old?.rate === rate ? old.updatedAt : now }
  }))
}
// Three-way merge by ordered pair. Only pairs changed in the form are applied;
// a concurrent edit to the same pair requires explicit user reconciliation.
export function mergeManualRates(baseline: readonly ManualExchangeRate[], desired: readonly ManualExchangeRate[], latest: readonly ManualExchangeRate[]): ManualExchangeRate[] {
  const before = new Map(baseline.map((rate) => [pair(rate), rate]))
  const after = new Map(desired.map((rate) => [pair(rate), rate]))
  const current = new Map(latest.map((rate) => [pair(rate), rate]))
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(key)
    const next = after.get(key)
    if (JSON.stringify(old) === JSON.stringify(next)) continue
    if (JSON.stringify(current.get(key)) !== JSON.stringify(old)) throw new Error(`Le taux ${key} a changé dans un autre onglet. Ferme puis rouvre le formulaire après avoir conservé tes saisies.`)
    if (next) current.set(key, { ...next })
    else current.delete(key)
  }
  return validateManualRates([...current.values()])
}
// Exact ordered pair only: no implicit inverse or cross-rate. Manual wins even
// if a future automatic resolver also has the pair. Snapshot copied at creation.
export function createManualRateResolver(rates: readonly ManualExchangeRate[] = [], fallback?: RateResolver): RateResolver {
  let snapshot: ManualExchangeRate[]
  try { snapshot = validateManualRates(rates) } catch { return () => ({ status: 'invalid' }) }
  return (from, to) => {
    let sourceCurrency: string
    let targetCurrency: string
    try { sourceCurrency = validateCurrency(from); targetCurrency = validateCurrency(to) } catch { return { status: 'invalid' } }
    const rate = snapshot.find((item) => item.sourceCurrency === sourceCurrency && item.targetCurrency === targetCurrency)
    return rate ? { status: 'available', rate: rate.rate, source: 'manual', asOf: rate.updatedAt } : fallback?.(sourceCurrency, targetCurrency) ?? { status: 'unavailable' }
  }
}
