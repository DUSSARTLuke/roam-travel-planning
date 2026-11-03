import { useEffect, useRef, type RefObject } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { categoryLabels, periodLabels } from './activityPresentation'
import { ActivityDocuments } from './ActivityDocuments'
import { ActivityAdvancedDetails } from './ActivityAdvancedDetails'
import { formatDate } from './dates'

type Props = {
  activity: TripActivity
  returnFocusRef: RefObject<HTMLButtonElement | null>
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onEdit: () => void
}

export function ActivityDetailPanel({ activity, returnFocusRef, fallbackFocusRef, onClose, onEdit }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const backdropRef = useRef(false)

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
    <dialog ref={dialogRef} className="activity-panel activity-detail-panel" aria-labelledby="activity-detail-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        backdropRef.current = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && backdropRef.current) onClose()
        backdropRef.current = false
      }}>
      <header className="activity-panel-header activity-detail-header">
        <button type="button" className="secondary-button activity-edit" autoFocus onClick={onClose} aria-label="Fermer la fiche et revenir au Programme">
          <ArrowLeft size={18} /> Retour
        </button>
        <p className="eyebrow">FICHE ACTIVITÉ</p>
      </header>
      <div className="activity-detail-content">
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
        {activity.location && <section aria-labelledby="activity-detail-location">
          <h3 id="activity-detail-location">Lieu</h3><p>{activity.location}</p>
        </section>}
        {activity.notes && <section aria-labelledby="activity-detail-notes">
          <h3 id="activity-detail-notes">Notes</h3><p className="activity-detail-notes">{activity.notes}</p>
        </section>}
        <ActivityAdvancedDetails activity={activity} />
        <ActivityDocuments tripId={activity.tripId} activityId={activity.id} />
      </div>
      <footer className="activity-detail-footer">
        <button type="button" className="primary-button" onClick={onEdit}><Pencil size={18} /> Modifier l’activité</button>
      </footer>
    </dialog>
  )
}
