import { PracticalNotebook } from './components/practical/PracticalNotebook'
import { copyPracticalRecords } from './db/practical'
import { TripLibrary } from './components/reservations/TripLibrary'
import { copyPreparationTasks } from './db/preparation'
import { TripOverview } from './components/dashboard/TripOverview'
import { copyPlannedBudget, initialBudgetView, type BudgetViewState } from './money/budgetTracking'
import { TripBudget } from './components/budget/TripBudget'
import type { TripMapView } from './maps/tripMapView'
import { createId } from './utils/createId'
import { tripMapNavigation, programNavigationFromMap, type TripMapNavigation } from './maps/tripMapNavigation'
import { TripMap } from './components/map/TripMap'
import type { ProgramNavigation } from './components/program/programNavigation'

import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  initializeDatabase,
  updateTripTrash,
  type Trip,
} from './db/database'
import {
  Compass,
  Plus,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  Trash2,
  RotateCcw,
  Search,
  Settings2,
  MapPin,
  CalendarDays,
  ArrowRight,
  House,
  Map,
  Wallet,
  Menu,
  ArrowLeft,
  ClipboardList,
  X,
  type LucideIcon,
} from 'lucide-react'
import { TripConfirmation } from './TripConfirmation'
import { TripProgram } from './components/program/TripProgram'
import { TripExportMenu } from './components/backup/TripExportMenu'
import { BackupExport, BackupPage } from './components/backup/BackupExport'
import { useReloadBlocker } from './pwa/useReloadBlocker'
import { tripReferenceCurrency, validateCurrency } from './db/currency'
import { CurrencySelector } from './components/currency/CurrencySelector'
import { AutomaticRatesController, AutomaticRatesStatus } from './components/currency/AutomaticRatesStatus'
import { ManualRatesEditor } from './components/currency/ManualRatesEditor'
import { manualRateDrafts, prepareManualRates, validateManualRates, type ManualRateDraft, type ManualExchangeRate } from './money/manualRates'
import { saveTripWithRates, type TripEditableFields } from './db/tripRates'
import './App.css'

type TabId = 'home' | 'program' | 'map' | 'budget' | 'more'

type Tab = {
  id: TabId
  label: string
  icon: LucideIcon
}

const tabs: Tab[] = [
  { id: 'home', label: 'Accueil', icon: House },
  { id: 'program', label: 'Programme', icon: CalendarDays },
  { id: 'map', label: 'Carte', icon: Map },
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'more', label: 'Plus', icon: Menu },
]


const emptyTripForm: TripEditableFields = {
  referenceCurrency: 'EUR',
  destination: '',
  country: '',
  startDate: '',
  endDate: '',
  travelers: 2,
  image: '',
}

function formatTripDates(trip: Trip) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

  return `${formatter.format(new Date(`${trip.startDate}T12:00:00Z`))} – ${formatter.format(new Date(`${trip.endDate}T12:00:00Z`))}`
}


function App() {
  const [budgetViews, setBudgetViews] = useState(() => new globalThis.Map<string, BudgetViewState>())
  const [homeSpace, setHomeSpace] = useState<{ tripId: string; kind: 'library' | 'practical' } | null>(null)
  const practicalTrigger = useRef<HTMLButtonElement>(null)
  const libraryTrigger = useRef<HTMLButtonElement>(null)
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [mapViews, setMapViews] = useState(() => new globalThis.Map<string, TripMapView>())
  const [mapNavigation, setMapNavigation] = useState(() => new globalThis.Map<string, TripMapNavigation>())
  const [programNavigation, setProgramNavigation] = useState(() => new globalThis.Map<string, ProgramNavigation>())
const trips = useLiveQuery(
  () => db.trips.toArray(),
  [],
)

const [databaseReady, setDatabaseReady] = useState(false)
const [databaseError, setDatabaseError] = useState('')

useEffect(() => {
  let active = true

  initializeDatabase()
    .then(() => {
      if (active) setDatabaseReady(true)
    })
    .catch((error: unknown) => {
      console.error('Erreur IndexedDB :', error)

      if (active) {
        setDatabaseError(
          "Impossible d'initialiser le stockage local.",
        )
      }
    })

  return () => {
    active = false
  }
}, [])
  const [showCreateTrip, setShowCreateTrip] = useState(false)
  const tripFormOrigin = useRef<HTMLElement | null>(null)

  const [newTrip, setNewTrip] = useState(emptyTripForm)
  const [rateDrafts, setRateDrafts] = useState<ManualRateDraft[]>([])
  const rateBaseline = useRef<ManualExchangeRate[]>([])
  const tripFieldsBaseline = useRef<TripEditableFields | null>(null)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const [duplicatingTripId, setDuplicatingTripId] = useState<string | null>(null)
  const [duplicationError, setDuplicationError] = useState('')
  const duplicationRef = useRef(false)
  const duplicationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (duplicationTimerRef.current !== null) clearTimeout(duplicationTimerRef.current)
  }, [])

  const [formError, setFormError] = useState('')
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [archivingTripId, setArchivingTripId] = useState<string | null>(null)
  const writeLock = useRef(false)
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashError, setTrashError] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [confirmation, setConfirmation] = useState<{
    trip: Trip
    action: 'trash' | 'delete'
  } | null>(null)
  const writeBusy = isSaving || duplicatingTripId !== null || archivingTripId !== null || trashBusy
  useReloadBlocker(showCreateTrip || writeBusy || confirmation !== null, 'Termine ou ferme le formulaire de voyage et les opérations en cours.')

const selectedTrip = (trips ?? []).find(
    (item) => item.id === selectedTripId && item.archived !== true && item.deletedAt === undefined,
  ) ?? null

  // Reconcile an invalid selection before rendering its navigation. This
  // guarded adjustment also handles changes from another tab and terminates
  // as soon as selectedTripId is cleared; no synchronization effect is needed.
  if (trips !== undefined && selectedTripId !== null && selectedTrip === null) {
    setSelectedTripId(null)
    setActiveTab('home')
    setShowArchived(false)
    setShowTrash(false)
  }

  const isTripOpen = selectedTrip !== null

  function openTrip(tripId: string) {
    setSelectedTripId(tripId)
    setActiveTab('home')
  }

  function closeTrip() {
    setSelectedTripId(null)
    setShowArchived(false)
    setShowTrash(false)
    setActiveTab('home')
  }

  
function closeCreateTrip() {
  if (savingRef.current) return
  setShowCreateTrip(false)
  setEditingTripId(null)
  setNewTrip({ ...emptyTripForm })
  setRateDrafts([])
  rateBaseline.current = []
  tripFieldsBaseline.current = null
  setFormError('')
  const origin = tripFormOrigin.current
  tripFormOrigin.current = null
  requestAnimationFrame(() => { if (origin?.isConnected) origin.focus() })
}

function openCreateTrip() {
  if (writeLock.current || showCreateTrip) return
  tripFormOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  setEditingTripId(null)
  setNewTrip({ ...emptyTripForm })
  setRateDrafts([])
  rateBaseline.current = []
  tripFieldsBaseline.current = null
  setFormError('')
  setShowCreateTrip(true)
}

function editTrip(trip: Trip) {
  if (writeLock.current || showCreateTrip) return
  let rates: ManualExchangeRate[]
  try { rates = validateManualRates(trip.manualExchangeRates) }
  catch (error) { setDatabaseError(error instanceof Error ? error.message : 'Taux invalides.'); return }
  tripFormOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const { id, ...fields } = trip
  tripFieldsBaseline.current = { destination: trip.destination, country: trip.country, startDate: trip.startDate,
    endDate: trip.endDate, travelers: trip.travelers, image: trip.image, referenceCurrency: tripReferenceCurrency(trip) }
  rateBaseline.current = rates
  setRateDrafts(manualRateDrafts(rates))
  setEditingTripId(id)
  setNewTrip({ ...fields, referenceCurrency: tripReferenceCurrency(trip) })
  setFormError('')
  setShowCreateTrip(true)
}

async function setTripArchived(trip: Trip, archived: boolean) {
  if (writeLock.current) return
  writeLock.current = true
  setArchivingTripId(trip.id)
  setArchiveError('')
  try {
    const updated = await db.transaction('rw', db.trips, async () => {
      const current = await db.trips.get(trip.id)
      if (!current || current.deletedAt !== undefined) return 0
      return db.trips.update(trip.id, { archived })
    })
    if (updated === 0) {
      setArchiveError('Ce voyage est introuvable. Actualise la liste.')
      return
    }
    if (archived && trip.id === selectedTripId) closeTrip()
  } catch (error) {
    console.error('Erreur d’archivage/restauration :', error)
    setArchiveError(archived
      ? "Impossible d'archiver ce voyage. Réessaie."
      : 'Impossible de restaurer ce voyage. Réessaie.')
  } finally {
    writeLock.current = false
    setArchivingTripId(null)
  }
}

async function runTrashAction(trip: Trip, action: 'trash' | 'restore' | 'delete') {
  if (writeLock.current) return
  if (action !== 'restore' &&
      (confirmation?.trip.id !== trip.id || confirmation.action !== action)) return
  writeLock.current = true
  setTrashBusy(true)
  setTrashError('')
  try {
    await updateTripTrash(trip.id, action, trip.deletedAt)
    if (action === 'trash' && trip.id === selectedTripId) closeTrip()
    setConfirmation(null)
  } catch (error) {
    setTrashError(error instanceof Error && error.name === 'Error'
      ? error.message
      : "Impossible d'enregistrer cette opération. Réessaie. Tes données sont conservées.")
  } finally {
    writeLock.current = false
    setTrashBusy(false)
  }
}

function requestTrashAction(trip: Trip, action: 'trash' | 'delete') {
  if (writeLock.current) return
  setTrashError('')
  setConfirmation({ trip, action })
}

async function duplicateTrip(trip: Trip) {
  if (writeLock.current || duplicationRef.current) return

  writeLock.current = true
  duplicationRef.current = true
  setDuplicatingTripId(trip.id)
  setDuplicationError('')

  try {
    await db.trips.add({
      id: createId(),
      destination: `${trip.destination} (copie)`,
      ...copyPlannedBudget(trip),
      ...copyPreparationTasks(trip.preparationTasks),
      ...copyPracticalRecords(trip.practicalRecords),
      ...(trip.participants ? { participants: trip.participants.map((participant) => ({ ...participant, id: createId() })) } : {}),
      referenceCurrency: tripReferenceCurrency(trip),
      ...(trip.manualExchangeRates !== undefined ? { manualExchangeRates: validateManualRates(trip.manualExchangeRates) } : {}),
      country: trip.country,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travelers: trip.travelers,
      image: trip.image,
      archived: false,
    })
    if (showArchived || showTrash) {
      setShowArchived(false)
      setShowTrash(false)
      setSearch('')
    }
  } catch (error) {
    console.error('Erreur de duplication :', error)
    setDuplicationError("Impossible de dupliquer ce voyage. Réessaie dans un instant.")
  } finally {
    writeLock.current = false
    // Keep the duplication button locked briefly even after a fast write.
    duplicationTimerRef.current = setTimeout(() => {
      duplicationRef.current = false
      duplicationTimerRef.current = null
      setDuplicatingTripId(null)
    }, 600)
  }
}

async function saveTrip(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (writeLock.current) return
  setFormError('')

  const destination = newTrip.destination.trim()
  const country = newTrip.country.trim()

  if (!destination || !country || !newTrip.startDate || !newTrip.endDate) {
    setFormError('Merci de remplir tous les champs obligatoires.')
    return
  }

  if (newTrip.endDate < newTrip.startDate) {
    setFormError('La date de retour doit être après la date de départ.')
    return
  }

  if (!Number.isInteger(newTrip.travelers) || newTrip.travelers < 1) {
    setFormError('Le nombre de voyageurs doit être supérieur à zéro.')
    return
  }

  let referenceCurrency: string
  try { referenceCurrency = validateCurrency(newTrip.referenceCurrency) }
  catch (error) { setFormError(error instanceof Error ? error.message : 'Devise invalide.'); return }

  let desiredRates: ManualExchangeRate[]
  try { desiredRates = prepareManualRates(rateDrafts, rateBaseline.current, new Date().toISOString()) }
  catch (error) { setFormError(error instanceof Error ? error.message : 'Taux invalides.'); return }

  const fields: TripEditableFields = {
    referenceCurrency,
    destination,
    country,
    startDate: newTrip.startDate,
    endDate: newTrip.endDate,
    travelers: newTrip.travelers,
    image: newTrip.image.trim(),
  }

  writeLock.current = true
  savingRef.current = true
  setIsSaving(true)

  try {
    if (editingTripId !== null) {
      await saveTripWithRates(editingTripId, fields, rateBaseline.current, desiredRates, db, tripFieldsBaseline.current ?? undefined)
    } else {
      await db.trips.add({ ...fields, ...(desiredRates.length ? { manualExchangeRates: desiredRates } : {}), id: createId(), archived: false })
      if (showArchived || showTrash) {
        setShowArchived(false)
        setShowTrash(false)
        setSearch('')
      }
    }
  } catch (error) {
    console.error('Erreur de sauvegarde :', error)
    setFormError(error instanceof Error ? error.message : "Impossible d’enregistrer ce voyage. Réessaie.")
    return
  } finally {
    writeLock.current = false
    savingRef.current = false
    setIsSaving(false)
  }

  closeCreateTrip()
}


function navigateToTab(tabId: TabId) {
  if (!isTripOpen && tabId !== 'home' && tabId !== 'more') {
    return
  }

  setActiveTab(tabId)
}

const [search, setSearch] = useState('')

const archivedCount = (trips ?? []).filter((trip) => trip.deletedAt === undefined && trip.archived === true).length
const trashCount = (trips ?? []).filter((trip) => trip.deletedAt !== undefined).length
const filteredTrips = (trips ?? [])
  .filter((trip) => showTrash
    ? trip.deletedAt !== undefined
    : trip.deletedAt === undefined && (trip.archived === true) === showArchived)
  .filter((item) => `${item.destination} ${item.country}`
    .toLocaleLowerCase('fr-FR')
    .includes(search.trim().toLocaleLowerCase('fr-FR')),
)

if (databaseError) {
  return (
    <div className="database-status" role="alert">
      <h1>Erreur de stockage</h1>
      <p>{databaseError}</p>
    </div>
  )
}

if (!databaseReady || trips === undefined) {
  return (
    <div className="database-status" role="status">
      <h1>ROAM</h1>
      <p>Chargement de tes voyages...</p>
    </div>
  )
}
  const selectedTab = tabs.find((tab) => tab.id === activeTab)!

  return (
    <div className="app-shell">
      {selectedTrip && <AutomaticRatesController key={selectedTrip.id} tripId={selectedTrip.id} />}
      <header className="topbar" inert={showCreateTrip}>
        <div className="brand-area">
          <div className="brand">
            <Compass size={25} color="#F59E0B" strokeWidth={2.4} />
            <span>ROAM</span>
          </div>

          {isTripOpen && (
            <button
              className="active-trip"
              onClick={closeTrip}
              title="Retourner à Mes voyages"
            >
              <MapPin size={14} />
              <span>{selectedTrip.destination}</span>
              <ArrowLeft size={13} />
            </button>
          )}
        </div>

        <nav className="desktop-nav" aria-label="Navigation principale">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-link ${activeTab === id ? 'active' : ''}`}
              aria-current={activeTab === id ? 'page' : undefined}
              disabled={!isTripOpen && id !== 'home' && id !== 'more'}
              onClick={() => navigateToTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        {selectedTrip && <button
          type="button"
          className="icon-button trip-settings-button"
          aria-label="Paramètres du voyage"
          title="Paramètres du voyage"
          aria-haspopup="dialog"
          aria-expanded={showCreateTrip && editingTripId === selectedTrip.id}
          disabled={writeBusy || showCreateTrip || confirmation !== null}
          onClick={() => editTrip(selectedTrip)}
        >
          <Settings2 size={21} aria-hidden="true" />
          <span>Paramètres</span>
        </button>}
      </header>

      <main className="main-content" inert={showCreateTrip}>
        {!confirmation && trashError && <p className="form-error" role="alert">{trashError}</p>}
        {archiveError && <p className="form-error" role="alert">{archiveError}</p>}
        {activeTab === 'home' && selectedTrip ? (
  <section className="trip-dashboard">
    <button className="back-button" onClick={closeTrip}>
      <ArrowLeft size={18} />
      Mes voyages
    </button>

    <div className="trip-hero">
{selectedTrip.image ? (
  <img
    src={selectedTrip.image}
    alt={`Vue de ${selectedTrip.destination}`}
  />
) : (
  <div className="trip-hero-fallback">
    <MapPin size={48} />
  </div>
)}      <div className="trip-hero-content">
        <p className="eyebrow">MON VOYAGE</p>
        <h1>{selectedTrip.destination}</h1>
        <p>{formatTripDates(selectedTrip)} · {selectedTrip.travelers} voyageurs</p>
      </div>
    </div>

    <h2 className="dashboard-title">Organiser mon voyage</h2>

    <div className="dashboard-grid">
      <button type="button" className="dashboard-tile" ref={libraryTrigger} aria-expanded={homeSpace?.tripId === selectedTrip.id && homeSpace.kind === 'library'} onClick={() => setHomeSpace({ tripId: selectedTrip.id, kind: 'library' })}><ClipboardList size={24} /><strong>Réservations et documents</strong><span>Retrouver les informations et fichiers du voyage</span></button>
      <button type="button" className="dashboard-tile" ref={practicalTrigger} aria-expanded={homeSpace?.tripId === selectedTrip.id && homeSpace.kind === 'practical'} onClick={() => setHomeSpace({ tripId: selectedTrip.id, kind: 'practical' })}><ClipboardList size={24} /><strong>Infos pratiques</strong><span>Contacts, adresses et notes du voyage</span></button>
      {[
        {
          id: 'program' as TabId,
          label: 'Programme',
          description: 'Organiser les journées',
          icon: CalendarDays,
        },
        {
          id: 'map' as TabId,
          label: 'Carte',
          description: 'Explorer les lieux',
          icon: Map,
        },
        {
          id: 'budget' as TabId,
          label: 'Budget',
          description: 'Suivre les dépenses',
          icon: Wallet,
        },
        {
          id: 'more' as TabId,
          label: 'Sauvegardes et plus',
          description: 'Gérer les sauvegardes locales',
          icon: ClipboardList,
        },
      ].map(({ id, label, description, icon: Icon }) => (
        <button
          key={id}
          className="dashboard-tile"
          onClick={() => setActiveTab(id)}
        >
          <Icon size={24} />
          <strong>{label}</strong>
          <span>{description}</span>
        </button>
      ))}
    </div>
    <>{homeSpace?.tripId === selectedTrip.id && homeSpace.kind === 'practical' ? <PracticalNotebook key={selectedTrip.id} trip={selectedTrip} onClose={() => { setHomeSpace(null); practicalTrigger.current?.focus({ preventScroll: true }) }} /> : homeSpace?.tripId === selectedTrip.id && homeSpace.kind === 'library' ? <TripLibrary key={selectedTrip.id} trip={selectedTrip} onClose={() => { setHomeSpace(null); libraryTrigger.current?.focus({ preventScroll: true }) }} /> : <TripOverview key={selectedTrip.id} trip={selectedTrip} navigate={setActiveTab} />}</>
    <details className="trip-management"><summary>Gérer et sauvegarder ce voyage</summary>
    <button
      type="button"
      className="back-button"
      disabled={writeBusy}
      onClick={(event) => {
        event.stopPropagation()
        void setTripArchived(selectedTrip, true)
      }}
    >
      <Archive size={18} />
      {archivingTripId === selectedTrip.id ? 'Archivage…' : 'Archiver ce voyage'}
    </button>

    <button type="button" className="back-button danger-text" disabled={writeBusy}
      onClick={(event) => { event.stopPropagation(); requestTrashAction(selectedTrip, 'trash') }}>
      <Trash2 size={18} /> Mettre à la corbeille
    </button>

    <BackupExport key={selectedTrip.id} scope={{ mode: 'trip', tripId: selectedTrip.id }} />
    </details>
  </section>
) : activeTab === 'home' ? (
          <>
            <section className="page-heading">
              <div>
                <p className="eyebrow">TES AVENTURES</p>
                <h1>{showTrash ? 'Corbeille' : showArchived ? 'Voyages archivés' : 'Mes voyages'}</h1>
                <p className="subtitle">
                  Organise tes découvertes, à ta façon.
                </p>
              </div>

              <button className="primary-button" disabled={writeBusy} onClick={openCreateTrip}>
                <Plus size={19} />
                Nouveau voyage
              </button>
            </section>

            <nav className="trip-list-nav" aria-label="Listes de voyages">
              {(['active', 'archived', 'trash'] as const).map((view) => (
                <button key={view} type="button" className="back-button"
                  aria-current={(view === 'trash' ? showTrash : view === 'archived' ? showArchived && !showTrash : !showArchived && !showTrash) ? 'page' : undefined}
                  onClick={() => {
                    setShowArchived(view === 'archived')
                    setShowTrash(view === 'trash')
                    setSearch('')
                    setArchiveError('')
                    setDuplicationError('')
                    setTrashError('')
                  }}>
                  {view === 'trash' ? <Trash2 size={18} /> : view === 'archived' ? <Archive size={18} /> : <House size={18} />}
                  {view === 'trash' ? `Corbeille (${trashCount})` : view === 'archived' ? `Voyages archivés (${archivedCount})` : 'Mes voyages actifs'}
                </button>
              ))}
            </nav>

            <div className="search-box">
              <Search size={19} />
              <input
                type="search"
                placeholder="Rechercher un voyage..."
                aria-label="Rechercher un voyage"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <section className="trips-section">
              <div className="section-heading">
                <h2>{showTrash ? 'Corbeille' : showArchived ? 'Mes archives' : 'Mes destinations'}</h2>
                <span>{filteredTrips.length} voyage(s)</span>
              </div>

              {duplicationError && (
                <p className="form-error" role="alert">{duplicationError}</p>
              )}

              <div className="trip-grid">
                {filteredTrips.map((item) => (
                  <article className="trip-card" key={item.id}>
                    <div className="trip-image">
                      {item.image ? (
  <img
    src={item.image}
    alt={`Vue de ${item.destination}`}
  />
) : (
  <div className="trip-image-fallback">
    <MapPin size={40} />
    <span>{item.destination}</span>
  </div>
)}
                      <span className="trip-badge">{showTrash ? 'Corbeille' : showArchived ? 'Archivé' : 'Voyage'}</span>
                    </div>

                    <div className="trip-info">
                      <div className="trip-location">
                        <MapPin size={14} />
                        {item.country}
                      </div>

                      <h3>{item.destination}</h3>

                      <div className="trip-meta">
                        <CalendarDays size={15} />
                        <span>{formatTripDates(item)}</span>
                      </div>

                      <div className="trip-footer">
                        <span>{item.travelers} voyageurs</span>
                        <div className="trip-actions">
                          <TripExportMenu tripId={item.id} destination={item.destination} />
                          {showTrash ? <>
                            <button type="button" className="secondary-button trip-action-label" disabled={writeBusy}
                              onClick={(event) => { event.stopPropagation(); void runTrashAction(item, 'restore') }}>
                              <RotateCcw size={18} /> Restaurer
                            </button>
                            <button type="button" className="secondary-button danger-text trip-action-label" disabled={writeBusy}
                              onClick={(event) => { event.stopPropagation(); requestTrashAction(item, 'delete') }}>
                              <Trash2 size={18} /> Supprimer définitivement
                            </button>
                          </> : <>
                          <button
                            type="button"
                            className="card-edit"
                            aria-label={`Modifier le voyage ${item.destination}`}
                            title="Modifier le voyage"
                            disabled={writeBusy}
                            onClick={(event) => {
                              event.stopPropagation()
                              editTrip(item)
                            }}
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            type="button"
                            className="card-edit"
                            aria-label={`Dupliquer le voyage ${item.destination}`}
                            title={duplicatingTripId === item.id ? 'Duplication en cours…' : 'Dupliquer le voyage'}
                            disabled={writeBusy}
                            aria-busy={duplicatingTripId === item.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void duplicateTrip(item)
                            }}
                          >
                            <Copy size={18} />
                          </button>
                          <button
                            type="button"
                            className="card-edit"
                            aria-label={`${showArchived ? 'Restaurer' : 'Archiver'} le voyage ${item.destination}`}
                            title={showArchived ? 'Restaurer le voyage' : 'Archiver le voyage'}
                            disabled={writeBusy}
                            aria-busy={archivingTripId === item.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void setTripArchived(item, !showArchived)
                            }}
                          >
                            {showArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                          </button>
                          <button type="button" className="secondary-button danger-text trip-action-label" disabled={writeBusy}
                            onClick={(event) => { event.stopPropagation(); requestTrashAction(item, 'trash') }}>
                            <Trash2 size={18} /> Mettre à la corbeille
                          </button>
                          {!showArchived && <button
                            className="card-arrow"
                            aria-label={`Ouvrir le voyage ${item.destination}`}
                            onClick={() => openTrip(item.id)}
                          >
                            <ArrowRight size={20} />
                          </button>}
                          </>}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>


              {filteredTrips.length === 0 && (
                <div className="empty-state">
                  {showTrash && trashCount === 0 ? 'La corbeille est vide.' : showArchived && archivedCount === 0
                    ? "Aucun voyage archivé pour l'instant."
                    : 'Aucun voyage ne correspond à ta recherche.'}
                </div>
              )}
            </section>
          </>
        ) : activeTab === 'more' ? (
          <BackupPage tripId={selectedTrip?.id} />
        ) : activeTab === 'program' && selectedTrip ? (
          <TripProgram key={selectedTrip.id} trip={selectedTrip} initialNavigation={programNavigation.get(selectedTrip.id)}
            onNavigationChange={(state) => setProgramNavigation((previous) => new globalThis.Map(previous).set(selectedTrip.id, state))} />
        ) : activeTab === 'map' && selectedTrip ? (
          <TripMap key={selectedTrip.id} trip={selectedTrip} initialView={mapViews.get(selectedTrip.id)}
            onViewChange={(view) => { setMapViews((previous) => previous.get(selectedTrip.id) === view ? previous : new globalThis.Map(previous).set(selectedTrip.id, view)) }}
            initialNavigation={tripMapNavigation(selectedTrip, mapNavigation.get(selectedTrip.id), programNavigation.get(selectedTrip.id)?.selectedDate)}
            onNavigationChange={(state) => {
              setMapNavigation((previous) => new globalThis.Map(previous).set(selectedTrip.id, state))
              setProgramNavigation((previous) => new globalThis.Map(previous).set(selectedTrip.id, programNavigationFromMap(selectedTrip, state, previous.get(selectedTrip.id))))
            }} />
        ) : activeTab === 'budget' && selectedTrip ? (
          <TripBudget key={selectedTrip.id} trip={selectedTrip} view={budgetViews.get(selectedTrip.id) ?? initialBudgetView} onViewChange={(view) => setBudgetViews((previous) => new globalThis.Map(previous).set(selectedTrip.id, view))} />
        ) : (
          <section className="placeholder-page">
            <div className="placeholder-icon">
              {(() => {
  const Icon = selectedTab.icon
  return <Icon size={32} />
})()}
            </div>
            <p className="eyebrow">ROAM V2</p>
            <h1>{selectedTab.label}</h1>
            <p className="subtitle">
              Cet espace sera développé prochainement.
            </p>
            <p className="placeholder-note">
              Pour l'instant, nous construisons la navigation.
              Tes voyages restent accessibles dans l'onglet Accueil.
            </p>
          </section>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Navigation mobile" inert={showCreateTrip}>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`bottom-nav-item ${activeTab === id ? 'active' : ''}`}
            aria-current={activeTab === id ? 'page' : undefined}
            disabled={!isTripOpen && id !== 'home' && id !== 'more'}
            onClick={() => navigateToTab(id)}
          >
            <Icon size={21} strokeWidth={activeTab === id ? 2.4 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {confirmation && <TripConfirmation
        trip={confirmation.trip}
        permanent={confirmation.action === 'delete'}
        busy={trashBusy}
        error={trashError}
        onCancel={() => { if (!writeLock.current) { setConfirmation(null); setTrashError('') } }}
        onConfirm={() => { void runTrashAction(confirmation.trip, confirmation.action) }}
      />}

{showCreateTrip && (
  <div className="modal-overlay">
    <div
      className="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-trip-title"
    >
      <div className="modal-header">
        <div>
          <h2 id="create-trip-title">{editingTripId !== null ? 'Modifier le voyage' : 'Nouveau voyage'}</h2>
          <p>{editingTripId !== null ? 'Mets à jour les informations de ton voyage.' : 'Prépare ta prochaine aventure.'}</p>
        </div>

        <button
          type="button"
          className="modal-close"
          disabled={isSaving}
          aria-label="Fermer"
          onClick={closeCreateTrip}
        >
          <X size={21} />
        </button>
      </div>

      <form className="trip-form" onSubmit={saveTrip} aria-busy={isSaving}>
        <label>
          Destination *
          <input
            required
            autoFocus
            placeholder="Ex. Rome"
            value={newTrip.destination}
            onChange={(event) =>
              setNewTrip({
                ...newTrip,
                destination: event.target.value,
              })
            }
          />
        </label>

        <label>
          Pays *
          <input
            required
            placeholder="Ex. Italie"
            value={newTrip.country}
            onChange={(event) =>
              setNewTrip({
                ...newTrip,
                country: event.target.value,
              })
            }
          />
        </label>

        <div className="form-row">
          <label>
            Date de départ *
            <input
              required
              type="date"
              value={newTrip.startDate}
              onChange={(event) =>
                setNewTrip({
                  ...newTrip,
                  startDate: event.target.value,
                })
              }
            />
          </label>

          <label>
            Date de retour *
            <input
              required
              type="date"
              min={newTrip.startDate || undefined}
              value={newTrip.endDate}
              onChange={(event) =>
                setNewTrip({
                  ...newTrip,
                  endDate: event.target.value,
                })
              }
            />
          </label>
        </div>

        <CurrencySelector label="Devise de référence" value={newTrip.referenceCurrency ?? 'EUR'}
          onChange={(code) => setNewTrip({ ...newTrip, referenceCurrency: code })} />

        <label>
          Nombre de voyageurs
          <input
            required
            type="number"
            min="1"
            step="1"
            value={newTrip.travelers}
            onChange={(event) =>
              setNewTrip({
                ...newTrip,
                travelers: Number(event.target.value),
              })
            }
          />
        </label>

        <label>
          Photo (URL facultative)
          <input
            type="url"
            placeholder="https://..."
            value={newTrip.image}
            onChange={(event) =>
              setNewTrip({
                ...newTrip,
                image: event.target.value,
              })
            }
          />
        </label>

        {editingTripId && <AutomaticRatesStatus key={editingTripId} tripId={editingTripId} disabled={isSaving} />}
        <ManualRatesEditor rates={rateDrafts} referenceCurrency={newTrip.referenceCurrency ?? 'EUR'} onChange={setRateDrafts} disabled={isSaving} />

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isSaving}
            onClick={closeCreateTrip}
          >
            Annuler
          </button>

          <button type="submit" className="primary-button" disabled={isSaving}>
            {editingTripId !== null ? <Pencil size={18} /> : <Plus size={18} />}
            {isSaving ? 'Enregistrement…' : editingTripId !== null ? 'Enregistrer les modifications' : 'Créer le voyage'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}

    </div>
  )
}

export default App
