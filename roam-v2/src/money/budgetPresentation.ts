import type { BudgetEntry } from './tripBudget'
import { formatMoney, type MoneyTotal, type ConversionResult } from './conversion'

export function budgetMoneyText(amount: number | null, currency: string): string {
  if (amount === null) return 'Non renseigné'
  const formatted = formatMoney(amount, currency)
  return formatted.status === 'formatted' ? `${formatted.text} ${formatted.text.includes(currency) ? '' : currency}`.trim() : 'Montant indisponible'
}
export function budgetTotalText(total: MoneyTotal, currency: string) {
  return total.status === 'invalid' ? 'Total indisponible' : total.amount === null && total.excluded.length ? 'Conversion indisponible' : budgetMoneyText(total.amount, currency)
}
export function budgetExclusionReason(result: ConversionResult): string {
  if (result.status === 'unavailable') return result.reason === 'missing-source-currency' ? 'Devise d’origine non renseignée' : result.reason === 'missing-rate' ? 'Taux de change manquant pour cette paire' : 'Devise de référence non renseignée'
  if (result.status === 'invalid') return ['invalid-source-currency', 'invalid-target-currency'].includes(result.reason) ? 'Devise invalide' : result.reason === 'invalid-rate' || result.reason === 'resolver-error' ? 'Taux enregistré invalide ou indisponible' : 'Montant ou résultat numérique invalide'
  return 'Montant non disponible'
}
export function budgetOriginalAmount(item: BudgetEntry, kind: 'estimatedCost' | 'paidAmount') {
  const value = item[kind]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Montant invalide'
  if (item.currency) {
    const formatted = formatMoney(value, item.currency)
    if (formatted.status === 'formatted') return `${formatted.text} (${item.currency})`
  }
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 20 }).format(value)} (${item.currency || 'devise non renseignée'})`
}

