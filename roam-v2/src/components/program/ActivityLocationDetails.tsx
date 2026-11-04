import { ActivityMapPreview } from './ActivityMapPreview'
import type { TripActivity } from '../../db/activityModel'

export function ActivityLocationDetails({ activity }: { activity: TripActivity }) {
  if (!activity.location && !activity.address && activity.latitude === undefined && activity.longitude === undefined) return null
  return <section aria-labelledby="activity-detail-location">
    <h3 id="activity-detail-location">Lieu</h3>
    {activity.location && <p>{activity.location}</p>}
    {activity.address && <div><h4>Adresse</h4><p className="activity-detail-notes">{activity.address}</p></div>}
    {activity.latitude !== undefined && activity.longitude !== undefined && <dl className="activity-detail-fields">
      <div><dt>Latitude</dt><dd>{String(activity.latitude).replace('.', ',')}</dd></div>
      <div><dt>Longitude</dt><dd>{String(activity.longitude).replace('.', ',')}</dd></div>
    </dl>}
    <ActivityMapPreview activity={activity} />
  </section>
}
