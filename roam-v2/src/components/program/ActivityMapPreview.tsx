import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { connection } from '../../pwa/connection'
import { activityMapPoint, type MapPoint } from '../../maps/mapPoint'
import { loadMapPreview, startMapPreview, type MapPreviewHandle, type MapPreviewLoader, type MapPreviewState } from '../../maps/previewSession'
import type { TripActivity } from '../../db/activityModel'
import './activity-map.css'

function OnlineMap({ point, load }: { point: MapPoint; load: MapPreviewLoader }) {
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<MapPreviewHandle | null>(null)
  const initial = useRef(point)
  const [state, setState] = useState<MapPreviewState>({ phase: 'loading', message: 'Chargement de la carte…' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const preview = startMapPreview(container.current!, initial.current, setState, load)
    session.current = preview
    return () => { preview.dispose(); session.current = null }
  }, [attempt, load])
  useEffect(() => { initial.current = point; session.current?.update(point) }, [point])
  return <>
    <div ref={container} className="activity-map-canvas" role="region" aria-label="Aperçu cartographique du lieu" />
    <p role="status" className={state.phase === 'error' ? 'activity-map-message activity-map-error' : 'activity-map-message'}>{state.message}</p>
    {state.phase === 'error' && <button type="button" className="secondary-button" onClick={() => setAttempt((value) => value + 1)}>Réessayer la carte</button>}
  </>
}
export function ActivityMapPreview({ activity, load = loadMapPreview }: { activity: TripActivity; load?: MapPreviewLoader }) {
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  const { latitude, longitude, location } = activity
  const point = useMemo(() => activityMapPoint({ latitude, longitude, location }), [latitude, longitude, location])
  if (!point) return null
  return <figure className="activity-map-preview">
    <figcaption>{point.name ? `Carte : ${point.name}` : 'Aperçu du lieu'}</figcaption>
    {network.offline ? <p role="status" className="activity-map-message">Carte indisponible hors connexion. Le lieu, l’adresse et les coordonnées restent lisibles ci-dessus.</p>
      : Math.abs(point.latitude) > 85.051129 ? <p role="status" className="activity-map-message">Le fond OSM ne couvre pas ces coordonnées polaires. Les coordonnées d’origine sont conservées.</p>
      : <OnlineMap point={point} load={load} />}
    <p className="activity-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Signaler un problème</a></p>
    <p className="activity-meta">Fond en ligne, sans disponibilité hors connexion garantie. Aucun accès à ta position.</p>
  </figure>
}
