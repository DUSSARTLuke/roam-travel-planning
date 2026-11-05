import { TripMapTransfers } from './TripMapTransfers'
import { tripMapTransfers, type MapTransfer } from '../../maps/tripMapTransfers'
import { filterMapActivities, tripMapNavigation, type TripMapNavigation } from '../../maps/tripMapNavigation'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { activityScheduleLabel, categoryLabels } from '../program/activityPresentation'
import { tripReferenceCurrency } from '../../db/currency'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LocateFixed, X } from 'lucide-react'
import { listActivities } from '../../db/activities'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { connection } from '../../pwa/connection'
import { coordinateKey, drawablePoints, tripMapPoints, type TripMapPoint } from '../../maps/tripMapModel'
import { loadTripMap, startTripMap, type TripMapHandle, type TripMapLoader, type TripMapState } from '../../maps/tripMapSession'
import { formatDate, getTripDays } from '../program/dates'
import './trip-map.css'

function MapCanvas({ points, load, selected, onSelect, filterRevision, transfers, selectedTransfer, onTransferSelect }: { transfers: readonly MapTransfer[]; selectedTransfer: string | null; onTransferSelect: (ids: string[]) => void; filterRevision: number; points: readonly TripMapPoint[]; load: TripMapLoader; selected: string | null; onSelect: (ids: string[]) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const session = useRef<TripMapHandle | null>(null)
  const initial = useRef(points)
  const framedFilter = useRef(filterRevision)
  const transferSelectRef = useRef(onTransferSelect)
  useEffect(() => { transferSelectRef.current = onTransferSelect }, [onTransferSelect])
  const selectRef = useRef(onSelect)
  useEffect(() => { selectRef.current = onSelect }, [onSelect])
  const [attempt, retry] = useState(0)
  const [state, setState] = useState<TripMapState>({ phase: 'loading', message: 'Chargement de la carte du voyage…' })
  useEffect(() => {
    const handle = startTripMap(container.current!, initial.current, setState, load, 20000, (ids) => selectRef.current(ids), (ids) => transferSelectRef.current(ids))
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
  return <>
    <div className="trip-map-toolbar"><button type="button" className="secondary-button" disabled={!state.interactive} onClick={() => session.current?.recenter()}>
      <LocateFixed size={18} aria-hidden="true" />Recentrer</button>
      <span className="activity-meta">La vue reste en place lorsque les lieux changent.</span></div>
    <div ref={container} className="trip-map-canvas" role="region" aria-label="Carte des activités du voyage" />
    <p role="status" className={state.phase === 'error' ? 'trip-map-status trip-map-error' : 'trip-map-status'}>{state.message}</p>
    {state.phase === 'error' && <button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer la carte</button>}
  </>
}

function TripMapContent({ trip, initialNavigation, onNavigationChange, readActivities = listActivities, load = loadTripMap }: {
  trip: Trip; initialNavigation?: TripMapNavigation; onNavigationChange?: (navigation: TripMapNavigation) => void; readActivities?: typeof listActivities; load?: TripMapLoader
}) {
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [navigation, setNavigation] = useState(() => tripMapNavigation(trip, initialNavigation))
  const { startDate, endDate } = trip
  const currentNavigation = useMemo(() => tripMapNavigation({ startDate, endDate }, navigation), [startDate, endDate, navigation])
  const [filterRevision, setFilterRevision] = useState(0)
  function navigate(patch: Partial<TripMapNavigation>) {
    const next = tripMapNavigation(trip, { ...currentNavigation, ...patch })
    if (next.mode === currentNavigation.mode && next.selectedDate === currentNavigation.selectedDate) return
    setNavigation(next)
    setFilterRevision((value) => value + 1)
    setSelection([])
    setTransferSelection([])
    setDetailId(null)
    setEditing(false)
    onNavigationChange?.(next)
  }
  const [transferSelection, setTransferSelection] = useState<string[]>([])
  const transferPreviewRef = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const selectionFrame = useRef<number | null>(null)
  useEffect(() => () => { if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current) }, [])
  const selectionOrigin = useRef<HTMLButtonElement | null>(null)
  function choose(ids: string[]) {
    selectionOrigin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setTransferSelection([])
    setSelection(ids)
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    selectionFrame.current = requestAnimationFrame(() => openRef.current?.focus())
  }
  function chooseTransfer(ids: string[]) {
    selectionOrigin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setSelection([])
    setTransferSelection(ids)
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    selectionFrame.current = requestAnimationFrame(() => transferPreviewRef.current?.focus())
  }
  function closeTransfer() {
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    setTransferSelection([])
    selectionOrigin.current?.focus({ preventScroll: true })
  }
  function closePreview() {
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    setSelection([])
    selectionOrigin.current?.focus({ preventScroll: true })
  }
  const openRef = useRef<HTMLButtonElement>(null)
  const fallbackRef = useRef<HTMLButtonElement>(null)
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  const [attempt, retry] = useState(0)
  const result = useLiveQuery(() => readActivities(trip.id).then(
    (activities) => ({ tripId: trip.id, activities, error: '' }),
    () => ({ tripId: trip.id, activities: [] as TripActivity[], error: 'Impossible de charger les lieux de ce voyage.' }),
  ), [trip.id, attempt, readActivities])
  const activities = useMemo(() => filterMapActivities(result?.tripId === trip.id ? result.activities : [], trip.id, currentNavigation), [result, trip.id, currentNavigation])
  const transfers = useMemo(() => tripMapTransfers(trip.manualTransfers ?? [], activities, trip.id), [trip.manualTransfers, activities, trip.id])
  const selectedTransfer = transferSelection.find((id) => transfers.some((link) => link.transfer.id === id)) ?? null
  const points = useMemo(() => tripMapPoints(activities, trip.id), [activities, trip.id])
  const visible = useMemo(() => drawablePoints(points), [points])
  const byId = new Map(points.map((point) => [point.id, point]))
  const anchor = byId.get(selection[0])
  const candidates = selection.filter((id) => !anchor || (byId.has(id) && coordinateKey(byId.get(id)!) === coordinateKey(anchor))).map((id) => activities.find((item) => item.id === id)).filter((item): item is TripActivity => Boolean(item))
  const selected = candidates[0] ?? null
  const detail = activities.find((item) => item.id === detailId)
  const ready = result?.tripId === trip.id && !result.error
  // Invalidate vanished/filtered selections during render, as in the Programme.
  // No delayed effect may resurrect an old selection when switching back.
  if (ready && selection.some((id) => !activities.some((activity) => activity.id === id))) {
    setSelection(selection.filter((id) => activities.some((activity) => activity.id === id)))
  }
  if (ready && transferSelection.some((id) => !transfers.some((link) => link.transfer.id === id))) {
    setTransferSelection(transferSelection.filter((id) => transfers.some((link) => link.transfer.id === id)))
  }
  if (ready && detailId !== null && !detail) { setDetailId(null); setEditing(false) }
  return <section className="trip-map-page" aria-labelledby="trip-map-title">
    <header><p className="eyebrow">{trip.destination}</p><h1 id="trip-map-title">Carte du voyage</h1>
      {ready && <p role="status" className="trip-map-counts">{points.length} activité{points.length > 1 ? 's' : ''} avec GPS · {activities.length - points.length} sans GPS valide{currentNavigation.mode === 'day' ? ' · Journée sélectionnée' : ' · Tout le voyage'}</p>}</header>
    <div className="trip-map-filters" role="group" aria-label="Filtrer les lieux du voyage">
      <label>Afficher<select value={currentNavigation.mode} onChange={(event) => navigate({ mode: event.target.value as TripMapNavigation['mode'] })}>
        <option value="all">Tout le voyage</option><option value="day" disabled={!days.length}>Journée</option>
      </select></label>
      {currentNavigation.mode === 'day' && <label>Journée<select value={currentNavigation.selectedDate} onChange={(event) => navigate({ selectedDate: event.target.value })}>
        {days.map((date) => <option key={date} value={date}>{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</option>)}
      </select></label>}
      {!days.length && <p role="status">Les dates du voyage ne permettent pas de choisir une journée.</p>}
    </div>
    {result?.tripId !== trip.id ? <p role="status">Chargement des lieux…</p> : result.error ? <div role="alert"><p>{result.error}</p>
      <button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer les lieux</button></div> : <>
      {points.length === 0 ? <div className="trip-map-empty"><h2>{currentNavigation.mode === 'all' ? 'Aucun lieu géolocalisé pour ce voyage' : activities.length ? 'Aucun lieu géolocalisé pour cette journée' : 'Aucune activité pour cette journée'}</h2><p>Ajoute des coordonnées GPS aux activités depuis le Programme pour les retrouver ici.</p></div>
        : <figure className="trip-map-figure"><figcaption>Les lieux de tes activités</figcaption>
          {network.offline ? <p role="status">Carte indisponible hors connexion. La liste des lieux et les coordonnées restent accessibles ci-dessous.</p>
            : visible.length ? <MapCanvas key={trip.id} points={visible} load={load} selected={selected?.id ?? null} onSelect={choose} filterRevision={filterRevision} transfers={transfers} selectedTransfer={selectedTransfer} onTransferSelect={chooseTransfer} /> : <p role="status">Ces coordonnées polaires ne sont pas couvertes par le fond cartographique. Elles restent disponibles dans la liste.</p>}
          <p className="trip-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Signaler un problème</a></p>
          <p className="activity-meta">Fond en ligne, sans disponibilité hors connexion garantie. Aucun accès à ta position. Au même point, un marqueur indique toutes les activités concernées.</p>
          {visible.length < points.length && <p className="activity-meta">{points.length - visible.length} activité(s) proche(s) des pôles ne peuvent pas être représentées sur ce fond ; les GPS d’origine sont conservés dans la liste.</p>}
        </figure>}
      {selected && <section className="trip-map-preview" aria-label="Aperçu de l’activité" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closePreview() } }}>
        <div className="trip-map-toolbar"><h2>{selected.title}</h2><button ref={fallbackRef} type="button" className="secondary-button" aria-label="Fermer l’aperçu" onClick={closePreview}><X size={18} /> Fermer</button></div>
        {candidates.length > 1 && <fieldset><legend>{candidates.length} activités à cet endroit — choisir une activité</legend>
          {candidates.map((item) => <button type="button" className="secondary-button" key={item.id} aria-pressed={selected.id === item.id} onClick={() => setSelection([item.id, ...selection.filter((id) => id !== item.id)])}>{item.title}</button>)}
        </fieldset>}
        <p>{categoryLabels[selected.category]} · {selected.date === null ? 'Idée à planifier' : formatDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p>{activityScheduleLabel(selected)}</p>
        {selected.location && <p>{selected.location}</p>}{selected.address && <p>{selected.address}</p>}
        <button ref={openRef} type="button" className="primary-button" onClick={() => { setEditing(false); setDetailId(selected.id) }}>Voir l’activité</button>
      </section>}
      <TripMapTransfers links={transfers} selectedIds={transferSelection} onSelect={chooseTransfer} onClose={closeTransfer} previewRef={transferPreviewRef} />
      <section aria-labelledby="trip-map-places"><h2 id="trip-map-places">Lieux des activités ({activities.length})</h2>
        {!activities.length ? <p>{currentNavigation.mode === 'all' ? 'Aucune activité enregistrée pour ce voyage.' : 'Aucune activité enregistrée pour cette journée.'}</p> : <ul className="trip-map-places">
          {activities.map((activity) => { const point = byId.get(activity.id); return <li key={activity.id} className={selected?.id === activity.id ? 'is-selected' : undefined}>
            <h3><button type="button" className="trip-map-place-select" aria-pressed={selected?.id === activity.id} onClick={() => choose([activity.id])}>{activity.title}</button></h3>
            <p className="activity-meta">{activity.date === null ? 'Idée à planifier' : formatDate(activity.date, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {activity.location && <p>{activity.location}</p>}{activity.address && <p>{activity.address}</p>}
            <p className="activity-meta">{point ? `GPS : ${point.latitude} ; ${point.longitude}` : 'Coordonnées GPS absentes ou invalides'}</p>
          </li> })}
        </ul>}
      </section>
    </>}
    {ready && detail && !editing && <ActivityDetailPanel trip={trip} activity={detail} returnFocusRef={openRef} fallbackFocusRef={fallbackRef} onClose={() => setDetailId(null)} onEdit={() => setEditing(true)} closeLabel="Fermer la fiche et revenir à la carte" />}
    {ready && detail && editing && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(trip)} activity={detail} initialDate={detail.date} fallbackDate={trip.startDate} fallbackFocusRef={openRef} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
  </section>
}

export function TripMap(props: Parameters<typeof TripMapContent>[0]) {
  return <TripMapContent key={props.trip.id} {...props} />
}
