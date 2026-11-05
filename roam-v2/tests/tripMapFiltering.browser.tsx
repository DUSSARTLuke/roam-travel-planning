import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TripMap } from '../src/components/map/TripMap'
import { TripProgram } from '../src/components/program/TripProgram'
import { initialProgramNavigation, type ProgramNavigation } from '../src/components/program/programNavigation'
import { filterMapActivities, tripMapNavigation, programNavigationFromMap, type TripMapNavigation } from '../src/maps/tripMapNavigation'
import { createTripMapController, type TripMapPoint } from '../src/maps/tripMapModel'
import type { TripMapLoader } from '../src/maps/tripMapSession'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testTripMapFiltering(report: (message: string) => void) {
  const trip: Trip = { id: 'filter-trip', destination: 'Test filtres', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' }
  const firstDay = trip.startDate, secondDay = '2027-01-01', emptyDay = trip.endDate
  const calendar: ProgramNavigation = { mode: 'calendar', selectedDate: firstDay, month: '2026-12' }
  const remembered: TripMapNavigation = { mode: 'day', selectedDate: firstDay }
  assert(tripMapNavigation(trip, remembered, secondDay).selectedDate === secondDay, 'Programme ne transmet pas la date à la carte.')
  const synced = programNavigationFromMap(trip, { mode: 'day', selectedDate: secondDay }, calendar)
  assert(synced.mode === 'calendar' && synced.month === '2027-01' && synced.selectedDate === secondDay, 'Carte altère la présentation du Programme ou oublie le mois.')
  assert(tripMapNavigation(trip, { mode: 'day', selectedDate: '2020-01-01' }).selectedDate === firstDay, 'Date hors séjour conservée.')
  assert(tripMapNavigation(trip).mode === 'all', 'La carte doit proposer le voyage entier par défaut.')
  const base = timedFixture('filter-fixture', '09:00', '10:00')
  const fixtures = [
    { ...base, id: 'one', tripId: trip.id, date: firstDay },
    { ...base, id: 'two', tripId: trip.id, date: secondDay },
    { ...base, id: 'idea', tripId: trip.id, date: null },
    { ...base, id: 'outside', tripId: trip.id, date: '2027-01-03' },
    { ...base, id: 'foreign', tripId: 'foreign', date: firstDay },
  ]
  const unchanged = JSON.stringify(fixtures)
  assert(filterMapActivities(fixtures, trip.id, remembered).map((item) => item.id).join() === 'one', 'Filtre journée/isolation incorrect.')
  assert(filterMapActivities(fixtures, trip.id, { ...remembered, mode: 'all' }).length === 4 && JSON.stringify(fixtures) === unchanged, 'Voyage entier perd idées/hors séjour ou modifie les données.')

  const database = new RoamDatabase(`roam-v2-test-map-filter-${crypto.randomUUID()}`)
  const repo = createActivityRepository(database)
  const host = document.createElement('div'); host.style.width = '100%'; host.style.maxWidth = '375px'; document.body.append(host)
  const root = createRoot(host)
  const offlineBefore = connection.getSnapshot().offline
  let loads = 0, fits = 0, reads = 0, notifications = 0
  let markers: readonly TripMapPoint[] = []
  const load: TripMapLoader = async () => ({ mountTripMap(container, initial, notify, onSelect) {
    loads++
    return createTripMapController(initial, {
      markers(next) { markers = next; container.replaceChildren(...next.map((point) => {
        const button = document.createElement('button'); button.textContent = point.title
        button.onclick = () => onSelect?.([point.id]); return button
      })) },
      fit() { fits++; notify({ phase: 'ready', interactive: true, message: 'Carte filtrée simulée' }) },
      dispose() { container.replaceChildren() },
    })
  } })
  const read = (id: string) => { reads++; return repo.listActivities(id) }
  function Harness() {
    const [tab, setTab] = useState('map')
    const [mapState, setMapState] = useState<TripMapNavigation>()
    const [program, setProgram] = useState(initialProgramNavigation(trip.startDate))
    return <><button data-tab="map" onClick={() => setTab('map')}>Carte</button><button data-tab="program" onClick={() => setTab('program')}>Programme</button>
      {tab === 'map' ? <TripMap trip={trip} readActivities={read} load={load}
        initialNavigation={tripMapNavigation(trip, mapState, program.selectedDate)} onNavigationChange={(state) => {
          notifications++; setMapState(state); setProgram((previous) => programNavigationFromMap(trip, state, previous))
        }} /> : <TripProgram trip={trip} readActivities={read} initialNavigation={program} onNavigationChange={setProgram} />}</>
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Filtre Carte/Programme non actualisé.') }
  const mode = () => host.querySelector<HTMLSelectElement>('.trip-map-filters select')!
  const date = () => host.querySelectorAll<HTMLSelectElement>('.trip-map-filters select')[1]!
  const change = (select: HTMLSelectElement, value: string) => flushSync(() => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  const tab = (name: string) => flushSync(() => host.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)!.click())
  try {
    window.dispatchEvent(new Event('online'))
    await database.trips.add(trip)
    const a = await repo.createActivity(trip.id, { ...base, title: 'Premier lieu', date: firstDay, latitude: 0, longitude: 0 })
    await repo.createActivity(trip.id, { ...base, title: 'Sans GPS du premier jour', date: firstDay })
    let b = await repo.createActivity(trip.id, { ...base, title: 'Deuxième lieu', date: secondDay, latitude: 0, longitude: 0 })
    await repo.createActivity(trip.id, { ...base, title: 'Idée sans date', date: null })
    await repo.createActivity(trip.id, { ...base, title: 'Hors séjour', date: '2027-01-03', latitude: -20, longitude: -179 })
    flushSync(() => root.render(<Harness />))
    await wait(() => markers.length === 3)
    assert(host.querySelectorAll('.trip-map-places li').length === 5 && reads === 1 && fits === 1 && notifications === 0, 'Initialisation voyage entier ou absence de boucle incorrecte.')
    change(mode(), 'day')
    await wait(() => markers.length === 1)
    assert(host.querySelectorAll('.trip-map-places li').length === 2 && host.textContent?.includes('1 sans GPS valide') && Number(fits) === 2 && Number(reads) === 1, 'Filtre journée, compteurs, recentrage ou requête incorrects.')
    const notificationsAfterMode = notifications
    change(mode(), 'day')
    assert(notifications === notificationsAfterMode && Number(fits) === 2, 'Même filtre redéclenche synchronisation ou recentrage.')
    assert(date().options.length === 3 && date().options[1].value === secondDay, 'Dates inclusives décembre/janvier incorrectes.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-canvas button')!.click())
    assert(host.querySelector('.trip-map-preview h2')?.textContent === a.title, 'Sélection filtrée absente.')
    change(date(), secondDay)
    await wait(() => markers[0]?.id === b.id)
    assert(!host.querySelector('.trip-map-preview') && host.querySelectorAll('.trip-map-places li').length === 1 && Number(fits) === 3, 'Aperçu hors filtre conservé ou changement de date sans recentrage.')
    const fitsBefore = fits, loadsBefore = loads
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-place-select')!.click())
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-preview .primary-button')!.click())
    assert(host.querySelector('dialog[open]'), 'Fiche non ouverte dans la journée filtrée.')
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="Fermer la fiche et revenir à la carte"]')!.click())
    assert(date().value === secondDay && fits === fitsBefore && loads === loadsBefore, 'Retour fiche perd filtre/caméra.')
    b = await repo.updateActivity(trip.id, b.id, { ...b, title: 'Deuxième lieu modifié' })
    await wait(() => host.querySelector('.trip-map-preview h2')?.textContent === 'Deuxième lieu modifié')
    assert(fits === fitsBefore, 'Une mise à jour réactive recentre la carte.')
    b = await repo.updateActivity(trip.id, b.id, { ...b, date: firstDay })
    await wait(() => host.textContent?.includes('Aucune activité pour cette journée') === true)
    assert(!host.querySelector('.trip-map-preview') && host.querySelectorAll('.trip-map-places li').length === 0, 'Activité déplacée reste sélectionnée/visible.')
    change(date(), emptyDay)
    assert(host.textContent?.includes('Aucune activité pour cette journée'), 'Journée vide sans état explicite.')
    change(date(), firstDay)
    await wait(() => markers.length === 2 && Boolean(host.querySelector('.trip-map-canvas')))
    const fitsBeforeGpsChange = fits
    await repo.updateActivity(trip.id, a.id, { ...a, latitude: undefined, longitude: undefined })
    await wait(() => markers.length === 1)
    assert(fits === fitsBeforeGpsChange, 'La perte du GPS d’une activité recentre les autres marqueurs.')
    b = await repo.updateActivity(trip.id, b.id, { ...b, latitude: undefined, longitude: undefined })
    await wait(() => host.textContent?.includes('Aucun lieu géolocalisé pour cette journée') === true)
    assert(host.querySelectorAll('.trip-map-places li').length === 3 && host.textContent?.includes('3 sans GPS valide'), 'Journée sans GPS perd les activités ou compteurs.')
    tab('program')
    await wait(() => Boolean(host.querySelector('.program-day-chip[aria-pressed="true"]')))
    assert(host.querySelector('.program-day-chip[aria-pressed="true"]')?.getAttribute('aria-label')?.includes('31'), 'Carte ne transmet pas le jour au Programme.')
    const chips = host.querySelectorAll<HTMLButtonElement>('.program-day-chip')
    flushSync(() => chips[1].click())
    const beforeReturn = notifications
    tab('map')
    await wait(() => Boolean(host.querySelector('.trip-map-filters')))
    assert(mode().value === 'day' && date().value === secondDay && notifications === beforeReturn, 'Programme ne synchronise pas la date, filtre perdu ou boucle de notifications.')
    change(mode(), 'all')
    await wait(() => host.querySelectorAll('.trip-map-places li').length === 5)
    assert(host.textContent?.includes('Idée sans date') && host.textContent.includes('Hors séjour'), 'Retour voyage entier incomplet.')
    window.dispatchEvent(new Event('offline'))
    change(mode(), 'day'); change(date(), firstDay)
    await wait(() => host.querySelectorAll('.trip-map-places li').length === 3)
    assert(!host.querySelector('.trip-map-canvas') && host.scrollWidth <= host.clientWidth + 1, 'Filtre hors connexion ou largeur mobile incorrects.')
    assert(mode().getBoundingClientRect().height >= 44 && date().getBoundingClientRect().height >= 44, 'Contrôles non tactiles.')
    mode().focus(); assert(document.activeElement === mode() && mode().labels?.length === 1 && date().labels?.length === 1, 'Contrôles clavier/libellés inaccessibles.')
    report('Carte filtrée : voyage entier/journée, dates décembre/janvier, GPS/zéro/absents, compteurs, sélection invalidée, recentrage volontaire seulement, fiche/retour, synchronisation Programme sans boucle, hors connexion et mobile 375 px.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(offlineBefore ? 'offline' : 'online')) }
}
