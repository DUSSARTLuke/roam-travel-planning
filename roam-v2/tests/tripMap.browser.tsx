const noNativeMapRows=async()=>[]
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TripMap } from '../src/components/map/TripMap'
import { tripMapPoints, drawablePoints, tripMapBounds, coordinateKey, displayedLongitude, createTripMapController, type TripMapPoint } from '../src/maps/tripMapModel'
import { startTripMap, type TripMapLoader, type TripMapModule, type TripMapState } from '../src/maps/tripMapSession'
import { createActivityRepository } from '../src/db/activities'
import { RoamDatabase, type Trip } from '../src/db/database'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); flushSync(() => {}) }
export async function testTripMap(report: (message: string) => void) {
  const base = timedFixture('map-a', '09:00', '10:00')
  const valid = { ...base, latitude: 0, longitude: 0 }
  const input = [valid, { ...valid, id: 'negative', latitude: -33, longitude: -179 }, { ...base, id: 'none' },
    { ...valid, id: 'invalid', latitude: 91 }, { ...valid, id: 'foreign', tripId: 'other' },
    { ...valid, id: 'null', latitude: null } as unknown as typeof valid]
  const before = JSON.stringify(input)
  const points = tripMapPoints(input, base.tripId)
  assert(points.length === 2 && points[0].latitude === 0 && points[1].longitude === -179 && JSON.stringify(input) === before, 'GPS zéro/négatif/invalide/null ou isolation incorrects.')
  assert(tripMapBounds([]) === null, 'Cadrage inventé sans point.')
  assert(JSON.stringify(tripMapBounds([points[0]])) === '[[0,0],[0,0]]', 'Cadrage point unique incorrect.')
  const east: TripMapPoint = { ...points[0], longitude: 179, latitude: -5 }
  const west: TripMapPoint = { ...points[0], id: 'west', longitude: -179, latitude: 5 }
  const bounds = tripMapBounds([east, west])!
  assert(bounds[1][0] - bounds[0][0] === 2 && bounds[0][1] === -5 && bounds[1][1] === 5, 'Antiméridien cadré sur le grand arc.')
  assert(displayedLongitude(west, bounds[0][0]) === 181, 'Longitude affichée non déroulée autour de ±180.')
  const wide = [0, 120, -120].map((longitude, index) => ({ ...east, id: `wide-${index}`, longitude }))
  const wideBounds = tripMapBounds(wide)!
  assert(wide.every((point) => { const longitude = displayedLongitude(point, wideBounds[0][0]); return longitude >= wideBounds[0][0] && longitude <= wideBounds[1][0] }), 'Cadrage étendu ne contient pas tous les points.')
  assert(coordinateKey({ ...east, longitude: 180 }) === coordinateKey({ ...east, longitude: -180 }), '±180 ne désignent pas le même point.')
  assert(tripMapBounds([east, { ...east, id: 'duplicate' }])![0][0] === 179, 'Coordonnées identiques mal cadrées.')
  assert(drawablePoints([{ ...east, latitude: 90 }, east]).length === 1, 'Pôle projeté en fausse position Mercator.')
  let fits = 0; let markerUpdates = 0; let disposals = 0; let last: readonly TripMapPoint[] = []
  const controller = createTripMapController(points, { markers(next) { markerUpdates++; last = next }, fit() { fits++ }, dispose() { disposals++ } })
  controller.update([east, west]); assert(fits === 1 && markerUpdates === 2 && last[1] === west, 'Une actualisation recentre automatiquement.')
  controller.recenter(); assert(Number(fits) === 2, 'Recentrage explicite ignoré.')
  controller.dispose(); controller.dispose(); controller.update(points); controller.recenter()
  assert(disposals === 1 && Number(fits) === 2, 'Contrôleur actif après démontage.')
  let resolve!: (module: TripMapModule) => void; let mounts = 0; let cleaned = 0
  const states: TripMapState[] = []
  const dummy = { replaceChildren() { cleaned++ } } as unknown as HTMLElement
  const module: TripMapModule = { mountTripMap(_container, initial, notify) { mounts++; last = initial; notify({ phase: 'ready', interactive: true, message: 'OK' }); return { update(next) { last = next }, recenter() { notify({ phase: 'ready', interactive: true, message: 'OK' }) }, dispose() { disposals++ } } } }
  const session = startTripMap(dummy, points, (state) => states.push(state), () => new Promise((ready) => { resolve = ready }))
  session.update([east, west]); resolve(module); await settle()
  assert(mounts === 1 && last[0] === east && states.at(-1)?.interactive, 'Import différé utilise un ancien état.')
  session.dispose()
  let late!: (module: TripMapModule) => void
  const closed = startTripMap(dummy, points, () => {}, () => new Promise((ready) => { late = ready }))
  closed.dispose(); late(module); await settle(); assert(Number(mounts) === 1, 'Montage après fermeture.')
  const error = startTripMap(dummy, points, (state) => states.push(state), async () => { throw new Error('Import') })
  await settle(); assert(states.at(-1)?.phase === 'error', 'Erreur de chargement masquée.'); error.dispose()
  const glFailure = startTripMap(dummy, points, (state) => states.push(state), async () => ({ mountTripMap() { throw new Error('WebGL') } }))
  await settle(); assert(cleaned === 1 && states.at(-1)?.phase === 'error', 'Échec WebGL non signalé/nettoyé.'); glFailure.dispose()
  const timeout = startTripMap(dummy, points, (state) => states.push(state), async () => ({ mountTripMap() { return { update() {}, recenter() {}, dispose() { cleaned++ } } } }), 1)
  await new Promise((ready) => setTimeout(ready, 10)); assert(states.at(-1)?.phase === 'error' && Number(cleaned) === 2, 'Timeout cartographique absent.'); timeout.dispose()
  report('Carte globale pure : GPS/absence/null/zéro/négatifs, isolement, doublons/±180, arc minimal, caméra initiale/explicite et cycle de vie différé/erreurs/timeout.')

  const previousOffline = connection.getSnapshot().offline
  const database = new RoamDatabase(`roam-v2-test-trip-map-${crypto.randomUUID()}`)
  const repo = createActivityRepository(database)
  const trip: Trip = { id: 'trip-map-test', destination: 'Carte test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 1, image: '' }
  const other = { ...trip, id: 'other-map-trip' }
  const host = document.createElement('div'); host.style.width = '100%'; host.style.maxWidth = '375px'; document.body.append(host)
  const root = createRoot(host)
  let loads = 0; let rendererDisposals = 0; let cameraFits = 0; let reads = 0
  let notify!: (state: TripMapState) => void
  const markerSnapshots: (readonly TripMapPoint[])[] = []
  const load: TripMapLoader = async () => { loads++; return { mountTripMap(container, initial, reportState, onSelect) {
    notify = reportState
    return createTripMapController(initial, {
      markers(next) { markerSnapshots.push(next); container.replaceChildren(...next.map((point) => { const button = document.createElement('button'); button.textContent = point.title; button.setAttribute('aria-label', point.title); button.onclick = () => onSelect?.(next.filter((item) => coordinateKey(item) === coordinateKey(point)).map((item) => item.id)); return button })) },
      fit() { cameraFits++; reportState({ phase: 'ready', interactive: true, message: 'Carte simulée prête' }) },
      dispose() { rendererDisposals++; container.replaceChildren() },
    })
  } } }
  const read = (tripId: string) => { reads++; return repo.listActivities(tripId) }
  const render = (selected = trip) => flushSync(() => root.render(<TripMap readJourneys={noNativeMapRows} readAccommodations={noNativeMapRows} trip={selected} readActivities={read} load={load} />))
  const waitFor = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((ready) => setTimeout(ready, 20)); assert(condition(), 'Carte globale non actualisée.') }
  try {
    flushSync(() => window.dispatchEvent(new Event('online')))
    await database.trips.bulkAdd([trip, other])
    render(); await waitFor(() => host.textContent?.includes('Aucun lieu géolocalisé') === true)
    assert(loads === 0 && reads === 1, 'MapLibre chargé sans GPS ou lectures redondantes.')
    await repo.createActivity(trip.id, { ...base, title: 'Sans GPS', location: 'Lieu hors carte' })
    await waitFor(() => host.textContent?.includes('1 sans GPS valide') === true)
    const first = await repo.createActivity(trip.id, { ...valid, title: 'Point zéro', location: 'Lieu zéro', address: 'Adresse test' })
    await waitFor(() => markerSnapshots.at(-1)?.length === 1)
    assert(loads === 1 && cameraFits === 1 && host.textContent?.includes('1 activité avec GPS'), 'Carte/compteurs initiaux incorrects.')
    const duplicate = await repo.createActivity(trip.id, { ...valid, title: 'Même point' })
    await waitFor(() => markerSnapshots.at(-1)?.length === 2)
    assert(Number(cameraFits) === 1 && markerSnapshots.at(-1)?.[0].longitude === 0, 'Ajout au même point a recentré ou déplacé les GPS.')
    const marker = host.querySelector<HTMLButtonElement>('.trip-map-canvas button')!
    flushSync(() => marker.click())
    await waitFor(() => Boolean(host.querySelector('.trip-map-preview')))
    assert(host.querySelectorAll('.trip-map-preview fieldset button').length === 2, 'Choix des coordonnées identiques absent.')
    const chooseDuplicate = [...host.querySelectorAll<HTMLButtonElement>('.trip-map-preview fieldset button')].find((button) => button.textContent === 'Même point')!
    flushSync(() => chooseDuplicate.click())
    assert(host.querySelector('.trip-map-preview h2')?.textContent === 'Même point', 'Choix du doublon ignoré.')
    const listFirst = [...host.querySelectorAll<HTMLButtonElement>('.trip-map-place-select')].find((button) => button.textContent === 'Point zéro')!
    flushSync(() => listFirst.click())
    assert(listFirst.getAttribute('aria-pressed') === 'true' && host.querySelector('.trip-map-preview')?.textContent?.includes('Adresse test'), 'Liste et aperçu non synchronisés.')
    const openDetail = host.querySelector<HTMLButtonElement>('.trip-map-preview .primary-button')!
    openDetail.focus()
    flushSync(() => openDetail.click())
    assert(host.querySelector('dialog[open] #activity-detail-title')?.textContent === 'Point zéro', 'Fiche non ouverte depuis la carte.')
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="Fermer la fiche et revenir à la carte"]')!.click())
    assert(!host.querySelector('dialog[open]') && Number(cameraFits) === 1 && Number(loads) === 1 && document.activeElement === openDetail, 'Retour fiche perd la caméra/le focus ou remonte la carte.')
    await repo.updateActivity(trip.id, first.id, { ...first, latitude: -20, longitude: 179, title: 'Lieu déplacé' })
    await waitFor(() => markerSnapshots.at(-1)?.some((point) => point.title === 'Lieu déplacé' && point.latitude === -20) === true)
    assert(Number(cameraFits) === 1 && Number(loads) === 1, 'Modification recrée/recentre la carte.')
    assert(host.querySelector('.trip-map-preview h2')?.textContent === 'Lieu déplacé', 'Aperçu obsolète après modification.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-preview button[aria-label="Fermer l’aperçu"]')!.click())
    assert(!host.querySelector('.trip-map-preview'), 'Sélection impossible à fermer.')
    const selectFromList = host.querySelector<HTMLButtonElement>('.trip-map-place-select')!
    selectFromList.focus()
    flushSync(() => selectFromList.click())
    await new Promise((resolve) => requestAnimationFrame(resolve))
    assert(document.activeElement === host.querySelector('.trip-map-preview .primary-button'), 'Focus clavier absent de l’aperçu.')
    flushSync(() => host.querySelector('.trip-map-preview')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert(!host.querySelector('.trip-map-preview') && document.activeElement === selectFromList, 'Échap ne ferme pas ou ne restaure pas le focus.')
    const recenter = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Recentrer'))!
    recenter.focus(); assert(document.activeElement === recenter && recenter.getBoundingClientRect().height >= 44, 'Recentrage non accessible/tactile.')
    flushSync(() => recenter.click()); assert(Number(cameraFits) === 2, 'Bouton Recentrer sans effet.')
    await repo.deleteActivity(trip.id, duplicate.id)
    await waitFor(() => markerSnapshots.at(-1)?.length === 1)
    assert(Number(cameraFits) === 2, 'Suppression recentre la carte.')
    flushSync(() => notify({ phase: 'error', interactive: true, message: 'Tuiles indisponibles simulées' }))
    assert(host.textContent?.includes('Tuiles indisponibles') && host.textContent.includes('Lieu déplacé'), 'Erreur de tuiles masque les données.')
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Réessayer la carte')!.click())
    await waitFor(() => Number(loads) === 2); assert(rendererDisposals === 1, 'Retry sans nettoyage.')
    flushSync(() => window.dispatchEvent(new Event('offline')))
    await waitFor(() => host.textContent?.includes('Carte indisponible hors connexion') === true)
    assert(host.textContent?.includes('Adresse test') && host.textContent.includes('Lieu hors carte') && Number(rendererDisposals) === 2, 'Liste/repli offline perdus.')
    const beforeOfflineLoads = loads
    render(); await settle(); assert(loads === beforeOfflineLoads && !host.querySelector('.trip-map-canvas'), 'Import MapLibre hors connexion.')
    flushSync(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => Number(loads) === beforeOfflineLoads + 1)
    const otherActivity = await repo.createActivity(other.id, { ...valid, title: 'Autre voyage isolé' })
    render(other)
    await waitFor(() => host.textContent?.includes('Autre voyage isolé') === true)
    assert(!host.textContent?.includes('Lieu déplacé') && markerSnapshots.at(-1)?.every((point) => point.title === 'Autre voyage isolé'), 'Ancien voyage affiché après changement.')
    assert(host.querySelector('a[href="https://www.openstreetmap.org/copyright"]') && host.scrollWidth <= host.clientWidth + 1, 'Attribution absente ou débordement mobile.')
    await repo.updateActivity(other.id, otherActivity.id, { ...otherActivity, latitude: 90, longitude: 0 })
    await waitFor(() => host.textContent?.includes('coordonnées polaires') === true)
    assert(host.textContent?.includes('1 activité avec GPS') && host.textContent.includes('GPS : 90 ; 0') && !host.querySelector('.trip-map-canvas'), 'Pôle compté ou conservé incorrectement.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-place-select')!.click())
    assert(host.querySelector('.trip-map-preview'), 'Sélection hors fond Mercator inaccessible.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-preview .primary-button')!.click())
    assert(host.querySelector('dialog[open]'), 'Fiche avant suppression absente.')
    await repo.deleteActivity(other.id, otherActivity.id)
    await waitFor(() => host.textContent?.includes('Aucun lieu géolocalisé') === true)
    assert(!host.querySelector('.trip-map-preview') && !host.querySelector('.trip-map-canvas') && host.textContent?.includes('Aucune activité enregistrée'), 'Carte conservée après suppression du dernier point.')
    assert(!host.querySelector('dialog[open]'), 'Fiche conservée après suppression de l’activité sélectionnée.')
    report('Carte globale UI : sélection marqueur/liste, doublons, fiche/retour caméra et focus, Échap, suppression sélectionnée ; requête unique, marqueurs réactifs ajout/modification/suppression, doublons, compteur, caméra préservée/recentrage, erreurs/retry, offline, isolation et mobile (moteur simulé).')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(previousOffline ? 'offline' : 'online')) }
}
