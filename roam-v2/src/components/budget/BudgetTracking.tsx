import { useRef, useState } from 'react'
import type { Trip } from '../../db/database'
import { tripReferenceCurrency } from '../../db/currency'
import { savePlannedBudget } from '../../db/plannedBudget'
import { plannedBudgetPosition, parsePlannedBudgetAmount, filterBudgetEntries, paymentStatus, type BudgetViewState } from '../../money/budgetTracking'
import { budgetCategories } from '../../money/budgetCategories'
import { budgetMoneyText } from '../../money/budgetPresentation'
import type { TripBudget } from '../../money/tripBudget'
import { CurrencySelector } from '../currency/CurrencySelector'
import { formatDate } from '../program/dates'
import { SharingDialog } from './ExpenseSharing'
import { ExpenseList } from './BudgetDayChart'

function PlannedBudgetEditor({ trip, onClose, saveBudget }: { trip: Trip; onClose: () => void; saveBudget: typeof savePlannedBudget }) {
  const [initial] = useState(() => ({ amount: trip.plannedBudget === undefined ? '' : String(trip.plannedBudget.amount), currency: trip.plannedBudget?.currency ?? tripReferenceCurrency(trip), expected: JSON.stringify(trip.plannedBudget ?? null) }))
  const [amount, setAmount] = useState(initial.amount), [currency, setCurrency] = useState(initial.currency)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false)
  const dirty = amount !== initial.amount || currency !== initial.currency
  async function save() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const value = amount.trim() === '' ? undefined : { amount: parsePlannedBudgetAmount(amount), currency }
      await saveBudget(trip.id, value, initial.expected); onClose()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible d’enregistrer le prévisionnel. Les saisies sont conservées.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <SharingDialog title="Budget prévisionnel du voyage" busy={busy} dirty={dirty} onClose={onClose}>{(close) => <form onSubmit={(event) => { event.preventDefault(); void save() }}>
    <fieldset disabled={busy} className="budget-plan-fields"><label>Montant facultatif<input autoFocus type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <CurrencySelector label="Devise du prévisionnel" value={currency} onChange={setCurrency} />
      <p className="budget-meta">Un champ vide retire le prévisionnel ; zéro est un budget défini. Changer sa devise ne convertit pas le montant saisi.</p></fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>Annuler</button><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le prévisionnel'}</button></footer>
  </form>}</SharingDialog>
}
export function PlannedBudgetPanel({ trip, budget, saveBudget = savePlannedBudget }: { trip: Trip; budget: TripBudget; saveBudget?: typeof savePlannedBudget }) {
  const [editing, setEditing] = useState(false)
  let position: ReturnType<typeof plannedBudgetPosition>, error = ''
  try { position = plannedBudgetPosition(trip, budget) } catch (caught) { position = { status: 'unavailable' }; error = caught instanceof Error ? caught.message : 'Prévisionnel invalide.' }
  const currency = tripReferenceCurrency(trip)
  return <section className="budget-plan budget-summary" aria-label="Suivi du budget prévisionnel"><h2>Budget prévisionnel</h2>
    {trip.plannedBudget && <p>Prévu : {budgetMoneyText(trip.plannedBudget.amount, trip.plannedBudget.currency)}</p>}
    {position.status === 'absent' ? <p className="budget-meta">Aucun budget prévisionnel défini. Les dépenses restent accessibles ci-dessous.</p>
      : position.status === 'unavailable' ? <p role="status" className="budget-warning">{error || 'Comparaison indisponible : conversion du prévisionnel ou total estimé indisponible. Les montants d’origine sont conservés.'}</p>
      : <><p className={`budget-amount${position.remaining < 0 ? ' budget-warning' : ''}`}>{position.remaining < 0 ? 'Dépassement connu' : 'Disponible sur estimations connues'} : {budgetMoneyText(Math.abs(position.remaining), currency)}</p>
        {position.incomplete && <p className="budget-warning" role="status">Budget incomplet : {position.missing} estimation(s) inconnue(s), {position.excluded} dépense(s) non convertible(s) ou invalide(s). Ce disponible est provisoire ; les dépenses exclues peuvent l’abaisser.</p>}
        <p className="budget-meta">Prévisionnel moins les estimations connues et convertibles de tout le voyage, indépendamment des filtres. Ce n’est pas un solde bancaire ni le reste à payer.</p>
        {position.usedRate && <p className="budget-meta">Taux {position.usedRate.source === 'manual' ? 'manuel' : 'automatique · Frankfurter V2'} : 1 {trip.plannedBudget?.currency} = {String(position.usedRate.rate).replace('.', ',')} {currency}{position.usedRate.asOf && <> · <time dateTime={position.usedRate.asOf}>{formatDate(position.usedRate.asOf.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}</time></>}. Dernier taux enregistré ; il peut être ancien.</p>}
        {trip.plannedBudget?.currency !== currency && <p className="budget-meta">Prévisionnel converti à titre indicatif avec les taux locaux, manuels en priorité. Son montant d’origine reste inchangé.</p>}</>}
    <button type="button" className="secondary-button" onClick={() => setEditing(true)}>{trip.plannedBudget === undefined ? 'Définir un prévisionnel' : 'Modifier le prévisionnel'}</button>
    {editing && <PlannedBudgetEditor trip={trip} saveBudget={saveBudget} onClose={() => setEditing(false)} />}
  </section>
}
const paymentLabels = { unknown: 'Paiement ou solde inconnu', unpaid: 'Paiement nul confirmé', partial: 'Partiellement payé', paid: 'Estimation couverte' }
export function BudgetExpenseExplorer({ budget, view, onChange }: { budget: TripBudget; view: BudgetViewState; onChange: (view: BudgetViewState) => void }) {
  const entries = filterBudgetEntries(budget, view), currency = budget.totals.status === 'calculated' ? budget.totals.currency : ''
  const dates = budget.dailyTotals.map((day) => day.date)
  const dayValue = view.day === 'all' || view.day === 'undated' || view.day === 'outside' || dates.includes(view.day) ? view.day : 'all'
  const effectiveEntries = dayValue === view.day ? entries : filterBudgetEntries(budget, { ...view, day: dayValue })
  return <section className="budget-explorer" aria-labelledby="budget-explorer-title"><h2 id="budget-explorer-title">Consulter les dépenses</h2>
    <p className="budget-meta">Ces filtres concernent cette liste uniquement. Synthèses, graphiques et partages conservent tout le voyage. Les paiements des transferts restent suivis dans le partage.</p>
    <div className="budget-filters"><label>Catégorie<select value={view.category} onChange={(event) => onChange({ ...view, category: event.target.value as BudgetViewState['category'] })}><option value="all">Toutes les catégories</option>{budgetCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <label>Journée<select value={dayValue} onChange={(event) => onChange({ ...view, day: event.target.value })}><option value="all">Tout le voyage</option>{dates.map((date) => <option key={date} value={date}>{formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</option>)}<option value="undated">Sans journée attribuable</option><option value="outside">Hors séjour</option></select></label>
      <label>Statut du paiement<select value={view.payment} onChange={(event) => onChange({ ...view, payment: event.target.value as BudgetViewState['payment'] })}><option value="all">Tous les statuts</option>{Object.entries(paymentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Montants affichés<select value={view.mode} onChange={(event) => onChange({ ...view, mode: event.target.value as BudgetViewState['mode'] })}><option value="estimated">Estimés</option><option value="paid">Payés</option></select></label>
    </div>
    <button type="button" className="secondary-button" onClick={() => onChange({ ...view, category: 'all', day: 'all', payment: 'all' })}>Réinitialiser les filtres</button>
    <p role="status">{effectiveEntries.length} dépense(s) correspondante(s).</p>
    <p className="budget-meta">Le statut compare les montants d’origine : une réservation ne prouve pas un paiement. Un paiement positif sans estimation garde un solde inconnu.</p>
    {!effectiveEntries.length ? <p className="budget-empty">Aucune dépense ne correspond à ces filtres.</p> : <>
      <ExpenseList entries={effectiveEntries} budget={budget} mode={view.mode} currency={currency} />
      <details><summary>Statuts des dépenses affichées</summary><ul>{effectiveEntries.map((entry) => <li key={entry.id}>{entry.label} : {paymentLabels[paymentStatus(entry)]}</li>)}</ul></details>
    </>}
  </section>
}
