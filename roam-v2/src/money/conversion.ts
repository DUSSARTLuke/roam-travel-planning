import { validateCurrency } from '../db/currency'

export type MoneyIssue = 'invalid-amount' | 'invalid-source-currency' | 'invalid-target-currency' | 'invalid-rate' | 'overflow' | 'underflow' | 'resolver-error'
export type ConversionResult =
  | { status: 'converted'; amount: number; originalAmount: number; sourceCurrency: string; targetCurrency: string; rate: number }
  | { status: 'absent' }
  | { status: 'unavailable'; reason: 'missing-source-currency' | 'missing-target-currency' | 'missing-rate' }
  | { status: 'invalid'; reason: MoneyIssue }
export type ConversionInput = Readonly<{ amount?: number; sourceCurrency?: string; targetCurrency?: string; rate?: number }>

function currency(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : validateCurrency(value)
}

// 1 source unit = rate target units. Supplied invalid values are rejected even
// for an absent amount or an identity conversion. Only undefined means absent.
export function convertMoney(input: ConversionInput): ConversionResult {
  const { amount, rate } = input
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) return { status: 'invalid', reason: 'invalid-amount' }
  if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) return { status: 'invalid', reason: 'invalid-rate' }
  let sourceCurrency: string | undefined
  let targetCurrency: string | undefined
  try { sourceCurrency = currency(input.sourceCurrency) } catch { return { status: 'invalid', reason: 'invalid-source-currency' } }
  try { targetCurrency = currency(input.targetCurrency) } catch { return { status: 'invalid', reason: 'invalid-target-currency' } }
  if (amount === undefined) return { status: 'absent' }
  if (!sourceCurrency) return { status: 'unavailable', reason: 'missing-source-currency' }
  if (!targetCurrency) return { status: 'unavailable', reason: 'missing-target-currency' }
  const effectiveRate = sourceCurrency === targetCurrency ? 1 : rate
  if (effectiveRate === undefined) return { status: 'unavailable', reason: 'missing-rate' }
  const converted = amount * effectiveRate
  if (!Number.isFinite(converted)) return { status: 'invalid', reason: 'overflow' }
  if (amount > 0 && converted === 0) return { status: 'invalid', reason: 'underflow' }
  return { status: 'converted', amount: converted, originalAmount: amount, sourceCurrency, targetCurrency, rate: effectiveRate }
}

// A resolver must be a synchronous, side-effect-free lookup in an already
// available snapshot. Fetching/persisting rates belongs outside this engine.
// The rate always applies to the exact ordered pair passed to the resolver.
export type RateResolution =
  | { status: 'available'; rate: number; source: 'manual' | 'automatic'; asOf?: string }
  | { status: 'unavailable' }
  | { status: 'invalid' }
export type RateResolver = (sourceCurrency: string, targetCurrency: string) => RateResolution

export type FinancialItem = Readonly<{ id: string; currency?: string; estimatedCost?: number; paidAmount?: number }>
export type ExcludedAmount = { id: string; index: number; result: Extract<ConversionResult, { status: 'unavailable' | 'invalid' }> }
export type MoneyTotal = {
  status: 'complete' | 'partial' | 'absent' | 'unavailable' | 'invalid'
  amount: number | null
  includedCount: number
  absentCount: number
  excluded: ExcludedAmount[]
}
export type FinancialTotals =
  | { status: 'invalid'; reason: 'invalid-target-currency' }
  | { status: 'calculated'; currency: string; estimated: MoneyTotal; paid: MoneyTotal }

export function calculateFinancialTotals(items: readonly FinancialItem[], target: string, resolveRate?: RateResolver): FinancialTotals {
  let targetCurrency: string
  try { targetCurrency = validateCurrency(target) } catch { return { status: 'invalid', reason: 'invalid-target-currency' } }
  // One pair lookup per calculation, shared by estimates and payments.
  const rates = new Map<string, RateResolution | { status: 'error' }>()
  function convert(amount: number | undefined, source: string | undefined): ConversionResult {
    const preliminary = convertMoney({ amount, sourceCurrency: source, targetCurrency })
    if (preliminary.status !== 'unavailable' || preliminary.reason !== 'missing-rate') return preliminary
    const code = validateCurrency(source)
    let resolution = rates.get(code)
    if (!resolution) {
      try { resolution = resolveRate?.(code, targetCurrency) ?? { status: 'unavailable' } }
      catch { resolution = { status: 'error' } }
      rates.set(code, resolution)
    }
    if (resolution.status === 'error') return { status: 'invalid', reason: 'resolver-error' }
    if (resolution.status === 'invalid') return { status: 'invalid', reason: 'invalid-rate' }
    if (resolution.status === 'unavailable') return preliminary
    return convertMoney({ amount, sourceCurrency: code, targetCurrency, rate: resolution.rate })
  }
  function total(field: 'estimatedCost' | 'paidAmount'): MoneyTotal {
    let amount = 0
    let includedCount = 0
    let absentCount = 0
    let overflow = false
    const excluded: ExcludedAmount[] = []
    items.forEach((item, index) => {
      const result = convert(item[field], item.currency)
      if (result.status === 'converted') {
        amount += result.amount
        includedCount++
        if (!Number.isFinite(amount)) overflow = true
      } else if (result.status === 'absent') absentCount++
      else excluded.push({ id: item.id, index, result })
    })
    return { status: overflow ? 'invalid' : includedCount ? excluded.length ? 'partial' : 'complete' : excluded.length ? 'unavailable' : 'absent',
      amount: overflow || !includedCount ? null : amount, includedCount, absentCount, excluded }
  }
  return { status: 'calculated', currency: targetCurrency, estimated: total('estimatedCost'), paid: total('paidAmount') }
}

export type FormattedMoney = { status: 'formatted'; text: string } | { status: 'invalid'; reason: 'invalid-amount' | 'invalid-currency' | 'invalid-locale' }
export function formatMoney(amount: number, code: string, locale = 'fr-FR'): FormattedMoney {
  if (!Number.isFinite(amount) || amount < 0) return { status: 'invalid', reason: 'invalid-amount' }
  let normalized: string
  try { normalized = validateCurrency(code) } catch { return { status: 'invalid', reason: 'invalid-currency' } }
  try {
    return { status: 'formatted', text: new Intl.NumberFormat(locale, { style: 'currency', currency: normalized }).format(amount) }
  } catch { return { status: 'invalid', reason: 'invalid-locale' } }
}
