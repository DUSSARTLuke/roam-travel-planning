import { deleteActivity } from '../../db/activities'
import { withSensitiveOperation } from '../../pwa/reloadSafety'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import './activity-delete.css'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { categoryLabels, periodLabels } from './activityPresentation'
import { ActivityDocuments } from './ActivityDocuments'
import { ActivityLocationDetails } from './ActivityLocationDetails'
import { ActivityAdvancedDetails } from './ActivityAdvancedDetails'
import { formatDate } from './dates'

type Props = {
  trip: Trip
  activity: TripActivity
  returnFocusRef: RefObject<HTMLButtonElement | null>
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
  removeActivity?: typeof deleteActivity
  closeLabel?: string
  onClose: () => void
  onEdit: () => void
}

export function ActivityDetailPanel({ trip, activity, returnFocusRef, fallbackFocusRef, onClose, onEdit, removeActivity = deleteActivity, closeLabel = 'Fermer la fiche et revenir au Programme' }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropRef = useRef(false)
  const [confirmation, setConfirmation] = useState<{ title: string; expected: string } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const lock = useRef(false), cancelRef = useRef<HTMLButtonElement>(null), deleteRef = useRef<HTMLButtonElement>(null)
  useReloadBlocker(busy, 'Suppression d’une activité en cours.')
  useEffect(() => { if (confirmation) cancelRef.current?.focus({ preventScroll: true }) }, [confirmation])
  function cancelDeletion() { if (lock.current) return; setConfirmation(null); setError(''); requestAnimationFrame(() => deleteRef.current?.focus({ preventScroll: true })) }
  async function confirmDeletion() {
    if (lock.current || !confirmation) return
    lock.current = true; setBusy(true); setError('')
    try { await withSensitiveOperation('Suppression d’une activité en cours.', () => removeActivity(trip.id, activity.id, confirmation.expected)); onClose() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de supprimer cette activité. Les données sont conservées ; réessaie.') }
    finally { lock.current = false; setBusy(false) }
  }

  useEffect(() => {
    const dialog = dialogRef.current!
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      const origin = returnFocusRef.current
      if (origin?.isConnected) origin.focus()
      else fallbackFocusRef.current?.focus()
    }
  }, [returnFocusRef, fallbackFocusRef])

  return (
    <dialog ref={dialogRef} className="activity-panel activity-detail-panel" aria-labelledby={confirmation ? 'activity-delete-title' : 'activity-detail-title'} aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!lock.current) { if (confirmation) cancelDeletion(); else onClose() } }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        backdropRef.current = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropRef.current && !lock.current) { if (confirmation) cancelDeletion(); else onClose() }
        backdropRef.current = false
      }}>
      <header className="activity-panel-header activity-detail-header">
        <button type="button" className="secondary-button activity-edit" autoFocus disabled={busy} onClick={() => { if (confirmation) cancelDeletion(); else onClose() }} aria-label={confirmation ? 'Annuler la suppression' : closeLabel}>
          <ArrowLeft size={18} /> Retour
        </button>
        <p className="eyebrow">FICHE ACTIVITÉ</p>
      </header>
      {confirmation ? <section className="activity-detail-content activity-delete-confirmation" aria-labelledby="activity-delete-title">
        <h2 id="activity-delete-title">Supprimer « {confirmation.title} » ?</h2>
        <p>Cette suppression est définitive. Les réservations et documents de cette activité seront supprimés, ainsi que les déplacements qui la relient à d’autres activités et les partages de dépenses associés.</p>
        <p>Les autres activités et leurs documents seront conservés.</p>
        {error && <p role="alert" className="form-error">{error}</p>}
      </section> : <div className="activity-detail-content">
        <p className="activity-detail-category">{categoryLabels[activity.category]}</p>
        <h2 id="activity-detail-title">{activity.title}</h2>
        <section aria-labelledby="activity-detail-planning">
          <h3 id="activity-detail-planning">Planification</h3>
          <dl className="activity-detail-fields">
            <div><dt>Date</dt><dd>{activity.date === null ? 'Idée à planifier' : formatDate(activity.date, {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}</dd></div>
            {activity.scheduleType === 'exact' ? <>
              <div><dt>Début</dt><dd>{activity.startTime}</dd></div>
              {activity.endTime && <div><dt>Fin</dt><dd>{activity.endTime}</dd></div>}
            </> : <div><dt>Horaire</dt><dd>{activity.scheduleType === 'period' ? periodLabels[activity.period] : 'Sans horaire'}</dd></div>}
          </dl>
        </section>
        <ActivityLocationDetails activity={activity} />
        {activity.notes && <section aria-labelledby="activity-detail-notes">
          <h3 id="activity-detail-notes">Notes</h3><p className="activity-detail-notes">{activity.notes}</p>
        </section>}
        <ActivityAdvancedDetails activity={activity} trip={trip} />
        <ActivityDocuments tripId={activity.tripId} activityId={activity.id} />
      </div>}
      <footer className="activity-detail-footer">
        {confirmation ? <>
          <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={cancelDeletion}>Annuler la suppression</button>
          <button type="button" className="primary-button danger-button" disabled={busy} onClick={() => { void confirmDeletion() }}>{busy ? 'Suppression…' : 'Supprimer définitivement l’activité'}</button>
        </> : <>
          <button type="button" className="primary-button" onClick={onEdit}><Pencil size={18} /> Modifier l’activité</button>
          {!trip.archived && trip.deletedAt === undefined && <button ref={deleteRef} type="button" className="secondary-button danger-text" onClick={() => { setError(''); setConfirmation({ title: activity.title, expected: JSON.stringify(activity) }) }}><Trash2 size={18} /> Supprimer l’activité</button>}
        </>}
      </footer>
    </dialog>
  )
}
