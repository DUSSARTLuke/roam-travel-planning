import { activityVersion, ActivityEditConflict } from '../../db/activityRevision'
import { activityDraftText } from './activityDraft'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { X } from 'lucide-react'
import { getActivity } from '../../db/activities'
import type { ActivityCategory, ActivityPeriod, TripActivity } from '../../db/activityModel'
import { activityFormInput, initialActivityValues, type ActivityFormValues } from './activityFormModel'
import { saveActivityWithDocuments, listDocuments } from '../../db/documents'
import { prepareDocuments } from '../../db/documentModel'
import { ActivityDocuments, type PendingDocument } from './ActivityDocuments'
import { ActivityLocationFields } from './ActivityLocationFields'
import { ActivityAdvancedFields } from './ActivityAdvancedFields'
import { categoryLabels, periodLabels } from './activityPresentation'

type Props = {
  participants?: readonly import('../../money/expenseSharing').TripParticipant[]
  referenceCurrency: string
  tripId: string
  initialDate: string | null
  fallbackDate: string
  activity: TripActivity | null
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
  readDocuments?: typeof listDocuments
  readActivity?: typeof getActivity
  persistActivity?: typeof saveActivityWithDocuments
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

export function ActivityFormPanel({ participants = [], referenceCurrency, tripId, initialDate, fallbackDate, activity, fallbackFocusRef, onClose, onSaved, readActivity = getActivity, persistActivity = saveActivityWithDocuments, readDocuments = listDocuments }: Props) {
  const [openingActivity] = useState(activity)
  const [baseline, setBaseline] = useState(activity)
  const [ready, setReady] = useState(activity === null)
  const [conflict, setConflict] = useState(false)
  const [recoveries, setRecoveries] = useState<ActivityFormValues[]>([])
  const [initial, setInitial] = useState(() => initialActivityValues(activity, initialDate, fallbackDate, referenceCurrency))
  const [form, setForm] = useState(initial)
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const savingRef = useRef(false)
  const backdropRef = useRef(false)
  const discardFocusRef = useRef<HTMLElement | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || pendingDocuments.length > 0 || recoveries.length > 0
  useReloadBlocker(dirty || busy, 'Enregistre ou abandonne les modifications de l’activité avant la mise à jour.')

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
    if (!openingActivity) return
    let active = true
    readActivity(tripId, openingActivity.id).then((latest) => {
      if (!active) return
      if (JSON.stringify(latest) !== JSON.stringify(openingActivity) || !activityVersion(latest)) { setConflict(true); setError(new ActivityEditConflict().message); return }
      setBaseline(latest); setReady(true)
    }, (caught) => { if (active) { setConflict(true); setError(caught instanceof Error ? caught.message : 'Cette activité n’est plus disponible. Ta saisie est conservée.') } })
    return () => { active = false }
  }, [openingActivity, tripId, readActivity])

  async function reloadRecent() {
    if (savingRef.current || !openingActivity) return
    savingRef.current = true; setBusy(true)
    try {
      const latest = await readActivity(tripId, openingActivity.id)
      if (!activityVersion(latest)) throw new ActivityEditConflict()
      const next = initialActivityValues(latest, latest.date, fallbackDate, referenceCurrency)
      setRecoveries((old) => [...old, { ...form, links: form.links.map((link) => ({ ...link })) }])
      setInitial(next); setForm(next); setBaseline(latest); setReady(true); setConflict(false); setError('')
    } catch (caught) { setReady(false); setConflict(true); setError(caught instanceof Error ? caught.message : 'Impossible de recharger. Ta saisie est conservée.') }
    finally { savingRef.current = false; setBusy(false) }
  }

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

  async function selectDocuments(files: File[], storedCount: number) {
    if (savingRef.current) return
    savingRef.current = true
    setBusy(true)
    setError('')
    try {
      if (storedCount + pendingDocuments.length + files.length > 5) throw new Error('Maximum 5 documents par activité. Aucun fichier de cette sélection n’a été ajouté.')
      const prepared = await prepareDocuments(files)
      setPendingDocuments((previous) => [...previous, ...files.map((file, index) => ({ file, mime: prepared[index].mime }))])
    } catch (caught) {
      setError(caught instanceof Error && caught.name === 'Error' ? caught.message : 'Impossible de lire ces fichiers. Aucun fichier de cette sélection ajouté.')
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current || discard || !ready) return
    savingRef.current = true
    setBusy(true)
    setError('')
    try {
      if (activity && activity.tripId !== tripId) throw new Error('Cette activité appartient à un autre voyage.')
      const input = activityFormInput(form, baseline)
      const saved = await persistActivity(tripId, input, baseline?.id ?? null, pendingDocuments.map(({ file }) => file), activityVersion(baseline))
      onSaved(saved)
    } catch (caught) {
      console.error('Échec de sauvegarde de l’activité.', caught)
      if (caught instanceof ActivityEditConflict) { setConflict(true); setReady(false) }
      setError(caught instanceof Error && caught.name === 'QuotaExceededError'
        ? 'Espace de stockage local insuffisant. Aucun changement enregistré ; tes saisies et fichiers restent en attente.'
        : caught instanceof Error ? caught.message : 'Impossible d’enregistrer cette activité. Réessaie.')
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
      <form onSubmit={save} onInvalidCapture={(event) => {
        if (event.target instanceof HTMLElement) event.target.closest('details')?.setAttribute('open', '')
      }} className="activity-panel-form" inert={discard}>
        <fieldset disabled={busy || discard} inert={busy || discard}>
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
          <fieldset className="activity-participants"><legend>Participants</legend>
            <label className="activity-checkbox"><input type="checkbox" checked={form.participantIds === undefined} onChange={event => setField('participantIds', event.target.checked ? undefined : [])} />Tous les voyageurs (activité collective)</label>
            {participants.map(person => <label className="activity-checkbox" key={person.id}><input type="checkbox" checked={form.participantIds === undefined || form.participantIds.includes(person.id)} onChange={event => {
              const selected = form.participantIds ?? participants.map(item => item.id)
              setField('participantIds', event.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))
            }} />{person.name}</label>)}
            {!participants.length && <p className="activity-meta">Ajoute les voyageurs dans le partage entre voyageurs du Budget pour les sélectionner ici.</p>}
            {form.participantIds?.length === 0 && <p className="activity-meta">Aucun participant sélectionné.</p>}
          </fieldset>
          <details className="activity-extra">
            <summary>Informations complémentaires</summary>
            <ActivityLocationFields form={form} onChange={setForm} />
            <label>Notes<textarea rows={4} value={form.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
          </details>
          <ActivityAdvancedFields form={form} onChange={setForm} />
          <ActivityDocuments readDocuments={readDocuments} tripId={tripId} activityId={activity?.id ?? null} pending={pendingDocuments}
            onSelect={(files, count) => { void selectDocuments(files, count) }} />
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        {conflict && <div className="activity-discard"><p>Aucun champ n’est fusionné automatiquement. Le rechargement remplacera les champs par les données récentes ; ta saisie actuelle restera disponible ci-dessous et les nouveaux fichiers resteront sélectionnés.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => { void reloadRecent() }}>Recharger les données récentes</button></div>}
        {!ready && !conflict && <p role="status">Vérification de la version de l’activité…</p>}
        {recoveries.map((draft, index) => <details className="activity-extra" key={index}><summary>Ma saisie conservée avant rechargement ({index + 1})</summary><p>Copie les informations utiles dans les champs récents. Cette saisie n’est pas appliquée automatiquement.</p><label>Saisie précédente<textarea readOnly rows={8} value={activityDraftText(draft)} onFocus={(event) => event.currentTarget.select()} /></label></details>)}
        <footer className="activity-panel-footer">
          <button type="button" className="secondary-button" disabled={busy || discard} onClick={requestClose}>Annuler</button>
          <button type="submit" className="primary-button" disabled={busy || discard || !ready}>{busy ? 'Enregistrement…' : activity ? 'Enregistrer les modifications' : 'Ajouter l’activité'}</button>
        </footer>
      </form>
      {discard && <DiscardPrompt onContinue={continueEditing} onDiscard={onClose} />}
    </dialog>
  )
}
