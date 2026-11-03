import { MapPin, Pencil, Plus } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { activityScheduleLabel, categoryLabels } from './activityPresentation'
import { formatDate } from './dates'

type Props = {
  activities: TripActivity[]
  onEdit: (activity: TripActivity) => void
  onAdd?: () => void
  ideas?: boolean
  showDate?: boolean
}

export function ActivityList({ activities, onEdit, onAdd, ideas = false, showDate = false }: Props) {
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
        <article className="activity-card" key={activity.id}>
          <div className="activity-card-content">
            <p className="activity-meta">{categoryLabels[activity.category]} · {activityScheduleLabel(activity)}</p>
            <h3>{activity.title}</h3>
            {showDate && activity.date && <p className="activity-meta">{formatDate(activity.date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
            {activity.location && <p className="activity-location"><MapPin size={16} aria-hidden="true" />{activity.location}</p>}
          </div>
          <button type="button" className="secondary-button activity-edit" aria-label={`Modifier l’activité ${activity.title}`} onClick={() => onEdit(activity)}>
            <Pencil size={17} /> Modifier
          </button>
        </article>
      ))}
    </div>
  )
}
