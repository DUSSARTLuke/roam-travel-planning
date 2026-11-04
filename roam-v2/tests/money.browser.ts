import { calculateFinancialTotals, convertMoney, formatMoney, type ConversionInput, type RateResolver } from '../src/money/conversion'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export function testMoney(report: (message: string) => void) {
  let count = 0
  const check = (value: unknown, message: string) => { count++; assert(value, message) }
  const identity = convertMoney({ amount: 12.345, sourceCurrency: ' eur ', targetCurrency: 'EUR' })
  check(identity.status === 'converted' && identity.amount === 12.345 && identity.rate === 1, 'Identité sans taux incorrecte.')
  const yen = convertMoney({ amount: 1000, sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.0061 })
  check(yen.status === 'converted' && yen.amount === 1000 * 0.0061, 'Convention de taux inversée.')
  const zero = convertMoney({ amount: 0, sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.0061 })
  check(zero.status === 'converted' && zero.amount === 0, 'Zéro perdu.')
  check(convertMoney({ sourceCurrency: 'EUR', targetCurrency: 'EUR' }).status === 'absent', 'Montant absent converti en zéro.')
  check(convertMoney({ amount: 0, sourceCurrency: 'JPY', targetCurrency: 'EUR' }).status === 'unavailable', 'Taux inventé pour zéro.')
  const base: ConversionInput = { amount: 12, sourceCurrency: 'JPY', targetCurrency: 'EUR' }
  for (const sourceCurrency of [undefined, '']) {
    const result = convertMoney({ ...base, sourceCurrency })
    check(result.status === 'unavailable' && result.reason === 'missing-source-currency', 'Devise absente incorrecte.')
  }
  for (const sourceCurrency of ['ZZZ', 'EU', 'EURO']) check(convertMoney({ ...base, sourceCurrency }).status === 'invalid', 'Devise invalide acceptée.')
  check(convertMoney({ ...base, targetCurrency: 'ZZZ' }).status === 'invalid', 'Cible invalide acceptée.')
  check(convertMoney({ ...base, targetCurrency: undefined }).status === 'unavailable', 'Cible absente acceptée.')
  check(convertMoney(base).status === 'unavailable', 'Taux absent inventé.')
  for (const rate of [0, -1, NaN, Infinity, -Infinity]) {
    check(convertMoney({ ...base, rate }).status === 'invalid', 'Taux invalide accepté.')
    check(convertMoney({ ...base, sourceCurrency: 'EUR', rate }).status === 'invalid', 'Taux fourni invalide ignoré en identité.')
  }
  for (const amount of [NaN, Infinity, -Infinity, -1]) check(convertMoney({ ...base, amount, rate: 1 }).status === 'invalid', 'Montant invalide accepté.')
  check(convertMoney({ ...base, amount: Number.MAX_VALUE, rate: 2 }).status === 'invalid', 'Débordement non détecté.')
  check(convertMoney({ ...base, amount: Number.MIN_VALUE, rate: 0.5 }).status === 'invalid', 'Sous-dépassement converti en zéro.')
  const precise = convertMoney({ amount: 0.123456789, sourceCurrency: 'USD', targetCurrency: 'EUR', rate: 0.987654321 })
  check(precise.status === 'converted' && precise.amount === 0.123456789 * 0.987654321, 'Arrondi intermédiaire.')
  for (const [code, fractionDigits] of [['EUR', 2], ['JPY', 0], ['KWD', 3]] as const) {
    const actual = formatMoney(12.3456, code, 'en-US')
    const expected = new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    check(expected.resolvedOptions().maximumFractionDigits === fractionDigits, 'Décimales ISO inattendues.')
    check(actual.status === 'formatted' && actual.text === expected.format(12.3456), 'Format monétaire incorrect.')
  }
  check(formatMoney(NaN, 'EUR').status === 'invalid', 'Formatage NaN accepté.')
  check(formatMoney(1, 'ZZZ').status === 'invalid', 'Formatage devise invalide accepté.')
  check(formatMoney(1, 'EUR', 'bad_locale').status === 'invalid', 'Locale invalide acceptée.')
  const items = Object.freeze([
    Object.freeze({ id: 'eur', currency: 'EUR', estimatedCost: 10, paidAmount: 0 }),
    Object.freeze({ id: 'jpy', currency: 'JPY', estimatedCost: 1000, paidAmount: 500 }),
    Object.freeze({ id: 'missing', estimatedCost: 8 }),
    Object.freeze({ id: 'no-rate', currency: 'GBP', estimatedCost: 4, paidAmount: 2 }),
    Object.freeze({ id: 'absent', currency: 'EUR' }),
  ])
  const before = JSON.stringify(items)
  const calls: string[] = []
  const resolve: RateResolver = (from, to) => {
    calls.push(`${from}/${to}`)
    return from === 'JPY' ? { status: 'available', rate: 0.0061, source: 'manual', asOf: '2026-11-04' } : { status: 'unavailable' }
  }
  const totals = calculateFinancialTotals(items, 'EUR', resolve)
  assert(totals.status === 'calculated', 'Calcul refusé.')
  check(totals.estimated.status === 'partial' && totals.estimated.amount === 10 + 1000 * 0.0061, 'Total estimé incorrect.')
  check(totals.paid.status === 'partial' && totals.paid.amount === 500 * 0.0061 && totals.paid.includedCount === 2, 'Total payé/zéro incorrect.')
  check(totals.estimated.excluded.map((item) => item.id).join() === 'missing,no-rate', 'Exclusions non signalées.')
  check(totals.estimated.absentCount === 1 && totals.paid.absentCount === 2, 'Absences confondues avec exclusions.')
  check(calls.join() === 'JPY/EUR,GBP/EUR', 'Paires/résolution partagée incorrectes.')
  check(JSON.stringify(items) === before, 'Données originales modifiées.')
  check(calculateFinancialTotals(items, 'ZZZ').status === 'invalid', 'Cible totale invalide acceptée.')
  const empty = calculateFinancialTotals([], 'EUR')
  check(empty.status === 'calculated' && empty.estimated.status === 'absent' && empty.estimated.amount === null, 'Total vide égal à zéro.')
  const unavailable = calculateFinancialTotals([{ id: 'x', currency: 'GBP', paidAmount: 0 }], 'EUR')
  check(unavailable.status === 'calculated' && unavailable.paid.status === 'unavailable' && unavailable.paid.amount === null, 'Total impossible égal à zéro.')
  const zeros = calculateFinancialTotals([{ id: 'zero', currency: 'EUR', estimatedCost: 0 }], 'EUR')
  check(zeros.status === 'calculated' && zeros.estimated.status === 'complete' && zeros.estimated.amount === 0, 'Total zéro absent.')
  for (const rate of [0, -1, NaN, Infinity]) {
    const invalid = calculateFinancialTotals([{ id: 'bad', currency: 'JPY', estimatedCost: 1 }], 'EUR', () => ({ status: 'available', rate, source: 'automatic' }))
    check(invalid.status === 'calculated' && invalid.estimated.excluded[0]?.result.status === 'invalid', 'Taux résolu non validé.')
  }
  const automatic = calculateFinancialTotals([{ id: 'auto', currency: 'JPY', estimatedCost: 10 }], 'EUR', () => ({ status: 'available', rate: 0.01, source: 'automatic' }))
  check(automatic.status === 'calculated' && automatic.estimated.amount === 0.1, 'Taux automatique explicite incorrect.')
  const refused = calculateFinancialTotals([{ id: 'refused', currency: 'JPY', estimatedCost: 10 }], 'EUR', () => ({ status: 'invalid' }))
  check(refused.status === 'calculated' && refused.estimated.excluded[0]?.result.reason === 'invalid-rate', 'Résolution invalide perdue.')
  const same = calculateFinancialTotals([{ id: 'same', currency: 'EUR', estimatedCost: 10 }], 'EUR', () => { throw new Error('Identité ne doit pas résoudre de taux') })
  check(same.status === 'calculated' && same.estimated.amount === 10, 'Résolveur appelé en identité.')
  let failures = 0
  const broken = calculateFinancialTotals([{ id: 'x', currency: 'JPY', estimatedCost: 1, paidAmount: 2 }], 'EUR', () => { failures++; throw new Error('test') })
  check(broken.status === 'calculated' && broken.paid.excluded[0]?.result.reason === 'resolver-error' && failures === 1, 'Erreur résolveur non explicite/mémorisée.')
  const overflow = calculateFinancialTotals([{ id: 'a', currency: 'EUR', estimatedCost: Number.MAX_VALUE }, { id: 'b', currency: 'EUR', estimatedCost: Number.MAX_VALUE }], 'EUR')
  check(overflow.status === 'calculated' && overflow.estimated.status === 'invalid' && overflow.estimated.amount === null, 'Débordement total accepté.')
  const fractions = calculateFinancialTotals([{ id: 'a', currency: 'EUR', estimatedCost: 0.004 }, { id: 'b', currency: 'EUR', estimatedCost: 0.004 }], 'EUR')
  check(fractions.status === 'calculated' && fractions.estimated.amount === 0.008, 'Arrondi avant somme.')
  report(`Moteur monétaire : ${count} contrôles (conversion, absence/zéro, validations, formats, totaux séparés, exclusions, immutabilité et précision).`)
}
