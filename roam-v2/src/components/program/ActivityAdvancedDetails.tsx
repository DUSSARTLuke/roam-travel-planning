import { isSafeActivityUrl, type TripActivity } from '../../db/activityModel'
import type { Trip } from '../../db/database'
import { ActivityMoneyDetails } from './ActivityMoneyDetails'
import { reservationLabels } from './activityPresentation'
import { formatDate } from './dates'

function ActivityLink({ title, url }: { title: string; url: string }) {
  return <li>{isSafeActivityUrl(url)
    ? <a href={url} target="_blank" rel="noopener noreferrer">{title}<span className="activity-meta">{url} · Nouvel onglet</span></a>
    : <span>{title}<span className="activity-meta">URL non prise en charge</span></span>}</li>
}

export function ActivityAdvancedDetails({ activity, trip }: { activity: TripActivity; trip: Trip }) {
  const reservation = activity.reservationStatus !== undefined || activity.reservationReference || activity.reservationProvider ||
    activity.reservationPeople !== undefined || activity.reservationDeadline || activity.reservationNotes
  const links = activity.links ?? []
  return <>
    {reservation && <section aria-labelledby="activity-detail-reservation">
      <h3 id="activity-detail-reservation">Réservation</h3>
      <dl className="activity-detail-fields">
        <div><dt>Statut</dt><dd>{activity.reservationStatus ? reservationLabels[activity.reservationStatus] : 'Non renseigné'}</dd></div>
        {activity.reservationReference && <div><dt>Référence de confirmation</dt><dd>{activity.reservationReference}</dd></div>}
        {activity.reservationProvider && <div><dt>Prestataire</dt><dd>{activity.reservationProvider}</dd></div>}
        {activity.reservationPeople !== undefined && <div><dt>Personnes</dt><dd>{activity.reservationPeople}</dd></div>}
        {activity.reservationDeadline && <div><dt>Date limite</dt><dd>{formatDate(activity.reservationDeadline, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>}
        {activity.reservationNotes && <div><dt>Notes de réservation</dt><dd className="activity-detail-notes">{activity.reservationNotes}</dd></div>}
      </dl>
    </section>}
    <ActivityMoneyDetails activity={activity} trip={trip} />
    {(activity.url || links.length > 0) && <section aria-labelledby="activity-detail-links">
      <h3 id="activity-detail-links">Liens utiles</h3>
      <ul className="activity-detail-links">
        {activity.url && <ActivityLink title="Lien historique" url={activity.url} />}
        {links.map((link) => <ActivityLink key={link.id} title={link.title} url={link.url} />)}
      </ul>
    </section>}
  </>
}
