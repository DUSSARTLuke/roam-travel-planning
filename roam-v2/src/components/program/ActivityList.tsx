import { OrganizationActions } from './ActivityOrganization'
import { MapPin, Pencil, Plus } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { activityScheduleLabel, categoryLabels } from './activityPresentation'
import { formatDate } from './dates'

type Props = {
  activities: TripActivity[]
  onEdit: (activity: TripActivity) => void
  onOpen: (activity: TripActivity, trigger: HTMLButtonElement) => void
  onAdd?: () => void
  ideas?: boolean
  showDate?: boolean
}

export function ActivityCard({ activity, onEdit, onOpen, showDate = false, showSchedule = true }: {
  activity: TripActivity; onEdit: Props['onEdit']; onOpen: Props['onOpen']; showDate?: boolean; showSchedule?: boolean
}) {
  return (
    <article className="activity-card">
      <div className="activity-card-content">
        <p className="activity-meta">{categoryLabels[activity.category]}{showSchedule && <> · {activityScheduleLabel(activity)}</>}</p>
        <h3><button type="button" className="activity-card-open" aria-haspopup="dialog" aria-label={`Consulter l’activité ${activity.title}`}
          onClick={(event) => onOpen(activity, event.currentTarget)}>{activity.title}</button></h3>
        {showDate && activity.date && <p className="activity-meta">{formatDate(activity.date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
        {activity.location && <p className="activity-location"><MapPin size={16} aria-hidden="true" />{activity.location}</p>}
      </div>
      <div className="activity-card-actions"><OrganizationActions activity={activity} />
      <button type="button" className="secondary-button activity-edit" aria-haspopup="dialog" aria-label={`Modifier l’activité ${activity.title}`} onClick={(event) => { event.stopPropagation(); onEdit(activity) }}>
        <Pencil size={17} /> Modifier
      </button></div>
    </article>
  )
}

export function ActivityList({ activities, onEdit, onOpen, onAdd, ideas = false, showDate = false }: Props) {
  if (activities.length === 0) return (
    <div className="program-empty">
      <h3>{ideas ? 'Des envies pour ce voyage ?' : 'Une journée à imaginer'}</h3>
      <p>{ideas ? 'Garde ici tes idées, même sans avoir choisi de journée.' : 'Aucune activité n’est encore programmée pour cette journée.'}</p>
      {onAdd && <button type="button" className="primary-button" onClick={onAdd}><Plus size={18} />{ideas ? 'Ajouter une idée' : 'Ajouter une activité'}</button>}
    </div>
  )
  return (
    <div className="activity-list">
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} onEdit={onEdit} onOpen={onOpen} showDate={showDate} />
      ))}
    </div>
  )
}
