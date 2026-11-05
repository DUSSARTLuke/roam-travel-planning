import { useId, useRef, useState } from 'react'
import { budgetDayDistribution, type BudgetDistributionMode, type BudgetEntry, type TripBudget } from '../../money/tripBudget'
import { budgetTotalText, budgetOriginalAmount, budgetExclusionReason } from '../../money/budgetPresentation'
import { formatDate } from '../program/dates'

function ExpenseList({ entries, budget, mode, currency }: { entries: readonly BudgetEntry[]; budget: TripBudget; mode: BudgetDistributionMode; currency: string }) {
  return !entries.length ? <p>Aucune activité ni aucun déplacement affecté à cette journée.</p> : <ul className="budget-day-expenses">
    {entries.map((entry) => {
      const financial = budget.entryTotals.get(entry.id)
      const value = financial?.status === 'calculated' ? financial[mode] : null
      const amount = mode === 'estimated' ? entry.estimatedCost : entry.paidAmount
      return <li key={entry.id}><strong>{entry.kind === 'activity' ? 'Activité' : 'Déplacement'} · {entry.label}</strong>
        {entry.date && <p><time dateTime={entry.date}>{formatDate(entry.date, { day: 'numeric', month: 'long', year: 'numeric' })}</time></p>}
        <p>{mode === 'estimated' ? 'Estimé' : 'Payé'} : {amount === undefined ? 'Non renseigné' : budgetOriginalAmount(entry, mode === 'estimated' ? 'estimatedCost' : 'paidAmount')}</p>
        {amount !== undefined && value && <p className={value.excluded.length ? 'budget-warning' : 'budget-meta'}>{value.excluded.length
          ? budgetExclusionReason(value.excluded[0].result) : `Dans la devise du voyage : ${budgetTotalText(value, currency)}`}</p>}
        {entry.dateIssue && <p className="budget-warning">{entry.dateIssue}</p>}
      </li>
    })}
  </ul>
}
export function BudgetDayChart({ budget, mode, onModeChange }: { budget: TripBudget; mode: BudgetDistributionMode; onModeChange: (mode: BudgetDistributionMode) => void }) {
  const id = useId(), detailRef = useRef<HTMLElement>(null), scrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const distribution = budgetDayDistribution(budget, mode)
  const selected = distribution.rows.find((day) => day.date === selection) ?? distribution.rows[0]
  const currency = distribution.currency ?? ''
  function select(date: string) {
    setSelection(date)
    scrollRef.current?.querySelector<HTMLElement>(`[data-budget-day="${date}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const fullDate = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const validDays = distribution.rows.some((day) => day.value?.amount !== null && day.value?.amount !== undefined)
  return <section className="budget-day-section" aria-labelledby={`${id}-title`}>
    <div className="budget-category-heading"><h2 id={`${id}-title`}>Budget par journée</h2>
      <div className="budget-category-toggle budget-day-toggle" role="group" aria-label="Montants par journée">
        <button type="button" className="secondary-button" aria-pressed={mode === 'estimated'} onClick={() => onModeChange('estimated')}>Montants estimés</button>
        <button type="button" className="secondary-button" aria-pressed={mode === 'paid'} onClick={() => onModeChange('paid')}>Montants payés</button>
      </div></div>
    <p id={`${id}-scope`} className="budget-meta">Montants {mode === 'estimated' ? 'estimés' : 'payés'} connus et convertibles en {currency}. Les journées les plus élevées sont comparées sur ces seuls montants ; les dépenses manquantes ne valent pas zéro. Les montants affichés suivent les décimales de la devise.</p>
    {!distribution.rows.length ? <p role="status">Les dates du voyage ne permettent pas d’afficher les journées. Les montants restent dans la synthèse.</p> : <>
      {!validDays && <p className="budget-meta" role="status">Aucun montant connu et convertible pour les journées du séjour dans ce mode.</p>}
      <label className="budget-day-picker">Journée à consulter<select value={selected?.date ?? ''} onChange={(event) => select(event.target.value)}>
        {distribution.rows.map((day) => <option key={day.date} value={day.date}>{fullDate(day.date)}</option>)}
      </select></label>
      {selected && <button type="button" className="secondary-button budget-day-detail-link" onClick={() => { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView({ block: 'nearest' }) }}>Consulter le détail de la journée</button>}
      <div ref={scrollRef} className="budget-day-scroll" role="region" aria-label="Graphique des dépenses quotidiennes, défilement horizontal" aria-describedby={`${id}-scope`} tabIndex={0}>
        <ol className="budget-day-bars">{distribution.rows.map((day) => {
          const value = day.value
          const known = value?.amount !== null && value?.amount !== undefined && value.status !== 'invalid'
          const label = day.entries.length === 0 ? 'Aucune dépense' : value ? budgetTotalText(value, currency) : 'Indisponible'
          return <li key={day.date}><button type="button" className={`budget-day-column${day.highest ? ' is-highest' : ''}`} data-budget-day={day.date}
            aria-pressed={selected?.date === day.date} aria-label={`${fullDate(day.date)} : ${label}${day.highest ? ', plus élevé connu' : ''}${value?.absentCount ? `, ${value.absentCount} montant(s) non renseigné(s)` : ''}${value?.excluded.length ? `, ${value.excluded.length} montant(s) non convertible(s) ou invalide(s)` : ''}`} onClick={() => select(day.date)}>
            <span className="budget-day-amount">{label}</span>
            <span className={`budget-day-track${known ? '' : ' is-unknown'}`} aria-hidden="true">{known
              ? <span className={`budget-day-bar${value!.amount === 0 ? ' is-zero' : ''}`} style={{ height: `${day.height}%` }} />
              : <span>{day.entries.length ? '?' : '—'}</span>}</span>
            <time dateTime={day.date}>{formatDate(day.date, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
            {day.highest && <span className="budget-day-peak">Plus élevé connu</span>}
            {Boolean(value?.absentCount || value?.excluded.length) && <span className="budget-day-incomplete">Incomplet</span>}
          </button></li>
        })}</ol>
      </div>
      {selected && <section ref={detailRef} tabIndex={-1} className="budget-day-detail" aria-labelledby={`${id}-detail-title`} aria-live="polite">
        <h3 id={`${id}-detail-title`}>{fullDate(selected.date)}</h3>
        <p className="budget-day-total">{mode === 'estimated' ? 'Estimé connu' : 'Payé connu'} : {selected.entries.length === 0 ? 'Aucune dépense renseignée' : selected.value ? budgetTotalText(selected.value, currency) : 'Indisponible'}</p>
        {Boolean(selected.value?.absentCount) && <p className="budget-meta">{selected.value!.absentCount} montant(s) non renseigné(s).</p>}
        {Boolean(selected.value?.excluded.length) && <p className="budget-warning">{selected.value!.excluded.length} montant(s) non convertible(s) ou invalide(s), exclus de la barre.</p>}
        <ExpenseList entries={selected.entries} budget={budget} mode={mode} currency={currency} />
      </section>}
    </>}
    {(['undated', 'outside'] as const).map((kind) => {
      const group = budget[kind]
      const value = group.totals.status === 'calculated' ? group.totals[mode] : null
      return group.entries.length > 0 && <details className="budget-day-unassigned" key={kind} data-budget-unassigned={kind}>
        <summary>{kind === 'undated' ? 'Sans journée attribuable' : 'Hors des dates du séjour'} ({group.entries.length}) · {value ? budgetTotalText(value, currency) : 'Indisponible'}</summary>
        <p className="budget-meta">Ces montants restent dans les totaux du voyage mais ne sont affectés à aucune barre du séjour.</p>
        <ExpenseList entries={group.entries} budget={budget} mode={mode} currency={currency} />
      </details>
    })}
    {mode === 'paid' && <p className="budget-meta">Les montants payés sont rattachés à la date prévue de l’activité ; le modèle n’enregistre pas de date de paiement.</p>}
    <p className="budget-meta">Un transfert est affecté au jour commun de ses deux activités. Si leurs dates diffèrent ou manquent, son coût reste sans journée attribuable. Un montant payé de transfert n’est jamais déduit de son estimation.</p>
  </section>
}
