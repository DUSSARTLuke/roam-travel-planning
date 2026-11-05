import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LocateFixed } from 'lucide-react'
import { listActivities } from '../../db/activities'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { connection } from '../../pwa/connection'
import { drawablePoints, tripMapPoints, type TripMapPoint } from '../../maps/tripMapModel'
import { loadTripMap, startTripMap, type TripMapHandle, type TripMapLoader, type TripMapState } from '../../maps/tripMapSession'
import { formatDate } from '../program/dates'
import './trip-map.css'

function MapCanvas({ points, load }: { points: readonly TripMapPoint[]; load: TripMapLoader }) {
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<TripMapHandle | null>(null)
  const initial = useRef(points)
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<TripMapState>({ phase: 'loading', message: 'Chargement de la carte du voyage…' })
  useEffect(() => {
    const handle = startTripMap(container.current!, initial.current, setState, load)
    session.current = handle
    return () => { handle.dispose(); session.current = null }
  }, [attempt, load])
  useEffect(() => { initial.current = points; session.current?.update(points) }, [points])
  return <>
    <div className="trip-map-toolbar"><button type="button" className="secondary-button" disabled={!state.interactive} onClick={() => session.current?.recenter()}>
      <LocateFixed size={18} aria-hidden="true" />Recentrer</button>
      <span className="activity-meta">La vue reste en place lorsque les lieux changent.</span></div>
    <div ref={container} className="trip-map-canvas" role="region" aria-label="Carte des activités du voyage" />
    <p role="status" className={state.phase === 'error' ? 'trip-map-status trip-map-error' : 'trip-map-status'}>{state.message}</p>
    {state.phase === 'error' && <button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer la carte</button>}
  </>
}

export function TripMap({ trip, readActivities = listActivities, load = loadTripMap }: {
  trip: Trip; readActivities?: typeof listActivities; load?: TripMapLoader
}) {
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  const [attempt, retry] = useState(0)
  const result = useLiveQuery(() => readActivities(trip.id).then(
    (activities) => ({ tripId: trip.id, activities, error: '' }),
    () => ({ tripId: trip.id, activities: [] as TripActivity[], error: 'Impossible de charger les lieux de ce voyage.' }),
  ), [trip.id, attempt, readActivities])
  const activities = useMemo(() => result?.tripId === trip.id ? result.activities.filter((item) => item.tripId === trip.id) : [], [result, trip.id])
  const points = useMemo(() => tripMapPoints(activities, trip.id), [activities, trip.id])
  const visible = useMemo(() => drawablePoints(points), [points])
  const byId = new Map(points.map((point) => [point.id, point]))
  const ready = result?.tripId === trip.id && !result.error
  return <section className="trip-map-page" aria-labelledby="trip-map-title">
    <header><p className="eyebrow">{trip.destination}</p><h1 id="trip-map-title">Carte du voyage</h1>
      {ready && <p role="status" className="trip-map-counts">{points.length} activité{points.length > 1 ? 's' : ''} avec GPS · {activities.length - points.length} sans GPS valide</p>}</header>
    {result?.tripId !== trip.id ? <p role="status">Chargement des lieux…</p> : result.error ? <div role="alert"><p>{result.error}</p>
      <button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer les lieux</button></div> : <>
      {points.length === 0 ? <div className="trip-map-empty"><h2>Aucun lieu géolocalisé pour ce voyage</h2><p>Ajoute des coordonnées GPS aux activités depuis le Programme pour les retrouver ici.</p></div>
        : <figure className="trip-map-figure"><figcaption>Les lieux de tes activités</figcaption>
          {network.offline ? <p role="status">Carte indisponible hors connexion. La liste des lieux et les coordonnées restent accessibles ci-dessous.</p>
            : visible.length ? <MapCanvas key={trip.id} points={visible} load={load} /> : <p role="status">Ces coordonnées polaires ne sont pas couvertes par le fond cartographique. Elles restent disponibles dans la liste.</p>}
          <p className="trip-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Signaler un problème</a></p>
          <p className="activity-meta">Fond en ligne, sans disponibilité hors connexion garantie. Aucun accès à ta position. Au même point, un marqueur indique toutes les activités concernées.</p>
          {visible.length < points.length && <p className="activity-meta">{points.length - visible.length} activité(s) proche(s) des pôles ne peuvent pas être représentées sur ce fond ; les GPS d’origine sont conservés dans la liste.</p>}
        </figure>}
      <section aria-labelledby="trip-map-places"><h2 id="trip-map-places">Lieux des activités ({activities.length})</h2>
        {!activities.length ? <p>Aucune activité enregistrée pour ce voyage.</p> : <ul className="trip-map-places">
          {activities.map((activity) => { const point = byId.get(activity.id); return <li key={activity.id}>
            <h3>{activity.title}</h3>
            <p className="activity-meta">{activity.date === null ? 'Idée à planifier' : formatDate(activity.date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {activity.location && <p>{activity.location}</p>}{activity.address && <p>{activity.address}</p>}
            <p className="activity-meta">{point ? `GPS : ${point.latitude} ; ${point.longitude}` : 'Coordonnées GPS absentes ou invalides'}</p>
          </li> })}
        </ul>}
      </section>
    </>}
  </section>
}
