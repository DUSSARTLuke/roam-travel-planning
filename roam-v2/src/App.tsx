
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  initializeDatabase,
  type Trip,
} from './db/database'
import {
  Compass,
  Plus,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
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


const emptyTripForm: Omit<Trip, 'id' | 'archived'> = {
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
  const [activeTab, setActiveTab] = useState<TabId>('home')
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

  const [newTrip, setNewTrip] = useState(emptyTripForm)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const [duplicatingTripId, setDuplicatingTripId] = useState<string | null>(null)
  const [duplicationError, setDuplicationError] = useState('')
  const duplicationRef = useRef({
    busy: false,
    tripId: '',
    completedAt: 0,
  })

  const [formError, setFormError] = useState('')
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [archivingTripId, setArchivingTripId] = useState<string | null>(null)
  const archiveLock = useRef(false)

  useEffect(() => {
    if (trips?.some((trip) => trip.id === selectedTripId && trip.archived === true)) {
      setSelectedTripId(null)
      setActiveTab('home')
      setShowArchived(false)
    }
  }, [trips, selectedTripId])

const selectedTrip = (trips ?? []).find(
    (item) => item.id === selectedTripId && item.archived !== true,
  ) ?? null

  const isTripOpen = selectedTrip !== null

  function openTrip(tripId: string) {
    setSelectedTripId(tripId)
    setActiveTab('home')
  }

  function closeTrip() {
    setSelectedTripId(null)
    setShowArchived(false)
    setActiveTab('home')
  }

  
function closeCreateTrip() {
  if (savingRef.current) return
  setShowCreateTrip(false)
  setEditingTripId(null)
  setNewTrip({ ...emptyTripForm })
  setFormError('')
}

function openCreateTrip() {
  setEditingTripId(null)
  setNewTrip({ ...emptyTripForm })
  setFormError('')
  setShowCreateTrip(true)
}

function editTrip(trip: Trip) {
  const { id, ...fields } = trip
  setEditingTripId(id)
  setNewTrip(fields)
  setFormError('')
  setShowCreateTrip(true)
}

async function setTripArchived(trip: Trip, archived: boolean) {
  if (archiveLock.current) return
  archiveLock.current = true
  setArchivingTripId(trip.id)
  setArchiveError('')
  try {
    const updated = await db.trips.update(trip.id, { archived })
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
    archiveLock.current = false
    setArchivingTripId(null)
  }
}

async function duplicateTrip(trip: Trip) {
  const operation = duplicationRef.current
  // Also ignore rapid repeat clicks after a very fast IndexedDB write.
  if (operation.busy ||
      (operation.tripId === trip.id && Date.now() - operation.completedAt < 600)) {
    return
  }

  operation.busy = true
  operation.tripId = trip.id
  setDuplicatingTripId(trip.id)
  setDuplicationError('')

  try {
    await db.trips.add({
      id: crypto.randomUUID(),
      destination: `${trip.destination} (copie)`,
      country: trip.country,
      startDate: trip.startDate,
      endDate: trip.endDate,
      travelers: trip.travelers,
      image: trip.image,
      archived: false,
    })
    if (showArchived) {
      setShowArchived(false)
      setSearch('')
    }
  } catch (error) {
    console.error('Erreur de duplication :', error)
    setDuplicationError("Impossible de dupliquer ce voyage. Réessaie dans un instant.")
  } finally {
    operation.busy = false
    operation.completedAt = Date.now()
    setDuplicatingTripId(null)
  }
}

async function saveTrip(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (savingRef.current) return
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

  const fields: Omit<Trip, 'id' | 'archived'> = {
    destination,
    country,
    startDate: newTrip.startDate,
    endDate: newTrip.endDate,
    travelers: newTrip.travelers,
    image: newTrip.image.trim(),
  }

  savingRef.current = true
  setIsSaving(true)

  try {
    if (editingTripId !== null) {
      const updated = await db.trips.update(editingTripId, fields)
      if (updated === 0) {
        setFormError('Ce voyage est introuvable. Ferme le formulaire et actualise la liste.')
        return
      }
    } else {
      await db.trips.add({ ...fields, id: crypto.randomUUID(), archived: false })
      if (showArchived) {
        setShowArchived(false)
        setSearch('')
      }
    }
  } catch (error) {
    console.error('Erreur de sauvegarde :', error)
    setFormError("Impossible d'enregistrer ce voyage. Réessaie.")
    return
  } finally {
    savingRef.current = false
    setIsSaving(false)
  }

  closeCreateTrip()
}


function navigateToTab(tabId: TabId) {
  if (!isTripOpen && tabId !== 'home') {
    return
  }

  setActiveTab(tabId)
}

const [search, setSearch] = useState('')

const archivedCount = (trips ?? []).filter((trip) => trip.archived === true).length
const filteredTrips = (trips ?? [])
  .filter((trip) => (trip.archived === true) === showArchived)
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
      <header className="topbar">
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
              disabled={!isTripOpen && id !== 'home'}
              onClick={() => navigateToTab(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <button
          className="icon-button"
          aria-label="Paramètres (bientôt disponibles)"
          disabled
        >
          <Settings2 size={21} />
        </button>
      </header>

      <main className="main-content">
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
        <p className="eyebrow">MON PROCHAIN VOYAGE</p>
        <h1>{selectedTrip.destination}</h1>
        <p>{formatTripDates(selectedTrip)} · {selectedTrip.travelers} voyageurs</p>
      </div>
    </div>

    <button
      type="button"
      className="back-button"
      disabled={archivingTripId !== null}
      onClick={(event) => {
        event.stopPropagation()
        void setTripArchived(selectedTrip, true)
      }}
    >
      <Archive size={18} />
      {archivingTripId === selectedTrip.id ? 'Archivage…' : 'Archiver ce voyage'}
    </button>

    <h2 className="dashboard-title">Organiser mon voyage</h2>

    <div className="dashboard-grid">
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
          label: 'Préparatifs et plus',
          description: 'Réservations et informations',
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
  </section>
) : activeTab === 'home' ? (
          <>
            <section className="page-heading">
              <div>
                <p className="eyebrow">TES AVENTURES</p>
                <h1>{showArchived ? 'Voyages archivés' : 'Mes voyages'}</h1>
                <p className="subtitle">
                  Organise tes découvertes, à ta façon.
                </p>
              </div>

              <button className="primary-button" onClick={openCreateTrip}>
                <Plus size={19} />
                Nouveau voyage
              </button>
            </section>

            <button
              type="button"
              className="back-button"
              onClick={() => {
                setShowArchived(!showArchived)
                setSearch('')
                setArchiveError('')
                setDuplicationError('')
              }}
            >
              {showArchived ? <ArrowLeft size={18} /> : <Archive size={18} />}
              {showArchived ? 'Mes voyages actifs' : `Voyages archivés (${archivedCount})`}
            </button>

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
                <h2>{showArchived ? 'Mes archives' : 'Mes destinations'}</h2>
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
                      <span className="trip-badge">{showArchived ? 'Archivé' : 'Voyage'}</span>
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
                          <button
                            type="button"
                            className="card-edit"
                            aria-label={`Modifier le voyage ${item.destination}`}
                            title="Modifier le voyage"
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
                            disabled={duplicatingTripId !== null}
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
                            disabled={archivingTripId !== null}
                            aria-busy={archivingTripId === item.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void setTripArchived(item, !showArchived)
                            }}
                          >
                            {showArchived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                          </button>
                          {!showArchived && <button
                            className="card-arrow"
                            aria-label={`Ouvrir le voyage ${item.destination}`}
                            onClick={() => openTrip(item.id)}
                          >
                            <ArrowRight size={20} />
                          </button>}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>


              {filteredTrips.length === 0 && (
                <div className="empty-state">
                  {showArchived && archivedCount === 0
                    ? "Aucun voyage archivé pour l'instant."
                    : 'Aucun voyage ne correspond à ta recherche.'}
                </div>
              )}
            </section>
          </>
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

      <nav className="bottom-nav" aria-label="Navigation mobile">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`bottom-nav-item ${activeTab === id ? 'active' : ''}`}
            aria-current={activeTab === id ? 'page' : undefined}
            disabled={!isTripOpen && id !== 'home'}
            onClick={() => navigateToTab(id)}
          >
            <Icon size={21} strokeWidth={activeTab === id ? 2.4 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      
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
