import { useEffect, useRef, useState } from 'react'
import { LocateFixed, Maximize2, Minimize2 } from 'lucide-react'
import type { MapLink } from '../../maps/tripMapTransfers'
import type { TripMapPoint } from '../../maps/tripMapModel'
import { startTripMap, type TripMapHandle, type TripMapLoader, type TripMapState } from '../../maps/tripMapSession'
import type { TripMapCamera } from '../../maps/tripMapView'

export function TripMapCanvas({ points, load, selected, onSelect, filterRevision, transfers, selectedTransfer, onTransferSelect, expanded, onExpandedChange, camera, filterKey, onCameraChange }: {
  points: readonly TripMapPoint[]; load: TripMapLoader; selected: string | null; onSelect: (ids: string[]) => void; filterRevision: number
  transfers: readonly MapLink[]; selectedTransfer: string | null; onTransferSelect: (ids: string[]) => void
  expanded: boolean; onExpandedChange: (expanded: boolean) => void; camera?: TripMapCamera; filterKey: string; onCameraChange: (camera: TripMapCamera, key: string) => void
}) {
  const container = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null)
  const session = useRef<TripMapHandle | null>(null)
  const initial = useRef(points), framedFilter = useRef(filterRevision)
  const callbacks = useRef({ onSelect, onTransferSelect, onCameraChange, filterKey, camera })
  useEffect(() => { callbacks.current = { onSelect, onTransferSelect, onCameraChange, filterKey, camera } }, [onSelect, onTransferSelect, onCameraChange, filterKey, camera])
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<TripMapState>({ phase: 'loading', message: 'Chargement de la carte du voyage…' })
  useEffect(() => {
    const handle = startTripMap(container.current!, initial.current, (next) => setState((previous) => previous.phase === next.phase && previous.message === next.message && previous.interactive === next.interactive ? previous : next), load, 20000,
      (ids) => callbacks.current.onSelect(ids), (ids) => callbacks.current.onTransferSelect(ids), {
        camera: callbacks.current.camera,
        onCameraChange: (next) => callbacks.current.onCameraChange(next, callbacks.current.filterKey),
      })
    session.current = handle
    return () => { handle.dispose(); session.current = null }
  }, [attempt, load])
  useEffect(() => { initial.current = points; session.current?.update(points) }, [points])
  useEffect(() => { session.current?.select?.(selected) }, [selected, points, attempt])
  useEffect(() => { session.current?.transfers?.(transfers, selectedTransfer) }, [transfers, selectedTransfer, attempt])
  useEffect(() => {
    if (framedFilter.current === filterRevision) return
    framedFilter.current = filterRevision
    session.current?.recenter()
  }, [filterRevision])
  useEffect(() => { session.current?.resize?.() }, [expanded])
  useEffect(() => {
    if (!expanded) return
    const frame = requestAnimationFrame(() => surface.current?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [expanded])
  return <div ref={surface} className={`trip-map-surface${expanded ? ' is-expanded' : ''}`} onKeyDown={(event) => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); onExpandedChange(false); expandButton.current?.focus({ preventScroll: true }) }
  }}>
    <div className="trip-map-toolbar"><button type="button" className="secondary-button" disabled={!state.interactive} onClick={() => session.current?.recenter()}>
      <LocateFixed size={18} aria-hidden="true" />Recentrer</button>
      <button ref={expandButton} type="button" className="secondary-button" aria-pressed={expanded} aria-label={expanded ? 'Réduire la carte' : 'Agrandir la carte'} onClick={() => onExpandedChange(!expanded)}>
        {expanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}{expanded ? 'Réduire' : 'Agrandir'}</button></div>
    <p id="trip-map-gestures" className="trip-map-gestures">Un doigt pour faire défiler la page ; deux doigts pour déplacer ou zoomer la carte. Les boutons + et − permettent aussi de zoomer.</p>
    <div className="trip-map-stage"><div ref={container} className="trip-map-canvas" role="region" aria-label="Carte des lieux du voyage" aria-describedby="trip-map-gestures" />
      <a className="trip-map-canvas-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© contributeurs OpenStreetMap</a></div>
    <p role="status" className={state.phase === 'error' ? 'trip-map-status trip-map-error' : 'trip-map-status'}>{state.message}</p>
    {state.phase === 'error' && <button type="button" className="secondary-button" aria-label="Réessayer la carte" onClick={() => retry((value) => value + 1)}>Réessayer la carte</button>}
  </div>
}
