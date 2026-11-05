import { BudgetCategoryChart } from './BudgetCategoryChart'
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Wallet, Receipt, CircleHelp } from 'lucide-react'
import type { Trip } from '../../db/database'
import { listActivities } from '../../db/activities'
import type { TripActivity } from '../../db/activityModel'
import { buildTripBudget, type BudgetEntry } from '../../money/tripBudget'
import { formatMoney, type MoneyTotal, type ConversionResult } from '../../money/conversion'
import { formatDate } from '../program/dates'
import './trip-budget.css'

function money(amount: number | null, currency: string): string {
  if (amount === null) return 'Non renseigné'
  const formatted = formatMoney(amount, currency)
  return formatted.status === 'formatted' ? `${formatted.text} ${formatted.text.includes(currency) ? '' : currency}`.trim() : 'Montant indisponible'
}
function totalText(total: MoneyTotal, currency: string) {
  return total.status === 'invalid' ? 'Total indisponible' : total.amount === null && total.excluded.length ? 'Conversion indisponible' : money(total.amount, currency)
}
function Summary({ title, total, currency, missing = total.absentCount }: { title: string; total: MoneyTotal; currency: string; missing?: number }) {
  return <article className="budget-summary" aria-label={title}>
    <h2>{title}</h2><p className="budget-amount">{totalText(total, currency)}</p>
    <p className="budget-meta">{total.includedCount} montant(s) connu(s) intégré(s)</p>
    {total.excluded.length > 0 && <p className="budget-warning">Sous-total convertible : {total.excluded.length} montant(s) non intégré(s).</p>}
    {missing > 0 && <p className="budget-meta">{missing} élément(s) non renseigné(s) ou incomplet(s).</p>}
    {total.status === 'invalid' && <p className="budget-warning">Le total dépasse la précision numérique disponible.</p>}
  </article>
}
function exclusionReason(result: ConversionResult): string {
  if (result.status === 'unavailable') return result.reason === 'missing-source-currency' ? 'Devise d’origine non renseignée' : result.reason === 'missing-rate' ? 'Taux de change manquant pour cette paire' : 'Devise de référence non renseignée'
  if (result.status === 'invalid') return ['invalid-source-currency', 'invalid-target-currency'].includes(result.reason) ? 'Devise invalide' : result.reason === 'invalid-rate' || result.reason === 'resolver-error' ? 'Taux enregistré invalide ou indisponible' : 'Montant ou résultat numérique invalide'
  return 'Montant non disponible'
}
function originalAmount(item: BudgetEntry, kind: 'estimatedCost' | 'paidAmount') {
  const value = item[kind]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Montant invalide'
  if (item.currency) {
    const formatted = formatMoney(value, item.currency)
    if (formatted.status === 'formatted') return `${formatted.text} (${item.currency})`
  }
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 20 }).format(value)} (${item.currency || 'devise non renseignée'})`
}

export function TripBudget({ trip, readActivities = listActivities }: { trip: Trip; readActivities?: typeof listActivities }) {
  const [attempt, retry] = useState(0)
  const result = useLiveQuery(() => readActivities(trip.id).then(
    (activities) => ({ tripId: trip.id, activities, error: '' }),
    () => ({ tripId: trip.id, activities: [] as TripActivity[], error: 'Impossible de charger les montants du voyage. Les données locales sont conservées.' }),
  ), [trip.id, readActivities, attempt])
  const budget = useMemo(() => result?.tripId === trip.id && !result.error ? buildTripBudget(trip, result.activities) : null, [trip, result])
  if (trip.archived === true || trip.deletedAt !== undefined) return <section className="trip-budget-page"><p role="status">Restaure ce voyage pour consulter son budget actif.</p></section>
  if (!result || result.tripId !== trip.id || !budget) return <section className="trip-budget-page"><h1>Budget du voyage</h1>
    {result?.tripId === trip.id && result.error ? <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer le budget</button></div> : <p role="status">Chargement du budget…</p>}</section>
  if (budget.totals.status !== 'calculated' || budget.remaining.status !== 'calculated') return <section className="trip-budget-page"><h1>Budget du voyage</h1><p role="alert">La devise de référence du voyage est invalide. Vérifie les paramètres du voyage.</p></section>
  const { currency, estimated, paid } = budget.totals
  const entries = new Map(budget.entries.map((item) => [item.id, item]))
  const exclusions = [
    ...estimated.excluded.map((item) => ({ ...item, kind: 'estimatedCost' as const, label: 'Estimation' })),
    ...paid.excluded.map((item) => ({ ...item, kind: 'paidAmount' as const, label: 'Paiement' })),
  ]
  return <section className="trip-budget-page" aria-labelledby="trip-budget-title">
    <header><p className="eyebrow">{trip.destination}</p><h1 id="trip-budget-title"><Wallet size={27} aria-hidden="true" /> Budget du voyage</h1>
      <p className="budget-meta">Synthèse en {currency}, calculée localement à partir des montants renseignés. Les conversions restent indicatives.</p></header>
    {!budget.hasAmounts && budget.issues.length === 0 && <div className="budget-empty"><Receipt size={30} aria-hidden="true" /><h2>Aucune dépense renseignée</h2><p>Ajoute un prix estimé ou un montant payé dans les activités, ou un coût estimé dans les déplacements du Programme.</p></div>}
    {budget.hasAmounts && <>
      <div className="budget-summary-grid" aria-live="polite">
        <Summary title="Total estimé" total={estimated} currency={currency} />
        <Summary title="Total payé" total={paid} currency={currency} />
        <Summary title="Reste à payer connu" total={budget.remaining.estimated} currency={currency} missing={budget.unknownRemaining.length} />
      </div>
      <BudgetCategoryChart budget={budget} />
      <p className="budget-note"><CircleHelp size={19} aria-hidden="true" />Le reste connu est calculé par élément : estimation moins montant payé, sans descendre sous zéro. Une valeur absente reste inconnue ; elle ne vaut pas zéro.</p>
      {budget.overpaidCount > 0 && <p className="budget-meta">{budget.overpaidCount} paiement(s) dépassent leur estimation. Ces dépassements ne compensent pas les autres montants restant à payer.</p>}
      <section aria-labelledby="budget-origin-title"><h2 id="budget-origin-title">Origine des montants</h2><div className="budget-table-wrap" role="region" aria-label="Montants par origine" tabIndex={0}><table>
        <caption>Montants connus et convertibles, comptés une seule fois par activité ou déplacement.</caption>
        <thead><tr><th scope="col">Origine</th><th scope="col">Estimé</th><th scope="col">Payé</th></tr></thead>
        <tbody>{(['activity', 'transfer'] as const).map((kind) => {
          const totals = kind === 'activity' ? budget.activityTotals : budget.transferTotals
          return <tr key={kind}><th scope="row">{kind === 'activity' ? 'Activités' : 'Déplacements'}</th>
            <td>{totals.status === 'calculated' ? totalText(totals.estimated, currency) : 'Indisponible'}</td>
            <td>{kind === 'transfer' ? 'Non suivi' : totals.status === 'calculated' ? totalText(totals.paid, currency) : 'Indisponible'}</td></tr>
        })}</tbody>
      </table></div></section>
      {budget.remaining.estimated.excluded.length > 0 && <p className="budget-warning">Le reste connu exclut aussi {budget.remaining.estimated.excluded.length} élément(s) dont la devise ou la conversion est indisponible.</p>}
    </>}
    <p className="budget-meta">Les déplacements ne disposent actuellement que d’un coût estimé, sans montant payé. Une réservation confirmée ou annulée ne modifie pas les montants enregistrés et ne prouve pas un paiement.</p>
    {exclusions.length > 0 && <details className="budget-exclusions" open><summary>Montants non intégrés aux totaux ({exclusions.length})</summary><ul>
      {exclusions.map((excluded) => { const item = entries.get(excluded.id)!; return <li key={`${excluded.id}:${excluded.kind}`}><strong>{item.kind === 'activity' ? 'Activité' : 'Déplacement'} · {item.label}</strong>
        <p>{excluded.label} : {originalAmount(item, excluded.kind)}</p><p className="budget-warning">{exclusionReason(excluded.result)}</p></li> })}
    </ul><p className="budget-meta">Les montants d’origine sont conservés. Renseigne la devise de l’activité ou les taux dans les paramètres du voyage pour compléter la synthèse.</p></details>}
    {budget.issues.length > 0 && <div className="budget-warning" role="status"><p>Certains éléments ne peuvent pas être intégrés ; leurs données sont conservées.</p><ul>{budget.issues.map((issue, index) => <li key={index}>{issue.label} : {issue.reason}</li>)}</ul></div>}
    {budget.usedRates.length > 0 && <details className="budget-rates"><summary>Taux utilisés ({budget.usedRates.length})</summary><ul>{budget.usedRates.map((rate) => <li key={`${rate.sourceCurrency}/${rate.targetCurrency}`}>
      1 {rate.sourceCurrency} = {String(rate.rate).replace('.', ',')} {rate.targetCurrency} · {rate.source === 'manual' ? 'Taux manuel' : 'Taux automatique · Frankfurter V2'}
      {rate.asOf && <> · <time dateTime={rate.asOf}>{formatDate(rate.asOf.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}</time></>}
    </li>)}</ul><p className="budget-meta">Derniers taux enregistrés, utilisables hors connexion. Aucun taux n’est téléchargé par cet écran.</p></details>}
  </section>
}
