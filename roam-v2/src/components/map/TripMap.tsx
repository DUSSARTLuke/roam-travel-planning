import { AccommodationDetail, AccommodationForm } from '../accommodations/AccommodationSpace'
import { listProgramJourneys, listMapAccommodations, programJourneyRepository } from '../../db/journeys'
import { accommodationsForMap, journeyPointId } from '../../maps/journeyMap'
import { useJourneyMapData } from '../../maps/useJourneyMapData'
import { JourneyDetail } from '../program/JourneyProgram'
import { JourneyFormPanel } from '../program/JourneyFormPanel'
import type { Journey, Accommodation } from '../../evolution/v21/contracts'
import type { Revision } from '../../evolution/v21/repository'
import { useActivityEditSnapshot } from '../program/useActivityEditSnapshot'
import { TripMapCanvas } from './TripMapCanvas'
import { initialMapView, mapFilterKey, type TripMapView, type TripMapCamera } from '../../maps/tripMapView'
import { TripMapTransfers } from './TripMapTransfers'
import { tripMapTransfers } from '../../maps/tripMapTransfers'
import { filterMapActivities, tripMapNavigation, type TripMapNavigation } from '../../maps/tripMapNavigation'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { activityScheduleLabel, categoryLabels } from '../program/activityPresentation'
import { tripReferenceCurrency } from '../../db/currency'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X, Map as MapIcon } from 'lucide-react'
import { listActivities } from '../../db/activities'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { connection } from '../../pwa/connection'
import { coordinateKey, tripMapPoints } from '../../maps/tripMapModel'
import { loadTripMap, type TripMapLoader } from '../../maps/tripMapSession'
import { formatDate, getTripDays } from '../program/dates'
import './trip-map.css'

function TripMapContent({ trip, initialNavigation, onNavigationChange, initialView, onViewChange, readActivities = listActivities, readJourneys = listProgramJourneys, readAccommodations = listMapAccommodations, repository = programJourneyRepository, load = loadTripMap }: {
  trip: Trip; initialView?: TripMapView; onViewChange?: (view: TripMapView) => void; initialNavigation?: TripMapNavigation; onNavigationChange?: (navigation: TripMapNavigation) => void; readActivities?: typeof listActivities; readJourneys?: typeof listProgramJourneys; readAccommodations?: typeof listMapAccommodations; repository?: typeof programJourneyRepository; load?: TripMapLoader
}) {
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [navigation, setNavigation] = useState(() => tripMapNavigation(trip, initialNavigation))
  const { startDate, endDate } = trip
  const currentNavigation = useMemo(() => tripMapNavigation({ startDate, endDate }, navigation), [startDate, endDate, navigation])
  const [seed] = useState(() => initialMapView(currentNavigation, initialView))
  const memory = useRef(seed)
  const [camera, setCamera] = useState(seed.camera)
  const viewChangeRef = useRef(onViewChange)
  useEffect(() => { viewChangeRef.current = onViewChange }, [onViewChange])
  const [expanded, setExpanded] = useState(seed.expanded)
  const mapAnchor = useRef<HTMLDivElement>(null)
  function returnToMap() { mapAnchor.current?.focus({ preventScroll: true }); mapAnchor.current?.scrollIntoView({ block: 'start' }) }
  function saveCamera(camera: TripMapCamera, key: string) {
    if (memory.current.filterKey !== key) return
    const previous = memory.current.camera
    if (previous?.longitude === camera.longitude && previous.latitude === camera.latitude && previous.zoom === camera.zoom) return
    setCamera((previous) => previous?.longitude === camera.longitude && previous.latitude === camera.latitude && previous.zoom === camera.zoom ? previous : camera)
    const next = { ...memory.current, camera }
    memory.current = next; viewChangeRef.current?.(next)
  }
  const [filterRevision, setFilterRevision] = useState(0)
  function navigate(patch: Partial<TripMapNavigation>) {
    const next = tripMapNavigation(trip, { ...currentNavigation, ...patch })
    if (next.mode === currentNavigation.mode && next.selectedDate === currentNavigation.selectedDate) return
    memory.current = { ...memory.current, filterKey: mapFilterKey(next), camera: undefined }
    setCamera(undefined)
    setNavigation(next)
    setFilterRevision((value) => value + 1)
    setSelection([])
    setTransferSelection([])
    setNativeIds([]);setJourneyDetail(null)
    setDetailId(null)
    setEditing(false)
    onNavigationChange?.(next)
  }
  const [showJourneys,setShowJourneys]=useState(initialView?.showJourneys??true)
  const nativePreviewRef=useRef<HTMLButtonElement>(null)
  const [nativeIds,setNativeIds]=useState<string[]>(seed.nativeSelection??[])
  const [stayPanel,setStayPanel]=useState<{id:string;trigger:HTMLButtonElement;edit?:{row:Accommodation;revision:Revision}}|null>(null)
  const [journeyDetail,setJourneyDetail]=useState<{id:string;trigger:HTMLButtonElement;edit?:{row:Journey;revision:Revision}}|null>(null)
  const [transferSelection, setTransferSelection] = useState<string[]>(seed.transferSelection)
  const transferPreviewRef = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<string[]>(seed.selection)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const selectionFrame = useRef<number | null>(null)
  useEffect(() => () => { if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current) }, [])
  const selectionOrigin = useRef<HTMLButtonElement | null>(null)
  function choose(ids: string[]) {
    selectionOrigin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setTransferSelection([])
    const native=ids.filter(id=>nativeMap.owners.has(id)||stays.some(point=>point.id===id))
    setNativeIds(native)
    setSelection(ids.filter(id=>!nativeMap.owners.has(id)&&!stays.some(point=>point.id===id)))
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    selectionFrame.current = requestAnimationFrame(() => (native.length?nativePreviewRef.current:openRef.current)?.focus({preventScroll:true}))
  }
  function chooseTransfer(ids: string[]) {
    selectionOrigin.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setSelection([])
    if(ids.some(id=>nativeMap.owners.has(id))){setNativeIds(ids.filter(id=>nativeMap.owners.has(id)));setTransferSelection([])}else{setNativeIds([]);setTransferSelection(ids)}
    if (selectionFrame.current !== null) cancelAnimationFrame(selectionFrame.current)
    selectionFrame.current = requestAnimationFrame(() => (ids.some(id=>nativeMap.owners.has(id))?nativePreviewRef.current:transferPreviewRef.current)?.focus({preventScroll:true}))
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
  const result = useLiveQuery(() => Promise.all([readActivities(trip.id),readJourneys(trip.id),readAccommodations(trip.id)]).then(
    ([activities,journeys,accommodations]) => ({ tripId: trip.id, activities, journeys, accommodations, error: '' }),
    () => ({ tripId: trip.id, activities: [] as TripActivity[], journeys:[] as Journey[], accommodations:[] as Accommodation[], error: 'Impossible de charger les lieux de ce voyage.' }),
  ), [trip.id, attempt, readActivities,readJourneys,readAccommodations])
  const activities = useMemo(() => filterMapActivities(result?.tripId === trip.id ? result.activities : [], trip.id, currentNavigation), [result, trip.id, currentNavigation])
  const transfers = useMemo(() => tripMapTransfers(trip.manualTransfers ?? [], activities, trip.id), [trip.manualTransfers, activities, trip.id])
  const selectedTransfer = transferSelection.find((id) => transfers.some((link) => link.transfer.id === id)) ?? null
  useEffect(() => {
    const key = mapFilterKey(currentNavigation)
    const next = { ...memory.current, filterKey: key, camera: memory.current.filterKey === key ? memory.current.camera : undefined, selection, transferSelection, expanded, showJourneys, nativeSelection:nativeIds }
    memory.current = next; viewChangeRef.current?.(next)
  }, [currentNavigation, selection, transferSelection, expanded,showJourneys,nativeIds])
  const points = useMemo(() => tripMapPoints(activities, trip.id), [activities, trip.id])
  const journeyRows=result?.journeys,stayRows=result?.accommodations,filterDate=currentNavigation.mode==='day'?currentNavigation.selectedDate:undefined
  const {nativeMap,stays,allPoints,visible,allLinks,legacyLinks}=useJourneyMapData(journeyRows,stayRows,trip.id,filterDate,showJourneys,points,transfers)
  const nativeCandidates=[...new Map(nativeIds.map(id=>nativeMap.owners.get(id)).filter((row):row is Journey=>!!row).map(row=>[row.id,row])).values()]
  const selectedStays=stays.filter(point=>nativeIds.includes(point.id))
  const currentStay=result?.accommodations.find(row=>row.id===stayPanel?.id)
  if(stayPanel&&result&&!result.error&&!currentStay)setStayPanel(null)
  const currentJourney=result?.journeys.find(row=>row.id===journeyDetail?.id)
  if(journeyDetail&&result&&!result.error&&!currentJourney)setJourneyDetail(null)
  const byId = new Map(points.map((point) => [point.id, point]))
  const anchor = byId.get(selection[0])
  const candidates = selection.filter((id) => !anchor || (byId.has(id) && coordinateKey(byId.get(id)!) === coordinateKey(anchor))).map((id) => activities.find((item) => item.id === id)).filter((item): item is TripActivity => Boolean(item))
  const selected = candidates[0] ?? null
  const liveActivity = activities.find((item) => item.id === detailId)
  const detail = useActivityEditSnapshot(trip.id, editing ? detailId : null, liveActivity)
  const ready = result?.tripId === trip.id && !result.error
  if(ready&&nativeIds.some(id=>!nativeMap.owners.has(id)&&!stays.some(point=>point.id===id)))setNativeIds(nativeIds.filter(id=>nativeMap.owners.has(id)||stays.some(point=>point.id===id)))
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
      <label><input type="checkbox" checked={showJourneys} onChange={event=>{setShowJourneys(event.target.checked);setNativeIds([]);setTransferSelection([])}} />Afficher les déplacements</label>
      {!days.length && <p role="status">Les dates du voyage ne permettent pas de choisir une journée.</p>}
    </div>
    {result?.tripId !== trip.id ? <p role="status">Chargement des lieux…</p> : result.error ? <div role="alert"><p>{result.error}</p>
      <button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer les lieux</button></div> : <>
      {allPoints.length === 0 ? <div className="trip-map-empty"><h2>{currentNavigation.mode === 'all' ? 'Aucun lieu géolocalisé pour ce voyage' : activities.length ? 'Aucun lieu géolocalisé pour cette journée' : 'Aucun lieu géolocalisé pour cette journée'}</h2><p>Ajoute des coordonnées GPS aux activités ou aux étapes des déplacements depuis le Programme pour les retrouver ici.</p></div>
        : <figure className="trip-map-figure"><figcaption>Les lieux du voyage</figcaption>
          <div ref={mapAnchor} className="trip-map-anchor" tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape' && expanded) { event.preventDefault(); setExpanded(false) } }} aria-label="Revenir à la carte du voyage">{network.offline ? <p role="status">Carte indisponible hors connexion : les tuiles ne sont pas garanties. Les lieux, coordonnées et déplacements restent accessibles ci-dessous.</p>
            : visible.length ? <TripMapCanvas key={trip.id} points={visible} load={load} selected={nativeIds[0]??selected?.id ?? null} onSelect={choose} filterRevision={filterRevision} transfers={allLinks} selectedTransfer={nativeIds.find(id=>nativeMap.links.some(link=>link.transfer.id===id))??selectedTransfer} onTransferSelect={chooseTransfer} expanded={expanded} onExpandedChange={setExpanded} camera={camera} filterKey={mapFilterKey(currentNavigation)} onCameraChange={saveCamera} /> : <p role="status">Ces coordonnées polaires ne sont pas couvertes par le fond cartographique. Elles restent disponibles dans la liste.</p>}</div>
          <p className="trip-map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Signaler un problème</a></p>
          <p className="activity-meta">Fond en ligne, sans disponibilité hors connexion garantie. Aucun accès à ta position. Au même point, un marqueur permet de choisir les lieux concernés. ● Activité · ▣ Hébergement · ✈ Aéroport · ▤ Gare · ⌂ Domicile · ◆ Lieu libre.</p>
          {visible.length < allPoints.length && <p className="activity-meta">{allPoints.length - visible.length} lieu(x) proche(s) des pôles ne peuvent pas être représentées sur ce fond ; les GPS d’origine sont conservés dans la liste.</p>}
        </figure>}
      {network.returned && <p role="status" className="activity-meta">Connexion détectée à nouveau. Le fournisseur de tuiles peut rester indisponible.</p>}
      {selected && <section className="trip-map-preview" aria-label="Aperçu de l’activité" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closePreview() } }}>
        <div className="trip-map-toolbar"><h2>{selected.title}</h2><button ref={fallbackRef} type="button" className="secondary-button" aria-label="Fermer l’aperçu" onClick={closePreview}><X size={18} /> Fermer</button></div>
        {candidates.length > 1 && <fieldset><legend>{candidates.length} activités à cet endroit — choisir une activité</legend>
          {candidates.map((item) => <button type="button" className="secondary-button" key={item.id} aria-pressed={selected.id === item.id} onClick={() => setSelection([item.id, ...selection.filter((id) => id !== item.id)])}>{item.title}</button>)}
        </fieldset>}
        <p>{categoryLabels[selected.category]} · {selected.date === null ? 'Idée à planifier' : formatDate(selected.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p>{activityScheduleLabel(selected)}</p>
        {selected.location && <p>{selected.location}</p>}{selected.address && <p>{selected.address}</p>}
        <button ref={openRef} type="button" className="primary-button" onClick={() => { setEditing(false); setDetailId(selected.id) }}>Voir l’activité</button>
        {visible.length > 0 && !network.offline && <button type="button" className="secondary-button trip-map-return" onClick={returnToMap}><MapIcon size={18} aria-hidden="true" />Revenir à la carte</button>}
      </section>}
      {(nativeCandidates.length>0||selectedStays.length>0)&&<section className="trip-map-preview" aria-label="Aperçu des déplacements" onKeyDown={event=>{if(event.key==='Escape')setNativeIds([])}}><h2>Lieux sélectionnés</h2>{selectedStays.map(point=><p key={point.id}><button type="button" className="secondary-button" onClick={event=>{const stay=result?.accommodations.find(row=>JSON.stringify(['stay',row.id])===point.id);if(stay)setStayPanel({id:stay.id,trigger:event.currentTarget})}}>{point.title}</button> · GPS : {point.latitude} ; {point.longitude}</p>)}<button ref={nativePreviewRef} type="button" className="secondary-button" onClick={()=>{setNativeIds([]);selectionOrigin.current?.focus({preventScroll:true})}}>Fermer l’aperçu des déplacements</button>{nativeCandidates.map(row=><button key={row.id} type="button" className="secondary-button" onClick={event=>setJourneyDetail({id:row.id,trigger:event.currentTarget})}>Voir le déplacement {row.title}</button>)}</section>}
      <section aria-label="Déplacements autonomes sur la carte"><h2>Déplacements autonomes ({nativeMap.rows.length})</h2><p>Liaisons schématiques à vol d’oiseau : aucun itinéraire réel ni temps de parcours calculé.</p>{currentNavigation.mode==='day'&&<p className="activity-meta">Les déplacements sont filtrés selon leur date de départ. Choisis « Tout le voyage » pour voir les autres dates et les déplacements sans date.</p>}{!showJourneys&&<p role="status">Les déplacements sont masqués par le filtre « Afficher les déplacements ».</p>}{showJourneys&&nativeMap.rows.length===0&&<p>Aucun déplacement pour ce filtre.</p>}{nativeMap.rows.map(row=><article key={row.id}><h3><button type="button" className="secondary-button" onClick={event=>setJourneyDetail({id:row.id,trigger:event.currentTarget})}>{row.title}</button></h3><p className="activity-meta">{nativeMap.coverage.get(row.id)?.displayed===0 ? 'Ce déplacement n’est pas visible sur la carte : aucun point ne possède de coordonnées GPS affichables. Recherche un lieu ou renseigne ses coordonnées dans le formulaire ; les noms seuls ne sont pas géolocalisés automatiquement.' : `${nativeMap.coverage.get(row.id)?.displayed}/${row.stops.length} points affichables · ${nativeMap.coverage.get(row.id)?.connections} liaison(s) schématique(s). Les segments sans deux extrémités GPS affichables restent masqués.`}</p><ol>{row.stops.map(stop=><li key={stop.id}>{stop.place.name}{stop.place.address?` · ${stop.place.address}`:''}{nativeMap.points.some(point=>point.id===journeyPointId(row.id,stop.id))?'':' · Sans GPS affichable'}{stop.link?.state==='deleted'?' · Lieu lié supprimé, dernier lieu connu conservé':''}</li>)}</ol></article>)}</section>
      <section aria-label="Hébergements sur la carte"><h2>Hébergements</h2><p className="activity-meta">Le filtre Journée inclut l’arrivée, les nuits sur place et le jour du départ.</p>{accommodationsForMap(stayRows??[],trip.id,filterDate).length===0?<p>Aucun hébergement pour ce filtre.</p>:<ul>{accommodationsForMap(stayRows??[],trip.id,filterDate).map(stay=>{const point=stays.find(point=>point.id===JSON.stringify(['stay',stay.id]));return <li key={stay.id}><button type="button" className="secondary-button" onClick={event=>setStayPanel({id:stay.id,trigger:event.currentTarget})}>Hébergement · {stay.place.name}</button>{point&&visible.some(p=>p.id===point.id)?` · GPS : ${point.latitude} ; ${point.longitude}`:<p>Hébergement non visible sur la carte : aucune coordonnée GPS affichable. Une adresse saisie seule ne donne pas de position. Recherche un lieu ou renseigne les coordonnées dans le formulaire.</p>}</li>})}</ul>}</section>

      <TripMapTransfers links={legacyLinks} selectedIds={transferSelection} onSelect={chooseTransfer} onClose={closeTransfer} previewRef={transferPreviewRef} onReturnMap={!network.offline && visible.length ? returnToMap : undefined} />
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
    {ready&&currentStay&&stayPanel&&!stayPanel.edit&&<AccommodationDetail trip={trip} stay={currentStay} repository={repository} trigger={stayPanel.trigger} onClose={()=>setStayPanel(null)} onEdit={(row,revision)=>setStayPanel({...stayPanel,edit:{row,revision}})}/>}
    {ready&&stayPanel?.edit&&<AccommodationForm trip={trip} baseline={stayPanel.edit.row} revision={stayPanel.edit.revision} repository={repository} trigger={stayPanel.trigger} onClose={()=>setStayPanel({...stayPanel,edit:undefined})} onSaved={()=>setStayPanel({...stayPanel,edit:undefined})}/>}
    {ready&&currentJourney&&journeyDetail&&!journeyDetail.edit&&<JourneyDetail journey={currentJourney} trip={trip} repository={repository} trigger={journeyDetail.trigger} onClose={()=>setJourneyDetail(null)} onEdit={(row,revision)=>setJourneyDetail({...journeyDetail,edit:{row,revision}})} />}
    {ready&&journeyDetail?.edit&&<JourneyFormPanel trip={trip} activities={result.activities} accommodations={result.accommodations} initialDate={currentNavigation.selectedDate} baseline={journeyDetail.edit.row} version={journeyDetail.edit.revision} repository={repository} trigger={journeyDetail.trigger} onClose={()=>setJourneyDetail({...journeyDetail,edit:undefined})} onSaved={()=>setJourneyDetail({...journeyDetail,edit:undefined})} />}
    {ready && detail && !editing && <ActivityDetailPanel trip={trip} activity={detail} returnFocusRef={openRef} fallbackFocusRef={fallbackRef} onClose={() => setDetailId(null)} onEdit={() => setEditing(true)} closeLabel="Fermer la fiche et revenir à la carte" />}
    {ready && detail && editing && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(trip)} activity={detail} initialDate={detail.date} fallbackDate={trip.startDate} fallbackFocusRef={openRef} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
  </section>
}

export function TripMap(props: Parameters<typeof TripMapContent>[0]) {
  return <TripMapContent key={props.trip.id} {...props} />
}
