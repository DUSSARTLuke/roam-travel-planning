import { useId } from 'react'
import { budgetCategoryDistribution, type BudgetDistributionMode, type TripBudget } from '../../money/tripBudget'
import { formatMoney } from '../../money/conversion'

function amountLabel(amount: number | null | undefined, currency: string | null) {
  if (amount === null || amount === undefined) return 'Non renseigné'
  const value = currency ? formatMoney(amount, currency) : null
  return value?.status === 'formatted' ? value.text : 'Indisponible'
}
export function BudgetCategoryChart({ budget, mode, onModeChange }: { budget: TripBudget; mode: BudgetDistributionMode; onModeChange: (mode: BudgetDistributionMode) => void }) {
  const id = useId()
  const distribution = budgetCategoryDistribution(budget, mode)
  const { total, drawable, currency } = distribution
  const totalLabel = amountLabel(total?.amount, currency)
  const modeLabel = mode === 'estimated' ? 'estimés' : 'payés'
  return <section className="budget-category-section" aria-labelledby={`${id}-heading`}>
    <div className="budget-category-heading"><h2 id={`${id}-heading`}>Répartition par catégorie</h2>
      <div className="budget-category-toggle" role="group" aria-label="Montants de la répartition">
        <button type="button" className="secondary-button" aria-pressed={mode === 'estimated'} onClick={() => onModeChange('estimated')}>Montants estimés</button>
        <button type="button" className="secondary-button" aria-pressed={mode === 'paid'} onClick={() => onModeChange('paid')}>Montants payés</button>
      </div></div>
    <p id={`${id}-scope`} className="budget-meta">Les pourcentages portent uniquement sur les montants connus et convertibles en {currency ?? 'devise du voyage'}. Les valeurs affichées sont arrondies.</p>
    <div className="budget-category-chart" aria-live="polite">
      <figure className="budget-donut-figure">
        {drawable ? <div className="budget-donut-stage"><svg viewBox="0 0 200 200" role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>Répartition des montants {modeLabel} par catégorie</title>
          <desc id={`${id}-description`}>Total connu et convertible : {totalLabel} {currency}. Les catégories, montants et pourcentages sont détaillés dans la légende associée.</desc>
          <circle className="budget-donut-track" cx="100" cy="100" r="76" fill="none" strokeWidth="26" />
          {distribution.segments.map((segment) => <circle key={segment.id} data-category={segment.id} cx="100" cy="100" r="76" pathLength="100" fill="none" stroke={segment.color} strokeWidth="26"
            strokeDasharray={`${segment.size} ${100 - segment.size}`} strokeDashoffset={-segment.offset} transform="rotate(-90 100 100)" />)}
        </svg><div className="budget-donut-center" aria-hidden="true"><span>{mode === 'estimated' ? 'Estimé connu' : 'Payé connu'}</span><strong>{totalLabel}</strong><span>{currency}</span></div></div>
          : <div className="budget-donut-empty" role="status">{total?.status === 'invalid' ? 'Répartition indisponible : total numérique invalide.'
            : total?.amount === 0 ? 'Les montants connus sont à zéro : aucun pourcentage à représenter.'
              : total?.excluded.length ? 'Aucun montant convertible pour cette répartition.' : `Aucun montant ${mode === 'estimated' ? 'estimé' : 'payé'} renseigné pour cette répartition.`}</div>}
        <figcaption className="budget-meta">Montants {modeLabel} · {drawable ? `${totalLabel} ${currency} connus et convertibles` : 'Répartition en attente de données suffisantes'}</figcaption>
      </figure>
      <dl className="budget-category-legend" aria-label={`Légende des montants ${modeLabel}`} aria-describedby={`${id}-scope`}>
        {distribution.rows.map((row, index) => <div key={row.id} data-category-row={row.id}>
          <dt><span className="budget-category-badge" style={{ backgroundColor: row.color }} aria-hidden="true">{index + 1}</span>{row.label}</dt>
          <dd className="budget-category-values"><strong>{!row.supported ? 'Non distingué' : row.value?.status === 'invalid' ? 'Total indisponible' : row.value?.amount === null && row.value.excluded.length ? 'Non convertible' : amountLabel(row.value?.amount, currency)}</strong>
            <span className="budget-category-percentage">{row.percentage === null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(row.percentage)} %`}</span></dd>
          {row.supported && Boolean(row.value?.absentCount) && <dd className="budget-meta">{row.value!.absentCount} montant(s) non renseigné(s)</dd>}
          {row.supported && Boolean(row.value?.excluded.length) && <dd className="budget-warning">{row.value!.excluded.length} montant(s) non convertible(s) ou invalide(s)</dd>}
        </div>)}
      </dl>
    </div>
    {Boolean(total?.absentCount) && <p className="budget-meta">{total!.absentCount} montant(s) {modeLabel} non renseigné(s), exclus de la répartition sans être considérés comme zéro.</p>}
    {Boolean(total?.excluded.length) && <p className="budget-warning">{total!.excluded.length} montant(s) {modeLabel} non intégré(s). Les valeurs d’origine et les causes figurent dans « Montants non intégrés aux totaux ».</p>}
    <p className="budget-meta">Les visites et sorties sont regroupées dans Activités, les repas dans Restauration, les activités de transport et transferts manuels dans Transport, les repos et autres dans Autres. Le modèle actuel ne distingue pas l’hébergement ; aucun lieu n’est reclassé d’après son nom.</p>
    {mode === 'paid' && <p className="budget-meta">Les transferts ne disposent pas encore de montant payé : aucun paiement n’est déduit de leur estimation.</p>}
  </section>
}
