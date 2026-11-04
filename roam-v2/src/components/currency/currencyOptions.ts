import { supportedCurrencyCodes } from '../../db/currency'

export type CurrencyOption = { code: string; name: string; symbol: string; search: string }
const common = ['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'MAD', 'THB']
// Optional search aliases, not a country/currency mapping or a source of defaults.
const aliases: Record<string, string> = {
  EUR: 'Europe France Allemagne Espagne Italie Portugal Belgique zone euro',
  USD: 'États-Unis USA United States', GBP: 'Royaume-Uni Angleterre United Kingdom',
  JPY: 'Japon Japan', CHF: 'Suisse Liechtenstein', CAD: 'Canada', AUD: 'Australie Australia',
  MAD: 'Maroc Morocco', THB: 'Thaïlande Thailand', CNY: 'Chine China', INR: 'Inde India',
  BRL: 'Brésil Brazil', MXN: 'Mexique Mexico', AED: 'Émirats arabes unis Dubai',
  NZD: 'Nouvelle-Zélande New Zealand', ZAR: 'Afrique du Sud South Africa',
}
export function normalizeCurrencySearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim()
}
const names = new Intl.DisplayNames(['fr'], { type: 'currency' })
export const currencyOptions: CurrencyOption[] = supportedCurrencyCodes.map((code) => {
  const name = names.of(code) ?? code
  const symbol = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find((part) => part.type === 'currency')?.value ?? ''
  return { code, name, symbol: symbol === code ? '' : symbol,
    search: normalizeCurrencySearch(`${code} ${name} ${aliases[code] ?? ''} ${symbol}`) }
}).sort((a, b) => {
  const rank = (code: string) => common.includes(code) ? common.indexOf(code) : common.length
  return rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, 'fr')
})
export function searchCurrencies(query: string): CurrencyOption[] {
  const words = normalizeCurrencySearch(query).split(/\s+/).filter(Boolean)
  return currencyOptions.filter((option) => words.every((word) => option.search.includes(word)))
}
export function currencyOptionLabel(option: CurrencyOption): string {
  return `${option.name} — ${option.code}${option.symbol ? ` · ${option.symbol}` : ''}`
}
