import { useRef, useState } from 'react'
import { CurrencySelector } from './CurrencySelector'
import type { ManualRateDraft } from '../../money/manualRates'
import './manual-rates.css'

type Props = { rates: ManualRateDraft[]; referenceCurrency: string; onChange: (rates: ManualRateDraft[]) => void; disabled: boolean }
export function ManualRatesEditor({ rates, referenceCurrency, onChange, disabled }: Props) {
  const addButton = useRef<HTMLButtonElement>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  function patch(index: number, fields: Partial<ManualRateDraft>) {
    onChange(rates.map((rate, position) => position === index ? { ...rate, ...fields } : rate))
  }
  return <details className="manual-rates">
    <summary>Taux de change manuels ({rates.length})</summary>
    <p>1 unité source = taux × devise cible. Aucun taux inverse n’est déduit. Les changements sont enregistrés avec le voyage.</p>
    <fieldset disabled={disabled} inert={disabled}>
      {rates.length === 0 && <p>Aucun taux manuel enregistré.</p>}
      {rates.map((rate, index) => <section className="manual-rate" key={index} aria-label={`Taux ${index + 1}`}>
        <CurrencySelector label="Devise source" value={rate.sourceCurrency} onChange={(code) => patch(index, { sourceCurrency: code })} />
        <CurrencySelector label="Devise cible" value={rate.targetCurrency} onChange={(code) => patch(index, { targetCurrency: code })} />
        <label>Taux : 1 {rate.sourceCurrency} en {rate.targetCurrency}
          <input inputMode="decimal" type="text" required value={rate.value} placeholder="Ex. 0,85"
            onChange={(event) => patch(index, { value: event.target.value })} />
        </label>
        <p className="activity-meta">{rate.updatedAt ? <>Dernière modification enregistrée : <time dateTime={rate.updatedAt}>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(rate.updatedAt))}</time></> : 'Nouveau taux — non enregistré'}</p>
        <button type="button" data-remove-rate className="secondary-button danger-text" aria-expanded={removing === index}
          onClick={() => setRemoving(removing === index ? null : index)}>Supprimer ce taux</button>
        {removing === index && <div role="group" aria-label={`Confirmer le retrait du taux ${rate.sourceCurrency}/${rate.targetCurrency}`}>
          <p>Retirer le taux {rate.sourceCurrency} → {rate.targetCurrency} ? Le retrait sera enregistré avec le voyage.</p>
          <button type="button" className="secondary-button" onClick={(event) => { event.currentTarget.closest('section')?.querySelector<HTMLButtonElement>('[data-remove-rate]')?.focus(); setRemoving(null) }}>Conserver</button>
          <button type="button" className="secondary-button danger-text" onClick={() => { onChange(rates.filter((_, position) => position !== index)); setRemoving(null); addButton.current?.focus() }}>Confirmer le retrait</button>
        </div>}
      </section>)}
      <button ref={addButton} type="button" className="secondary-button" onClick={() => { setRemoving(null); onChange([...rates, { sourceCurrency: referenceCurrency === 'USD' ? 'EUR' : 'USD', targetCurrency: referenceCurrency, value: '' }]) }}>Ajouter un taux</button>
    </fieldset>
  </details>
}
