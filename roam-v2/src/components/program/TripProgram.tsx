import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Lightbulb, List, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listActivities } from '../../db/activities'
import type { TripActivity } from '../../db/activityModel'
import { ActivityDetailPanel } from './ActivityDetailPanel'
import { tripReferenceCurrency } from '../../db/currency'
import { ActivityFormPanel } from './ActivityFormPanel'
import { ActivityList } from './ActivityList'
import type { Trip } from '../../db/database'
import { formatDate, getTripDays, getTripMonths } from './dates'
import { TripCalendar } from './TripCalendar'
import './program.css'

function DayDetails({ date, activities, onAdd, onEdit, onOpen }: {
  date: string; activities: TripActivity[]; onAdd?: () => void; onEdit: (activity: TripActivity) => void
  onOpen: (activity: TripActivity, trigger: HTMLButtonElement) => void
}) {
  return (
    <section className="program-day-detail" aria-labelledby="program-day-title">
      <h2 id="program-day-title">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      <ActivityList activities={activities} onAdd={onAdd} onEdit={onEdit} onOpen={onOpen} />
    </section>
  )
}

function DayStrip({ days, selectedDate, onSelect }: { days: string[]; selectedDate: string; onSelect: (date: string) => void }) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedDate])
  return (
    <nav className="program-day-strip" aria-label="Journées du séjour">
      {days.map((date, index) => (
        <button type="button" key={date} ref={date === selectedDate ? selectedRef : undefined}
          className={`program-day-chip ${date === selectedDate ? 'selected' : ''}`}
          aria-pressed={date === selectedDate}
          aria-label={`Jour ${index + 1}, ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
          onClick={() => onSelect(date)}>
          <span>Jour {index + 1}</span>
          <strong>{formatDate(date, { weekday: 'short', day: 'numeric' })}</strong>
          <span>{formatDate(date, { month: 'short', year: 'numeric' })}</span>
        </button>
      ))}
    </nav>
  )
}

export function TripProgram({ trip }: { trip: Trip }) {
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const months = useMemo(() => getTripMonths(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [mode, setMode] = useState<'day' | 'calendar' | 'ideas'>('day')
  const [selectedDate, setSelectedDate] = useState(trip.startDate)
  const [month, setMonth] = useState(trip.startDate.slice(0, 7))
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const detailOriginRef = useRef<HTMLButtonElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ activity: TripActivity | null; date: string | null } | null>(null)
  const [reload, setReload] = useState(0)
  const result = useLiveQuery(() => listActivities(trip.id).then(
    (activities) => ({ activities, error: '' }),
    () => ({ activities: [] as TripActivity[], error: 'Impossible de charger les activités de ce voyage.' }),
  ), [trip.id, reload])
  const activities = result?.activities ?? []
  const detailActivity = activities.find((activity) => activity.id === detailId && activity.tripId === trip.id) ?? null
  // Invalidate the selection before rendering if the live query loses access
  // or the activity disappears (including changes made in another tab).
  if (detailId !== null && result !== undefined && (result.error || detailActivity === null)) {
    setDetailId(null)
    if (editor?.activity?.id === detailId) setEditor(null)
  }
  const ready = result !== undefined && !result.error && trip.archived !== true && trip.deletedAt === undefined
  const dayActivities = activities.filter((activity) => activity.date === selectedDate)
  const ideas = activities.filter((activity) => activity.date === null)
  const outsideDays = activities.filter((activity) => activity.date !== null && (activity.date < trip.startDate || activity.date > trip.endDate))
  const counts: Record<string, number> = {}
  for (const activity of activities) {
    if (activity.date !== null) counts[activity.date] = (counts[activity.date] ?? 0) + 1
  }

  function addActivity() {
    if (ready) setEditor({ activity: null, date: mode === 'ideas' ? null : selectedDate })
  }

  function openActivity(activity: TripActivity, trigger: HTMLButtonElement) {
    if (!ready || activity.tripId !== trip.id) return
    detailOriginRef.current = trigger
    setDetailId(activity.id)
  }

  function editActivity(activity: TripActivity) {
    if (ready && activity.tripId === trip.id) setEditor({ activity, date: activity.date })
  }

  function activitySaved(activity: TripActivity) {
    setEditor(null)
    // Editing from the detail panel returns to it without changing the source
    // day/list. Its data comes from the live query, not the editor snapshot.
    if (detailId !== null) return
    if (activity.date === null) setMode('ideas')
    else if (activity.date >= trip.startDate && activity.date <= trip.endDate) selectDay(activity.date)
  }

  function selectDay(date: string) {
    setSelectedDate(date)
    setMonth(date.slice(0, 7))
    setMode('day')
  }

  return (
    <section className="trip-program">
      <header className="program-heading">
        <p className="eyebrow">{trip.destination}</p>
        <h1>Programme</h1>
        <p className="subtitle">{days.length} journée{days.length > 1 ? 's' : ''} pour profiter du voyage.</p>
        <button type="button" ref={addButtonRef} className="primary-button program-add" disabled={!ready} onClick={addActivity}>
          <Plus size={18} />{mode === 'ideas' ? 'Ajouter une idée' : 'Ajouter une activité'}
        </button>
      </header>
      {result === undefined && <p role="status">Chargement des activités…</p>}
      {result?.error && <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => setReload((value) => value + 1)}>Réessayer</button></div>}
      {days.length === 0 ? <p className="empty-state" role="status">Les dates de ce voyage ne permettent pas d’afficher le programme. Vérifie les dates de départ et de retour.</p> : <>
        <div className="program-mode-switch" role="group" aria-label="Mode d’affichage du programme">
          <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}><List size={18} /> Jour par jour</button>
          <button type="button" aria-pressed={mode === 'calendar'} onClick={() => { setMonth(selectedDate.slice(0, 7)); setMode('calendar') }}><CalendarDays size={18} /> Calendrier</button>
          <button type="button" aria-pressed={mode === 'ideas'} onClick={() => setMode('ideas')}><Lightbulb size={18} /> Idées à planifier ({ideas.length})</button>
        </div>
        {mode === 'day' ? <>
          <DayStrip days={days} selectedDate={selectedDate} onSelect={selectDay} />
          {result && !result.error && <DayDetails date={selectedDate} activities={dayActivities} onAdd={ready ? addActivity : undefined} onEdit={editActivity} onOpen={openActivity} />}
        </> : mode === 'ideas' ? <section className="program-day-detail" aria-labelledby="program-ideas-title">
          <h2 id="program-ideas-title">Idées à planifier</h2>
          {result && !result.error && <ActivityList activities={ideas} ideas onAdd={ready ? addActivity : undefined} onEdit={editActivity} onOpen={openActivity} />}
        </section> : <TripCalendar months={months} month={month} startDate={trip.startDate} endDate={trip.endDate}
          selectedDate={selectedDate} activityCounts={counts} onMonthChange={setMonth} onSelect={selectDay} />}
      </>}
      {outsideDays.length > 0 && <section className="program-day-detail" aria-labelledby="program-outside-title">
        <h2 id="program-outside-title">Autres dates ({outsideDays.length})</h2>
        <p className="subtitle">Ces activités sont en dehors des dates actuelles du séjour. Tu peux modifier leur date pour les replanifier.</p>
        <ActivityList activities={outsideDays} onEdit={editActivity} onOpen={openActivity} showDate />
      </section>}
      {!editor && ready && detailActivity && <ActivityDetailPanel activity={detailActivity}
        returnFocusRef={detailOriginRef} fallbackFocusRef={addButtonRef}
        onClose={() => setDetailId(null)} onEdit={() => editActivity(detailActivity)} />}
      {editor && <ActivityFormPanel referenceCurrency={tripReferenceCurrency(trip)} tripId={trip.id} activity={editor.activity} initialDate={editor.date}
        fallbackDate={selectedDate} fallbackFocusRef={addButtonRef} onClose={() => setEditor(null)} onSaved={activitySaved} />}
    </section>
  )
}
