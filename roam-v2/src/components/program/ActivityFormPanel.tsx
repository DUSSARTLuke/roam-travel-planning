import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { X } from 'lucide-react'
import { createActivity, getActivity, updateActivity } from '../../db/activities'
import type { ActivityCategory, ActivityPeriod, TripActivity } from '../../db/activityModel'
import { activityFormInput, initialActivityValues, type ActivityFormValues } from './activityFormModel'
import { categoryLabels, periodLabels } from './activityPresentation'

type Props = {
  tripId: string
  initialDate: string | null
  fallbackDate: string
  activity: TripActivity | null
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onSaved: (activity: TripActivity) => void
}

function DiscardPrompt({ onContinue, onDiscard }: { onContinue: () => void; onDiscard: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  return (
    <section className="activity-discard" role="alertdialog" aria-labelledby="activity-discard-title" aria-describedby="activity-discard-description">
      <h3 id="activity-discard-title">Abandonner les modifications ?</h3>
      <p id="activity-discard-description">Tes modifications n’ont pas été enregistrées.</p>
      <div className="form-actions">
        <button ref={cancelRef} type="button" className="secondary-button" onClick={onContinue}>Continuer la saisie</button>
        <button type="button" className="primary-button danger-button" onClick={onDiscard}>Abandonner</button>
      </div>
    </section>
  )
}

export function ActivityFormPanel({ tripId, initialDate, fallbackDate, activity, fallbackFocusRef, onClose, onSaved }: Props) {
  const [initial] = useState(() => initialActivityValues(activity, initialDate, fallbackDate))
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const savingRef = useRef(false)
  const backdropRef = useRef(false)
  const discardFocusRef = useRef<HTMLElement | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  useEffect(() => {
    const dialog = dialogRef.current!
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      else fallbackFocusRef.current?.focus()
    }
  }, [fallbackFocusRef])

  useEffect(() => {
    if (!dirty) return
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  function setField<K extends keyof ActivityFormValues>(field: K, value: ActivityFormValues[K]) {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  function requestClose() {
    if (savingRef.current) return
    if (dirty) {
      if (!discard && document.activeElement instanceof HTMLElement) discardFocusRef.current = document.activeElement
      setDiscard(true)
    } else onClose()
  }

  function continueEditing() {
    setDiscard(false)
    requestAnimationFrame(() => {
      if (discardFocusRef.current?.isConnected) discardFocusRef.current.focus()
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current || discard) return
    savingRef.current = true
    setBusy(true)
    setError('')
    try {
      if (activity && activity.tripId !== tripId) throw new Error('Cette activité appartient à un autre voyage.')
      const latest = activity ? await getActivity(tripId, activity.id) : null
      const input = activityFormInput(form, latest)
      const saved = latest ? await updateActivity(tripId, latest.id, input) : await createActivity(tripId, input)
      onSaved(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible d’enregistrer cette activité. Réessaie.')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="activity-panel" aria-labelledby="activity-panel-title" aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (discard) continueEditing(); else requestClose() }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        backdropRef.current = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
      }}
      onClick={(event) => { if (event.target === event.currentTarget && backdropRef.current) requestClose(); backdropRef.current = false }}>
      <header className="activity-panel-header" inert={discard}>
        <div><p className="eyebrow">PROGRAMME</p><h2 id="activity-panel-title">{activity ? 'Modifier l’activité' : 'Nouvelle activité'}</h2></div>
        <button type="button" className="modal-close" aria-label="Fermer le formulaire" disabled={busy || discard} onClick={requestClose}><X size={20} /></button>
      </header>
      <form onSubmit={save} className="activity-panel-form" inert={discard}>
        <fieldset disabled={busy || discard}>
          <label>Nom de l’activité *<input autoFocus required value={form.title} onChange={(event) => setField('title', event.target.value)} /></label>
          <label>Catégorie<select value={form.category} onChange={(event) => setField('category', event.target.value as ActivityCategory)}>
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="activity-checkbox"><input type="checkbox" checked={form.idea} onChange={(event) => setField('idea', event.target.checked)} />Idée à planifier (sans date)</label>
          {!form.idea && <label>Date *<input type="date" required value={form.date} onChange={(event) => setField('date', event.target.value)} /></label>}
          <label>Planification<select value={form.scheduleType} onChange={(event) => setField('scheduleType', event.target.value as ActivityFormValues['scheduleType'])}>
            <option value="exact">Heure précise</option><option value="period">Moment de la journée</option><option value="unscheduled">Sans horaire</option>
          </select></label>
          {form.scheduleType === 'exact' && <div className="form-row">
            <label>Début *<input type="time" required value={form.startTime} onChange={(event) => setField('startTime', event.target.value)} /></label>
            <label>Fin (facultative)<input type="time" value={form.endTime} onChange={(event) => setField('endTime', event.target.value)} /></label>
          </div>}
          {form.scheduleType === 'period' && <label>Moment<select value={form.period} onChange={(event) => setField('period', event.target.value as ActivityPeriod)}>
            {Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>}
          <details className="activity-extra">
            <summary>Informations complémentaires</summary>
            <label>Lieu<input value={form.location} onChange={(event) => setField('location', event.target.value)} /></label>
            <label>Notes<textarea rows={4} value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
          </details>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="activity-panel-footer">
          <button type="button" className="secondary-button" disabled={busy || discard} onClick={requestClose}>Annuler</button>
          <button type="submit" className="primary-button" disabled={busy || discard}>{busy ? 'Enregistrement…' : activity ? 'Enregistrer les modifications' : 'Ajouter l’activité'}</button>
        </footer>
      </form>
      {discard && <DiscardPrompt onContinue={continueEditing} onDiscard={onClose} />}
    </dialog>
  )
}
