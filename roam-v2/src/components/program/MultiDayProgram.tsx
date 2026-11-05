import type { ManualTransfer } from '../../db/transferModel'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Plus, Route } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { DayTimeline } from './DayTimeline'
import { formatDate } from './dates'
import { multiDayGroup } from './programNavigation'

type Props = {
  transfers?: readonly ManualTransfer[]
  days: string[]; selectedDate: string; activities: TripActivity[]; onSelect: (day: string) => void
  onAddTransfer?: (day: string, trigger: HTMLButtonElement) => void
  onAdd?: (day: string) => void; onEdit: (activity: TripActivity) => void
  onOpen: (activity: TripActivity, trigger: HTMLButtonElement) => void
  afterActivity?: (activity: TripActivity) => ReactNode
}
export function MultiDayProgram({ days, selectedDate, activities, onSelect, onAdd, onAddTransfer, onEdit, onOpen, afterActivity, transfers }: Props) {
  const id = useId()
  const selectedRef = useRef<HTMLElement>(null)
  const selectionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const group = multiDayGroup(days, selectedDate)
  // A group owns its viewport, including the browser's native scroll state.
  // Replacing it on pagination prevents late scroll/gesture restoration on the
  // old element from moving the new group. Selection within a group keeps it.
  const groupKey = group.days.join('|')
  useEffect(() => {
    // Selecting a day replaces its button with a badge. Keep keyboard focus
    // in that column instead of letting it fall back to the document body.
    if (selectionTriggerRef.current && !selectionTriggerRef.current.isConnected) {
      selectedRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
      selectionTriggerRef.current = null
    }
  }, [selectedDate])
  // One already-live list, grouped in memory; never one IndexedDB query per day.
  const byDay = new Map<string, TripActivity[]>()
  for (const day of group.days) byDay.set(day, [])
  for (const activity of activities) if (activity.date !== null) byDay.get(activity.date)?.push(activity)
  return <section className="program-multi" aria-label="Programme multi-jours">
    <nav className="program-multi-nav" aria-label="Groupes de journées">
      <button type="button" className="secondary-button" disabled={!group.previous} onClick={() => group.previous && onSelect(group.previous)}
        aria-label="Groupe de jours précédent"><ChevronLeft size={18} aria-hidden="true" />Précédents</button>
      <p role="status" aria-live="polite">Jours {group.start + 1} à {group.start + group.days.length} sur {days.length}</p>
      <button type="button" className="secondary-button" disabled={!group.next} onClick={() => group.next && onSelect(group.next)}
        aria-label="Groupe de jours suivant">Suivants<ChevronRight size={18} aria-hidden="true" /></button>
    </nav>
    <p className="activity-meta" id={`${id}-hint`}>Sélectionne une journée pour les ajouts. Sur petit écran, fais défiler les colonnes horizontalement ; au clavier, utilise Tab ou les flèches dans cette zone.</p>
    <div key={groupKey} className="program-multi-columns" role="region" aria-label="Journées côte à côte" aria-describedby={`${id}-hint`} tabIndex={0}
      style={{ gridTemplateColumns: `repeat(${group.days.length}, minmax(min(100%, 340px), 1fr))` }}>
      {group.days.map((day) => <section key={day} ref={day === selectedDate ? selectedRef : undefined} className={`program-multi-day ${day === selectedDate ? 'selected' : ''}`} aria-labelledby={`${id}-${day}`} aria-describedby={day === selectedDate ? `${id}-selected` : undefined} data-day={day}>
        <header className="program-multi-day-header">
          <h2 id={`${id}-${day}`} tabIndex={-1}>{formatDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          {day === selectedDate ? <span id={`${id}-selected`} className="program-multi-selected">Journée sélectionnée</span>
            : <button type="button" className="secondary-button" aria-pressed={false} aria-label={`Sélectionner la journée du ${formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}`}
              onClick={(event) => { selectionTriggerRef.current = event.currentTarget; onSelect(day) }}>Sélectionner ce jour</button>}
          {onAdd && (byDay.get(day)?.length ?? 0) > 0 && <button type="button" className="secondary-button" aria-label={`Ajouter une activité le ${formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}`}
            onClick={() => onAdd(day)}><Plus size={16} aria-hidden="true" />Ajouter une activité</button>}
          {onAddTransfer && (byDay.get(day)?.length ?? 0) >= 2 && <button type="button" className="secondary-button" aria-haspopup="dialog"
            aria-label={`Ajouter un déplacement le ${formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}`}
            onClick={(event) => onAddTransfer(day, event.currentTarget)}><Route size={16} aria-hidden="true" />Ajouter un déplacement</button>}
        </header>
        <DayTimeline transfers={transfers} activities={byDay.get(day) ?? []} onAdd={onAdd ? () => onAdd(day) : undefined} onEdit={onEdit} onOpen={onOpen} afterActivity={afterActivity} />
      </section>)}
    </div>
  </section>
}
