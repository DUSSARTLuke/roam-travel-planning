import { OrganizationContext } from './organizationContext'
import { useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, Clock } from 'lucide-react'
import { compareActivities, type TripActivity } from '../../db/activityModel'
import { organizeActivity } from '../../db/activities'
import { schedulingKey } from '../../db/activityOrganization'
import type { Trip } from '../../db/database'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'

export function OrganizationActions({ activity }: { activity: TripActivity }) {
  const actions = useContext(OrganizationContext)
  if (!actions) return null
  const group = actions.activities.filter((item) => item.date === activity.date && item.scheduleType !== 'exact').sort(compareActivities)
  const index = group.findIndex((item) => item.id === activity.id)
  return <div className="activity-organization" role="group" aria-label={`Organiser ${activity.title}`}>
    <button type="button" className="secondary-button" disabled={actions.busy} aria-haspopup="dialog" aria-label={`Déplacer ${activity.title}`}
      onClick={(event) => { event.stopPropagation(); actions.open(activity, 'date', event.currentTarget) }}><CalendarDays size={16} aria-hidden="true" /> Déplacer</button>
    <button type="button" className="secondary-button" disabled={actions.busy} aria-haspopup="dialog" aria-label={`Horaire de ${activity.title}`}
      onClick={(event) => { event.stopPropagation(); actions.open(activity, 'time', event.currentTarget) }}><Clock size={16} aria-hidden="true" /> Horaire</button>
    {activity.scheduleType !== 'exact' && <>
      <button type="button" className="secondary-button" disabled={actions.busy || index <= 0} aria-label={`Monter ${activity.title}`}
        onClick={(event) => { event.stopPropagation(); actions.reorder(activity, 'up') }}><ArrowUp size={16} aria-hidden="true" /> Monter</button>
      <button type="button" className="secondary-button" disabled={actions.busy || index < 0 || index === group.length - 1} aria-label={`Descendre ${activity.title}`}
        onClick={(event) => { event.stopPropagation(); actions.reorder(activity, 'down') }}><ArrowDown size={16} aria-hidden="true" /> Descendre</button>
    </>}
  </div>
}

export function ActivityOrganizationPanel({ activity, trip, mode, trigger, onClose, fallbackFocusRef, persist = organizeActivity }: {
  activity: TripActivity; trip: Trip; mode: 'date' | 'time'; trigger: HTMLButtonElement; onClose: () => void; persist?: typeof organizeActivity; fallbackFocusRef?: RefObject<HTMLButtonElement | null>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [expected] = useState(() => schedulingKey(activity))
  const [date, setDate] = useState(activity.date ?? trip.startDate)
  const [idea, setIdea] = useState(activity.date === null)
  const [start, setStart] = useState(activity.startTime ?? '')
  const [end, setEnd] = useState(activity.endTime ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const dirty = mode === 'date' ? date !== (activity.date ?? trip.startDate) || idea !== (activity.date === null)
    : start !== (activity.startTime ?? '') || end !== (activity.endTime ?? '')
  useReloadBlocker(dirty || busy, 'Organisation d’une activité en cours')
  useEffect(() => {
    const dialog = dialogRef.current!
    const fallback = fallbackFocusRef?.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = overflow; if (trigger.isConnected) trigger.focus({ preventScroll: true }); else if (fallback?.isConnected) fallback.focus({ preventScroll: true }) }
  }, [trigger, fallbackFocusRef])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  function close() { if (!lock.current) { if (dirty) setDiscard(true); else onClose() } }
  async function save(remove = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      await persist(trip.id, activity.id, mode === 'date' ? { date: idea ? null : date }
        : remove ? { unscheduled: true } : { startTime: start, endTime: end || undefined }, expected)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer la planification.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialogRef} className="activity-panel activity-organization-panel" aria-labelledby="organization-title"
    onCancel={(event) => { event.preventDefault(); close() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
    }}>
    <header className="activity-panel-header"><h2 id="organization-title">{mode === 'date' ? 'Déplacer l’activité' : 'Modifier l’horaire'}</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={close}>Fermer</button></header>
    <form className="activity-panel-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <p>{activity.title}</p>
      <fieldset disabled={busy || discard} inert={busy || discard}>
        {mode === 'date' ? <>
          <label><span>Idée à planifier</span><input type="checkbox" checked={idea} onChange={(event) => setIdea(event.target.checked)} /></label>
          {!idea && <label>Nouvelle date<input autoFocus type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>}
          <p className="activity-meta">Séjour du {trip.startDate} au {trip.endDate}. Les autres dates restent autorisées, comme dans le formulaire complet.</p>
        </> : <>
          <label>Heure de début<input autoFocus type="time" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label>Heure de fin (facultative)<input type="time" min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <button type="button" className="secondary-button" onClick={() => void save(true)}>Retirer l’horaire — À organiser</button>
          <p className="activity-meta">Le retrait efface aussi le moment de journée éventuel, sans changer la date.</p>
        </>}
        <button type="submit" className="primary-button">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {discard && <div role="alert"><p>Abandonner ces modifications non enregistrées ?</p>
        <button type="button" className="secondary-button" autoFocus onClick={() => { setDiscard(false); requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus()) }}>Continuer la saisie</button>
        <button type="button" className="secondary-button" onClick={onClose}>Abandonner</button></div>}
      {busy && <p role="status">Enregistrement…</p>}
    </form>
  </dialog>
}
