import { useMemo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { ActivityCard, ActivityList } from './ActivityList'
import { buildDayPlanning, planningDuration, planningTime } from './dayPlanning'

type Props = { afterActivity?: (activity: TripActivity) => ReactNode; activities: TripActivity[]; onAdd?: () => void; onEdit: (activity: TripActivity) => void; onOpen: (activity: TripActivity, trigger: HTMLButtonElement) => void }
export function DayTimeline({ activities, onAdd, onEdit, onOpen, afterActivity }: Props) {
  const planning = useMemo(() => buildDayPlanning(activities), [activities])
  if (!activities.length) return <ActivityList activities={activities} onAdd={onAdd} onEdit={onEdit} onOpen={onOpen} />
  return <div className="day-planning">
    {planning.conflictCount > 0 && <p className="day-planning-warning" role="status">{planning.conflictCount} activités ont des horaires en conflit. Vérifie leurs heures sans déplacement automatique.</p>}
    {planning.hasUnknownEnd && <p className="activity-meta">Une fin non renseignée limite le calcul des créneaux libres et des chevauchements.</p>}
    {planning.entries.length ? <ol className="day-timeline" aria-label="Planning chronologique de la journée">
      {planning.entries.map((entry) => entry.kind === 'free'
        ? <li className="day-timeline-free" key={`free-${entry.start}-${entry.end}`}>
          <span><time dateTime={planningTime(entry.start)}>{planningTime(entry.start)}</time> – <time dateTime={planningTime(entry.end)}>{planningTime(entry.end)}</time></span>
          <span>Créneau libre entre activités horaires · {planningDuration(entry.durationMinutes)}</span>
        </li>
        : <li className="day-timeline-item" key={`activity-${entry.activity.id}`}>
          <div className="day-timeline-time">
            <time dateTime={planningTime(entry.start)}>{planningTime(entry.start)}</time>
            {entry.end !== undefined ? <><span>à <time dateTime={planningTime(entry.end)}>{planningTime(entry.end)}</time></span><small>{planningDuration(entry.durationMinutes!)}</small></> : <small>Fin non renseignée</small>}
          </div>
          <div className="day-timeline-content">
            <ActivityCard activity={entry.activity} onEdit={onEdit} onOpen={onOpen} showSchedule={false} />
            {afterActivity?.(entry.activity)}
            {entry.conflicts.length > 0 && <p className="day-planning-warning"><TriangleAlert size={15} aria-hidden="true" /><span>
              {entry.conflicts.filter((conflict) => conflict.kind === 'overlap').length > 0 && <>Chevauchement avec {entry.conflicts.filter((conflict) => conflict.kind === 'overlap').map((conflict) => `« ${conflict.activity.title} »`).join(', ')}. </>}
              {entry.conflicts.filter((conflict) => conflict.kind === 'same-start').length > 0 && <>Même heure de début que {entry.conflicts.filter((conflict) => conflict.kind === 'same-start').map((conflict) => `« ${conflict.activity.title} »`).join(', ')}.</>}
            </span></p>}
          </div>
        </li>)}
    </ol> : <p className="activity-meta">Aucun horaire précis n’est encore renseigné pour cette journée.</p>}
    {planning.toOrganize.length > 0 && <section className="day-to-organize" aria-label="Activités à organiser">
      <h3>À organiser ({planning.toOrganize.length})</h3>
      <p className="activity-meta">Sans heure précise. Les moments de journée sont conservés ; les créneaux libres affichés restent à confirmer selon ces activités.</p>
      <ActivityList activities={planning.toOrganize} onEdit={onEdit} onOpen={onOpen} afterActivity={afterActivity} />
    </section>}
  </div>
}
