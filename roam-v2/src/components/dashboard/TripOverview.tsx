import { useActivityEditSnapshot } from '../program/useActivityEditSnapshot'
import { PreparationChecklist } from '../preparation/PreparationChecklist'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Trip } from '../../db/database'
import { listActivities } from '../../db/activities'
import type { TripActivity } from '../../db/activityModel'
import { tripReferenceCurrency } from '../../db/currency'
import { buildTripBudget } from '../../money/tripBudget'
import { budgetTotalText } from '../../money/budgetPresentation'
import { PlannedBudgetPanel } from '../budget/BudgetTracking'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { reservationLabels, periodLabels } from '../program/activityPresentation'
import { formatDate } from '../program/dates'
import { buildTripOverview, localClock, type LocalClock } from './overviewModel'
import '../budget/trip-budget.css'
import './trip-overview.css'

const emptyActivities: TripActivity[] = []

function useLocalClock(enabled: boolean) {
  const [clock, setClock] = useState(() => localClock(new Date()))
  useEffect(() => {
    if (!enabled) return
    const update = () => { const next = localClock(new Date()); setClock((old) => old.date === next.date && old.time === next.time ? old : next) }
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [enabled])
  return clock
}
export function TripOverview({ trip, navigate, readActivities = listActivities, clock: suppliedClock }: {
  trip: Trip; navigate: (tab: 'program' | 'budget') => void; readActivities?: typeof listActivities; clock?: LocalClock
}) {
  const current = useLocalClock(suppliedClock === undefined), clock = suppliedClock ?? current
  const [attempt, retry] = useState(0), [detailId, setDetailId] = useState<string | null>(null), [editing, setEditing] = useState(false)
  const origin = useRef<HTMLButtonElement>(null), fallback = useRef<HTMLButtonElement>(null)
  const result = useLiveQuery(() => readActivities(trip.id).then((activities) => ({ id: trip.id, activities, error: '' }), () => ({ id: trip.id, activities: [] as TripActivity[], error: 'Impossible de charger les informations du voyage. Les données locales sont conservées.' })), [trip.id, readActivities, attempt])
  const activities = result?.id === trip.id && !result.error ? result.activities : emptyActivities
  const overview = useMemo(() => buildTripOverview(trip, activities, clock), [trip, activities, clock])
  const budget = useMemo(() => buildTripBudget(trip, activities), [trip, activities])
  const ready = result?.id === trip.id && !result.error
  const liveActivity = activities.find((activity) => activity.tripId === trip.id && activity.id === detailId)
  const detail = useActivityEditSnapshot(trip.id, editing ? detailId : null, liveActivity)
  if (detailId !== null && result?.id === trip.id && !detail) { setDetailId(null); setEditing(false) }
  if (trip.archived || trip.deletedAt !== undefined) return null
  const progress = overview.progress
  function open(activity: TripActivity, trigger: HTMLButtonElement) { origin.current = trigger; setDetailId(activity.id); setEditing(false) }
  const completeDate = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return <div className="trip-overview">
    <section className="overview-progress" aria-label="Avancement du séjour"><p className="eyebrow">VOTRE SÉJOUR</p>
      <p className="overview-countdown" role="status">{progress.status === 'before' ? `Départ dans ${progress.until} jour${progress.until > 1 ? 's' : ''}` : progress.status === 'during' ? `Jour ${progress.day} sur ${progress.days}` : progress.status === 'after' ? 'Voyage terminé' : 'Dates du séjour à vérifier'}</p>
      {progress.status !== 'invalid' && <p>{progress.days} jour{progress.days > 1 ? 's' : ''} de voyage, dates incluses.</p>}
      <p className="budget-meta">Repères basés sur la date et l’heure locales de cet appareil ; aucun fuseau de destination n’est enregistré.</p>
    </section>
    <PreparationChecklist key={trip.id} trip={trip} today={clock.date} />
    {!ready ? <section className="overview-card" aria-live="polite">{result?.id === trip.id && result.error ? <><p role="alert">{result.error}</p><button className="secondary-button" type="button" onClick={() => retry((value) => value + 1)}>Réessayer les informations</button></> : <p role="status">Chargement du voyage…</p>}</section> : <>
      <div className="overview-grid"><section className="overview-card" aria-labelledby="overview-next"><h2 id="overview-next">Prochaine activité à heure précise</h2>
        {overview.next ? <><h3>{overview.next.title}</h3><p><time dateTime={`${overview.next.date}T${overview.next.startTime}`}>{completeDate(overview.next.date!)} · {overview.next.startTime}{overview.next.endTime ? `–${overview.next.endTime}` : ''}</time></p>
          <button type="button" className="primary-button" onClick={(event) => open(overview.next!, event.currentTarget)}>Voir l’activité</button></>
          : <p>Aucune prochaine activité avec une heure de début renseignée.</p>}
        {overview.untimed > 0 && <p className="budget-meta">{overview.untimed} activité(s) datée(s) sans heure précise à consulter dans le Programme. Leur ordre par rapport à maintenant reste indéterminé.</p>}
        {overview.flexible && <div className="overview-flexible"><h3>Sans heure précise à consulter</h3><p><strong>{overview.flexible.title}</strong> · {completeDate(overview.flexible.date!)} · {overview.flexible.scheduleType === 'period' ? periodLabels[overview.flexible.period] : 'Sans horaire'}</p>
          <button type="button" className="secondary-button" onClick={(event) => open(overview.flexible!, event.currentTarget)}>Voir cette activité sans heure précise</button></div>}
        {overview.ideas > 0 && <p className="budget-meta">{overview.ideas} idée(s) à planifier, sans date.</p>}
        <button ref={fallback} type="button" className="secondary-button" onClick={() => navigate('program')}>Consulter le Programme</button>
      </section>
      <section className="overview-card" aria-labelledby="overview-reservations"><h2 id="overview-reservations">Réservations renseignées</h2>
        {!overview.reservations.length ? <p>Aucune information de réservation enregistrée.</p> : <><dl className="overview-reservation-counts">{Object.entries(overview.reservationCounts).filter(([, count]) => count > 0).map(([status, count]) => <div key={status}><dt>{status === 'unknown' ? 'Statut non renseigné' : reservationLabels[status as keyof typeof reservationLabels]}</dt><dd>{count}</dd></div>)}</dl>
          <details><summary>Consulter les activités concernées ({overview.reservations.length})</summary><ul className="overview-reservations">{overview.reservations.map((activity) => <li key={activity.id}><button className="secondary-button" type="button" onClick={(event) => open(activity, event.currentTarget)}>{activity.title}</button><span>{activity.reservationStatus ? reservationLabels[activity.reservationStatus] ?? 'Statut non renseigné' : 'Statut non renseigné'}</span></li>)}</ul></details></>}
        <p className="budget-meta">Seules les informations enregistrées sont résumées. Une référence ou une réservation confirmée ne prouve pas un paiement.</p>
      </section></div>
      <section className="overview-card overview-budget" aria-labelledby="overview-budget"><h2 id="overview-budget">Budget du voyage</h2>
        {budget.totals.status === 'calculated' ? <><dl className="overview-money"><div><dt>Estimé connu</dt><dd>{budgetTotalText(budget.totals.estimated, budget.totals.currency)}</dd></div><div><dt>Payé connu</dt><dd>{budgetTotalText(budget.totals.paid, budget.totals.currency)}</dd></div></dl>
          {!budget.hasAmounts && <p>Aucun montant de dépense renseigné pour le moment.</p>}
          {Boolean(budget.totals.estimated.absentCount || budget.totals.paid.absentCount || budget.totals.estimated.excluded.length || budget.totals.paid.excluded.length || budget.issues.length) && <p className="budget-warning" role="status">Synthèse incomplète : certains montants sont inconnus, invalides ou non convertibles. Les dépenses exclues ne valent pas zéro.</p>}
          <p className="budget-meta">Montants indicatifs en {budget.totals.currency}, calculés avec les taux locaux disponibles, manuels en priorité. Les paiements des déplacements restent suivis dans le partage, comme dans le Budget.</p>
          <PlannedBudgetPanel trip={trip} budget={budget} />
        </> : <p role="alert">La devise de référence est invalide. Vérifie les paramètres du voyage.</p>}
        <button type="button" className="secondary-button" onClick={() => navigate('budget')}>Ouvrir le Budget et ses conversions</button>
      </section>
    </>}
    {ready && detail && !editing && <ActivityDetailPanel trip={trip} activity={detail} returnFocusRef={origin} fallbackFocusRef={fallback} onClose={() => setDetailId(null)} onEdit={() => setEditing(true)} closeLabel="Fermer la fiche et revenir à l’accueil du voyage" />}
    {ready && detail && editing && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(trip)} activity={detail} initialDate={detail.date} fallbackDate={trip.startDate} fallbackFocusRef={origin} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
  </div>
}
