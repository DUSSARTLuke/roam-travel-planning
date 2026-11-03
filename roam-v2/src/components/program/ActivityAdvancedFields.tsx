import { useRef } from 'react'
import type { ActivityFormValues } from './activityFormModel'
import type { ReservationStatus } from '../../db/activityModel'
import { reservationLabels } from './activityPresentation'

type Props = { form: ActivityFormValues; onChange: (form: ActivityFormValues) => void }

export function ActivityAdvancedFields({ form, onChange }: Props) {
  const addLinkRef = useRef<HTMLButtonElement>(null)
  function addLink() {
    const id = crypto.randomUUID()
    field('links', [...form.links, { id, title: '', url: '' }])
    requestAnimationFrame(() => document.getElementById(`activity-link-title-${id}`)?.focus())
  }
  function field<K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) {
    onChange({ ...form, [key]: value })
  }
  return <>
    <details className="activity-extra">
      <summary>Réservation</summary>
      <label>Statut<select value={form.reservationStatus} onChange={(event) => field('reservationStatus', event.target.value as ReservationStatus | '')}>
        <option value="">Non renseigné</option>
        {Object.entries(reservationLabels).filter(([value]) => value !== 'pending' || form.reservationStatus === 'pending')
          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Référence de confirmation<input value={form.reservationReference} onChange={(event) => field('reservationReference', event.target.value)} /></label>
      <label>Prestataire<input value={form.reservationProvider} onChange={(event) => field('reservationProvider', event.target.value)} /></label>
      <label>Nombre de personnes<input type="number" min="1" step="1" value={form.reservationPeople} onChange={(event) => field('reservationPeople', event.target.value)} /></label>
      <label>Date limite<input type="date" value={form.reservationDeadline} onChange={(event) => field('reservationDeadline', event.target.value)} /></label>
      <label>Notes de réservation<textarea rows={3} value={form.reservationNotes} onChange={(event) => field('reservationNotes', event.target.value)} /></label>
    </details>
    <details className="activity-extra">
      <summary>Budget</summary>
      <p className="activity-meta">Montants dans la devise de cette activité. Aucune conversion automatique.</p>
      <div className="form-row">
        <label>Prix estimé<input type="number" min="0" step="any" value={form.estimatedCost} onChange={(event) => field('estimatedCost', event.target.value)} /></label>
        <label>Montant payé<input type="number" min="0" step="any" value={form.paidAmount} onChange={(event) => field('paidAmount', event.target.value)} /></label>
      </div>
      <label>Devise ISO (ex. EUR, GBP, USD)<input autoCapitalize="characters" maxLength={3} value={form.currency} onChange={(event) => field('currency', event.target.value)} /></label>
    </details>
    <details className="activity-extra">
      <summary>Liens utiles</summary>
      {form.legacyUrl !== '' && <label>Lien historique<input type="url" value={form.legacyUrl} onChange={(event) => field('legacyUrl', event.target.value)} /><span className="activity-meta">Conservé depuis la version précédente. Efface l’URL pour le retirer.</span></label>}
      {form.links.map((link, index) => <fieldset className="activity-link-editor" key={link.id}>
        <legend>Lien {index + 1}</legend>
        <label>Titre du lien<input id={`activity-link-title-${link.id}`} required value={link.title} onChange={(event) => field('links', form.links.map((item) => item.id === link.id ? { ...item, title: event.target.value } : item))} /></label>
        <label>URL HTTP/HTTPS<input type="url" required value={link.url} onChange={(event) => field('links', form.links.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item))} /></label>
        <button type="button" className="secondary-button danger-text" onClick={() => { field('links', form.links.filter((item) => item.id !== link.id)); addLinkRef.current?.focus() }}>Retirer le lien {index + 1}</button>
      </fieldset>)}
      <button type="button" ref={addLinkRef} className="secondary-button activity-link-add" onClick={addLink}>Ajouter un lien</button>
    </details>
  </>
}
