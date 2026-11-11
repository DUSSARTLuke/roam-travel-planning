import { AccommodationDetail, AccommodationForm } from '../accommodations/AccommodationSpace'
import type { Accommodation } from '../../evolution/v21/contracts'
import type { Revision } from '../../evolution/v21/repository'
import { AccommodationSpace } from '../accommodations/AccommodationSpace'
import { listMapAccommodations } from '../../db/journeys'
import { stayPhase } from '../../accommodations/model'
import { JourneyProgram } from './JourneyProgram'
import { listProgramJourneys, programJourneyRepository } from '../../db/journeys'
import { MultiDayProgram } from './MultiDayProgram'
import { initialProgramNavigation, normalizeProgramNavigation, type ProgramNavigation } from './programNavigation'
import { TransferFormPanel } from './TransferFormPanel'
import { TransferCard } from './TransferCard'
import { transferPlacement } from './transferPlanning'
import type { ManualTransfer } from '../../db/transferModel'
import { OrganizationContext } from './organizationContext'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { ActivityOrganizationPanel } from './ActivityOrganization'
import type { OrderDirection } from '../../db/activityOrganization'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, Lightbulb, List, Plus, Route, Columns3 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listActivities, reorderActivity } from '../../db/activities'
import type { TripActivity } from '../../db/activityModel'
import { ActivityDetailPanel } from './ActivityDetailPanel'
import { tripReferenceCurrency } from '../../db/currency'
import { ActivityFormPanel } from './ActivityFormPanel'
import { DayTimeline } from './DayTimeline'
import { ActivityList } from './ActivityList'
import type { Trip } from '../../db/database'
import { formatDate, getTripDays, getTripMonths } from './dates'
import { TripCalendar } from './TripCalendar'
import './program.css'

function DayDetails({ date, activities, onAdd, onEdit, onOpen, afterActivity, transfers }: {
  transfers: readonly ManualTransfer[]; afterActivity?: (activity: TripActivity) => ReactNode; date: string; activities: TripActivity[]; onAdd?: () => void; onEdit: (activity: TripActivity) => void
  onOpen: (activity: TripActivity, trigger: HTMLButtonElement) => void
}) {
  return (
    <section className="program-day-detail" aria-labelledby="program-day-title">
      <h2 id="program-day-title">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      <DayTimeline transfers={transfers} activities={activities} onAdd={onAdd} onEdit={onEdit} onOpen={onOpen} afterActivity={afterActivity} />
    </section>
  )
}

function DayStrip({ days, selectedDate, onSelect }: { days: string[]; selectedDate: string; onSelect: (date: string) => void }) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedDate])
  return (
    <nav className="program-day-strip" aria-label="Journées du séjour">
      {days.map((date, index) => (
        <button type="button" key={date} ref={date === selectedDate ? selectedRef : undefined}
          className={`program-day-chip ${date === selectedDate ? 'selected' : ''}`}
          aria-pressed={date === selectedDate}
          aria-label={`Jour ${index + 1}, ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
          onClick={() => onSelect(date)}>
          <span>Jour {index + 1}</span>
          <strong>{formatDate(date, { weekday: 'short', day: 'numeric' })}</strong>
          <span>{formatDate(date, { month: 'short', year: 'numeric' })}</span>
        </button>
      ))}
    </nav>
  )
}

export function TripProgram({ trip, initialNavigation, onNavigationChange, readActivities = listActivities, readAccommodations = listMapAccommodations, readJourneys = listProgramJourneys, journeyRepository = programJourneyRepository }: {
  trip: Trip; readAccommodations?: typeof listMapAccommodations; readJourneys?: typeof listProgramJourneys; journeyRepository?: typeof programJourneyRepository; readActivities?: typeof listActivities; initialNavigation?: ProgramNavigation; onNavigationChange?: (state: ProgramNavigation) => void
}) {
  const accommodationResult=useLiveQuery(()=>readAccommodations(trip.id).then(rows=>({rows,error:''}),()=>({rows:[],error:'Impossible de charger les hébergements.'})),[trip.id,readAccommodations])
  const stays=accommodationResult?.rows??[]
  const [stayPanel,setStayPanel]=useState<{id:string;trigger:HTMLButtonElement;edit?:{row:Accommodation;revision:Revision}}|null>(null)
  const currentStay=stays.find(stay=>stay.id===stayPanel?.id)
  if(stayPanel&&accommodationResult&&!accommodationResult.error&&!currentStay)setStayPanel(null)
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const months = useMemo(() => getTripMonths(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [navigation, setNavigation] = useState(() => initialNavigation ?? initialProgramNavigation(trip.startDate))
  const currentNavigation = normalizeProgramNavigation(navigation, days, months)
  const { mode, selectedDate, month } = currentNavigation
  function navigate(patch: Partial<ProgramNavigation>) {
    const next = { ...currentNavigation, ...patch }
    setNavigation(next)
    onNavigationChange?.(next)
  }
  const programFocusRef = useRef<HTMLButtonElement>(null)
  const detailOriginRef = useRef<HTMLButtonElement>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ activity: TripActivity | null; date: string | null } | null>(null)
  const [organization, setOrganization] = useState<{ activity: TripActivity; mode: 'date' | 'time'; trigger: HTMLButtonElement } | null>(null)
  const [ordering, setOrdering] = useState(false)
  const orderingLock = useRef(false)
  const [organizationError, setOrganizationError] = useState('')
  const [transferEditor, setTransferEditor] = useState<{ transfer: ManualTransfer | null; trigger: HTMLButtonElement; date: string } | null>(null)
  const [reload, setReload] = useState(0)
  const result = useLiveQuery(() => readActivities(trip.id).then(
    (activities) => ({ activities, error: '' }),
    () => ({ activities: [] as TripActivity[], error: 'Impossible de charger les activités de ce voyage.' }),
  ), [trip.id, reload, readActivities])
  const activities = result?.activities ?? []
  const detailActivity = activities.find((activity) => activity.id === detailId && activity.tripId === trip.id) ?? null
  // Invalidate the selection before rendering if the live query loses access
  // or the activity disappears (including changes made in another tab).
  if (detailId !== null && result !== undefined && (result.error || detailActivity === null)) {
    setDetailId(null)
  }
  const ready = result !== undefined && !result.error && trip.archived !== true && trip.deletedAt === undefined
  useReloadBlocker(ordering, 'Réorganisation des activités en cours')
  if (organization && result !== undefined && !ready) setOrganization(null)
  const transfers = trip.manualTransfers ?? []
  if (transferEditor && !ready) setTransferEditor(null)
  const transferPlacements = new Map(transfers.map((item) => [item.id, transferPlacement(item, activities)]))
  const invalidTransfers = transfers.filter((item) => transferPlacements.get(item.id)?.day === null)
  function editTransfer(transfer: ManualTransfer, trigger: HTMLButtonElement) { if (ready) setTransferEditor({ transfer, trigger, date: activities.find((item) => item.id === transfer.fromActivityId)?.date ?? selectedDate }) }
  function afterActivity(activity: TripActivity) {
    return transfers.filter((item) => item.fromActivityId === activity.id && transferPlacements.get(item.id)?.day !== null)
      .map((item) => <TransferCard key={item.id} transfer={item} transfers={transfers} activities={activities} onEdit={editTransfer} disabled={!ready} />)
  }
  const dayActivities = activities.filter((activity) => activity.date === selectedDate)
  const ideas = activities.filter((activity) => activity.date === null)
  const outsideDays = activities.filter((activity) => activity.date !== null && (activity.date < trip.startDate || activity.date > trip.endDate))
  const counts: Record<string, number> = {}
  for (const activity of activities) {
    if (activity.date !== null) counts[activity.date] = (counts[activity.date] ?? 0) + 1
  }

  async function reorder(activity: TripActivity, direction: OrderDirection) {
    if (!ready || orderingLock.current) return
    orderingLock.current = true; setOrdering(true); setOrganizationError('')
    try { await reorderActivity(trip.id, activity.id, direction) }
    catch (error) { setOrganizationError(error instanceof Error ? error.message : 'Impossible de modifier l’ordre.') }
    finally { orderingLock.current = false; setOrdering(false) }
  }

  function addActivity() {
    if (ready) setEditor({ activity: null, date: mode === 'ideas' ? null : selectedDate })
  }

  function openActivity(activity: TripActivity, trigger: HTMLButtonElement) {
    if (!ready || activity.tripId !== trip.id) return
    detailOriginRef.current = trigger
    setDetailId(activity.id)
  }

  function editActivity(activity: TripActivity) {
    if (ready && activity.tripId === trip.id) setEditor({ activity, date: activity.date })
  }

  function activitySaved(activity: TripActivity) {
    setEditor(null)
    // Editing from the detail panel returns to it without changing the source
    // day/list. Its data comes from the live query, not the editor snapshot.
    if (detailId !== null) return
    if (activity.date === null) navigate({ mode: 'ideas' })
    else if (activity.date >= trip.startDate && activity.date <= trip.endDate) selectDay(activity.date)
  }

  function selectDay(date: string, returnToDay = false) {
    navigate({ selectedDate: date, month: date.slice(0, 7), mode: !returnToDay && mode === 'multi' ? 'multi' : 'day' })
  }
  function addForDay(date: string) {
    if (!ready) return
    selectDay(date)
    setEditor({ activity: null, date })
  }

  return (
    <OrganizationContext value={{ activities, busy: !ready || ordering, reorder, open: (activity, mode, trigger) => {
      if (ready && !orderingLock.current) setOrganization({ activity, mode, trigger })
    } }}>
    <section className="trip-program">
      {organizationError && <p role="alert">{organizationError}</p>}
      {ordering && <p role="status">Modification de l’ordre…</p>}
      <header className="program-heading">
        <p className="eyebrow">{trip.destination}</p>
        <h1>Programme</h1>
        <p className="subtitle">{days.length} journée{days.length > 1 ? 's' : ''} pour profiter du voyage.</p>
      </header>
      {result === undefined && <p role="status">Chargement des activités…</p>}
      {result?.error && <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => setReload((value) => value + 1)}>Réessayer</button></div>}
      {days.length === 0 ? <p className="empty-state" role="status">Les dates de ce voyage ne permettent pas d’afficher le programme. Vérifie les dates de départ et de retour.</p> : <>
        <div className="program-mode-switch" role="group" aria-label="Mode d’affichage du programme">
          <button type="button" ref={mode === 'day' ? programFocusRef : undefined} aria-pressed={mode === 'day'} onClick={() => navigate({ mode: 'day' })}><List size={18} /> Jour</button>
          <button type="button" ref={mode === 'multi' ? programFocusRef : undefined} aria-pressed={mode === 'multi'} onClick={() => navigate({ mode: 'multi' })}><Columns3 size={18} /> Multi-jours</button>
          <button type="button" ref={mode === 'calendar' ? programFocusRef : undefined} aria-pressed={mode === 'calendar'} onClick={() => navigate({ month: selectedDate.slice(0, 7), mode: 'calendar' })}><CalendarDays size={18} /> Calendrier</button>
          <button type="button" ref={mode === 'ideas' ? programFocusRef : undefined} aria-pressed={mode === 'ideas'} onClick={() => navigate({ mode: 'ideas' })}><Lightbulb size={18} /> Idées à planifier ({ideas.length})</button>
        </div>
        {mode !== 'multi' && <div className="program-view-actions" role="group" aria-label="Actions de la vue du programme">
          {(mode === 'calendar' || (mode === 'ideas' ? ideas.length > 0 : dayActivities.length > 0)) && <button type="button" className="primary-button program-add" disabled={!ready} onClick={addActivity}>
            <Plus size={18} aria-hidden="true" />{mode === 'ideas' ? 'Ajouter une idée' : 'Ajouter une activité'}</button>}
          {mode !== 'ideas' && <button type="button" className="secondary-button program-add-transfer" disabled={!ready || activities.filter((item) => item.date !== null).length < 2}
            aria-haspopup="dialog" onClick={(event) => setTransferEditor({ transfer: null, trigger: event.currentTarget, date: selectedDate })}><Route size={18} aria-hidden="true" />Ajouter un déplacement</button>}
        </div>}
        {mode === 'day' ? <>
          <DayStrip days={days} selectedDate={selectedDate} onSelect={selectDay} />
          {result && !result.error && <DayDetails transfers={transfers} date={selectedDate} activities={dayActivities} afterActivity={afterActivity} onAdd={ready ? addActivity : undefined} onEdit={editActivity} onOpen={openActivity} />}
        </> : mode === 'multi' ? (result && !result.error && <MultiDayProgram transfers={transfers} days={days} selectedDate={selectedDate} activities={activities} onSelect={selectDay}
          onAdd={ready ? addForDay : undefined} onAddTransfer={ready ? (date, trigger) => setTransferEditor({ transfer: null, trigger, date }) : undefined} onEdit={editActivity} onOpen={openActivity} afterActivity={afterActivity} renderDayExtra={day=><AccommodationSpace trip={trip} date={day} repository={journeyRepository} readStays={async()=>stays}/>} />) : mode === 'ideas' ? <section className="program-day-detail" aria-labelledby="program-ideas-title">
          <h2 id="program-ideas-title">Idées à planifier</h2>
          {result && !result.error && <ActivityList activities={ideas} ideas onAdd={ready ? addActivity : undefined} onEdit={editActivity} onOpen={openActivity} />}
        </section> : <TripCalendar months={months} month={month} startDate={trip.startDate} endDate={trip.endDate}
          selectedDate={selectedDate} accommodations={stays} onAccommodationOpen={(stay,trigger)=>setStayPanel({id:stay.id,trigger})} accommodationCounts={Object.fromEntries(days.map(day=>[day,stays.filter(stay=>stayPhase(stay,day)).length]))} activityCounts={counts} onMonthChange={(value) => navigate({ month: value })} onSelect={(date) => selectDay(date, true)} />}
      </>}
      {accommodationResult?.error&&<p role="alert">{accommodationResult.error}</p>}
      {mode!=='multi'&&<AccommodationSpace key={`stay-${trip.id}`} trip={trip} date={selectedDate} repository={journeyRepository} readStays={async()=>stays}/>}
      {currentStay&&stayPanel&&!stayPanel.edit&&<AccommodationDetail trip={trip} stay={currentStay} repository={journeyRepository} trigger={stayPanel.trigger} onClose={()=>setStayPanel(null)} onEdit={(row,revision)=>setStayPanel({...stayPanel,edit:{row,revision}})}/>}
      {stayPanel?.edit&&<AccommodationForm trip={trip} baseline={stayPanel.edit.row} revision={stayPanel.edit.revision} repository={journeyRepository} trigger={stayPanel.trigger} onClose={()=>setStayPanel({...stayPanel,edit:undefined})} onSaved={()=>setStayPanel({...stayPanel,edit:undefined})}/>}
      <JourneyProgram key={trip.id} trip={trip} activities={activities} date={selectedDate} repository={journeyRepository} readJourneys={readJourneys} blocked={!ready||!!editor||!!organization||!!transferEditor||!!detailActivity} onDate={date=>{if(days.includes(date))navigate({selectedDate:date,month:date.slice(0,7)})}} />
      {outsideDays.length > 0 && <section className="program-day-detail" aria-labelledby="program-outside-title">
        <h2 id="program-outside-title">Autres dates ({outsideDays.length})</h2>
        <p className="subtitle">Ces activités sont en dehors des dates actuelles du séjour. Tu peux modifier leur date pour les replanifier.</p>
        <ActivityList activities={outsideDays} onEdit={editActivity} onOpen={openActivity} showDate afterActivity={afterActivity} />
      </section>}
      {result && !result.error && invalidTransfers.length > 0 && <section className="program-day-detail" aria-labelledby="transfer-corrections">
        <h2 id="transfer-corrections">Déplacements à vérifier ({invalidTransfers.length})</h2>
        {invalidTransfers.map((item) => <TransferCard key={item.id} transfer={item} transfers={transfers} activities={activities} onEdit={editTransfer} disabled={!ready} />)}
      </section>}
      {transferEditor && ready && <TransferFormPanel trip={trip} activities={activities} transfer={transferEditor.transfer} initialDate={transferEditor.date}
        trigger={transferEditor.trigger} fallbackFocusRef={programFocusRef} onClose={() => setTransferEditor(null)} />}
      {organization && ready && activities.some((item) => item.id === organization.activity.id) && <ActivityOrganizationPanel
        fallbackFocusRef={programFocusRef} activity={organization.activity} trip={trip} mode={organization.mode} trigger={organization.trigger} onClose={() => setOrganization(null)} />}
      {!transferEditor && !organization && !editor && ready && detailActivity && <ActivityDetailPanel trip={trip} activity={detailActivity}
        returnFocusRef={detailOriginRef} fallbackFocusRef={programFocusRef}
        onClose={() => setDetailId(null)} onEdit={() => editActivity(detailActivity)} />}
      {editor && <ActivityFormPanel referenceCurrency={tripReferenceCurrency(trip)} tripId={trip.id} activity={editor.activity} initialDate={editor.date}
        fallbackDate={selectedDate} fallbackFocusRef={programFocusRef} onClose={() => setEditor(null)} onSaved={activitySaved} />}
    </section></OrganizationContext>
  )
}
