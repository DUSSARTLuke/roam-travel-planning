// Shared validation for newly selected currencies; historical activity codes
// remain untouched unless the user explicitly changes them.
export const supportedCurrencyCodes = Intl.supportedValuesOf('currency')

export function validateCurrency(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Utilise un code devise ISO reconnu, comme EUR, GBP ou USD.')
  const code = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code) || !supportedCurrencyCodes.includes(code)) {
    throw new Error('Utilise un code devise ISO reconnu, comme EUR, GBP ou USD.')
  }
  return code
}

export function tripReferenceCurrency(trip: { referenceCurrency?: string }): string {
  return trip.referenceCurrency ?? 'EUR'
}
