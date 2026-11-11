const noNativeMapRows=async()=>[]
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Map as LibreMap, MapMouseEvent } from 'maplibre-gl'
import { TripMap } from '../src/components/map/TripMap'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey, transferModes, type ManualTransfer } from '../src/db/transferModel'
import { filterMapActivities } from '../src/maps/tripMapNavigation'
import { tripMapTransfers, transferGeometry, transferFeatures, transferColors, type MapTransfer } from '../src/maps/tripMapTransfers'
import { mountTransferLayer } from '../src/maps/tripTransferLayer'
import { createTripMapController, type TripMapPoint } from '../src/maps/tripMapModel'
import { startTripMap, type TripMapLoader, type TripMapModule } from '../src/maps/tripMapSession'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testTripMapTransfers(report: (message: string) => void) {
  const tripId = 'map-transfer-test'
  const a = { ...timedFixture('a', '09:00', '10:00'), tripId, latitude: 0, longitude: 179 }
  const b = { ...timedFixture('b', '11:00', '12:00'), tripId, latitude: -5, longitude: -179 }
  const base: ManualTransfer = { id: 'link', fromActivityId: a.id, toActivityId: b.id, mode: 'walk', currency: 'EUR', createdAt: stamp, updatedAt: stamp }
  const original = JSON.stringify([base, a, b])
  const links = tripMapTransfers([base], [a, b], tripId)
  assert(links.length === 1 && links[0].geometry.type === 'MultiLineString', 'Liaison valide absente.')
  for (const mode of Object.keys(transferModes) as (keyof typeof transferModes)[]) {
    const link = tripMapTransfers([{ ...base, mode, durationMinutes: 0, estimatedCost: 0 }], [a, b], tripId)[0]
    assert(link.transfer.mode === mode && link.transfer.durationMinutes === 0 && link.transfer.estimatedCost === 0 && transferColors[mode], 'Mode/zéro perdus.')
  }
  assert(links[0].transfer.durationMinutes === undefined && links[0].transfer.estimatedCost === undefined, 'Durée ou coût inventés.')
  const malformed = [
    { ...base, toActivityId: a.id }, { ...base, toActivityId: 'missing' }, { ...base, mode: 'rocket' },
    { ...base, durationMinutes: NaN }, { ...base, estimatedCost: -1 }, { ...base, currency: 'INVALID' },
  ] as ManualTransfer[]
  assert(malformed.every((value) => tripMapTransfers([value], [a, b], tripId).length === 0), 'Liaison invalide dessinée.')
  for (const changed of [
    { ...b, date: '2027-01-01' }, { ...b, date: null }, { ...b, tripId: 'foreign' },
    { ...b, latitude: undefined }, { ...b, longitude: NaN }, { ...b, latitude: 90 },
    { ...b, startTime: '08:00', endTime: '08:30' },
  ]) assert(!tripMapTransfers([base], [a, changed], tripId).length, 'Lien incohérent/GPS invalide accepté.')
  assert(!tripMapTransfers([base], [a, { ...a, id: 'between', startTime: '10:30' }, b], tripId).length, 'Lien non adjacent devenu incohérent affiché.')
  assert(!tripMapTransfers([base, { ...base }], [a, b], tripId).length, 'Identifiant ambigu accepté.')
  const point = (longitude: number, latitude = 0): TripMapPoint => ({ id: 'point', title: 'Point', name: '', longitude, latitude })
  for (const [from, to] of [[179, -179], [-179, 179], [-180, 179]]) {
    const geometry = transferGeometry(point(from, -10), point(to, 10))
    assert(geometry.type === 'MultiLineString' && geometry.coordinates.length === 2, 'Antiméridien non découpé.')
    for (const segment of geometry.coordinates) assert(Math.abs(segment[1][0] - segment[0][0]) <= 180 && segment.every(([lon]) => lon >= -180 && lon <= 180), 'Liaison fait le tour du monde.')
  }
  const atBoundary = transferGeometry(point(179, -10), point(-180, 10))
  assert(atBoundary.type === 'MultiLineString' && atBoundary.coordinates.length === 1 && atBoundary.coordinates[0][1][0] === 180, 'Arrivée exactement à l’antiméridien inutilement prolongée.')
  const same = transferGeometry(point(180), point(-180))
  assert(same.type === 'Point' && same.coordinates[0] === -180, 'Coordonnées identiques/±180 transformées en faux parcours.')
  const sameLinks = tripMapTransfers([base], [a, { ...b, latitude: a.latitude, longitude: a.longitude }], tripId)
  assert(sameLinks[0].geometry.type === 'Point', 'Liaison entre deux activités au même lieu perdue.')
  const features = transferFeatures(links, base.id)
  assert(features.features[0].properties?.selected === true && JSON.stringify([base, a, b]) === original, 'Sélection ou immutabilité incorrectes.')
  assert(!tripMapTransfers([base], filterMapActivities([a, b], tripId, { mode: 'day', selectedDate: '2027-01-01' }), tripId).length, 'Filtre journée ignoré.')

  // Actual layer adapter with a deterministic map surface: no tiles or WebGL.
  const sources = new Map<string, { setData: (data: unknown) => void }>(), layers = new Map<string, unknown>()
  const events = new Map<string, Set<(event: MapMouseEvent) => void>>()
  const canvas = document.createElement('canvas')
  let data: ReturnType<typeof transferFeatures> | undefined, updates = 0, selectedIds: string[] = [], errors = 0
  let queryIds = [base.id, base.id, 'stale']
  const fakeMap = {
    isStyleLoaded: () => false, // style.load fires before network tiles are ready.
    getSource: (id: string) => sources.get(id), getLayer: (id: string) => layers.get(id), getCanvas: () => canvas,
    addSource(id: string, source: { data: typeof data }) { data = source.data; sources.set(id, { setData(value) { data = value as typeof data; updates++ } }) },
    addLayer(layer: { id: string }) { layers.set(layer.id, layer) },
    on(name: string, action: (event: MapMouseEvent) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(action) },
    off(name: string, action: (event: MapMouseEvent) => void) { events.get(name)?.delete(action) },
    queryRenderedFeatures: () => queryIds.map((id) => ({ properties: { id } })),
    fitBounds() { throw new Error('Recentrage interdit depuis la couche.') }, jumpTo() { throw new Error('Caméra modifiée.') },
  } as unknown as LibreMap
  const emit = (name: string) => { for (const action of events.get(name) ?? []) action({ point: { x: 10, y: 20 } } as MapMouseEvent) }
  const layer = mountTransferLayer(fakeMap, (ids) => { selectedIds = ids }, () => { errors++ })
  layer.update(links, base.id)
  assert(sources.size === 0, 'Source créée avant le style.')
  emit('style.load')
  assert(sources.size === 1 && layers.size === 3 && data?.features[0].properties?.selected === true, 'Source/couches non initialisées après style.load sans tuiles.')
  emit('click'); assert(selectedIds.join() === base.id, 'Sélection de liaison dupliquée ou périmée.')
  emit('mousemove'); assert(canvas.style.cursor === 'pointer', 'Liaison non identifiable à la souris.')
  layer.update(sameLinks, null); assert(data?.features[0].geometry.type === 'Point', 'Halo non transmis à MapLibre.')
  sources.clear(); layers.clear(); emit('style.load'); assert(layers.size === 3, 'Couches perdues après rechargement du style.')
  layer.update([], null); selectedIds = []; emit('click')
  assert(data?.features.length === 0 && selectedIds.length === 0, 'Ancienne liaison reste cliquable.')
  queryIds = []; emit('mousemove'); assert(canvas.style.cursor === '', 'Curseur non restauré.')
  const beforeDispose = updates
  layer.dispose(); layer.dispose(); layer.update(links, null); emit('click'); emit('style.load')
  assert(updates === beforeDispose && [...events.values()].every((set) => set.size === 0) && errors === 0, 'Écouteurs ou mises à jour actifs après démontage.')

  const brokenMap = { ...fakeMap, isStyleLoaded: () => true, getSource: () => undefined,
    addSource() { throw new Error('WebGL/source unavailable') } } as unknown as LibreMap
  const brokenLayer = mountTransferLayer(brokenMap, () => { throw new Error('Sélection impossible propagée') }, () => { errors++ })
  brokenLayer.update(links, null)
  assert(Number(errors) === 1, 'Échec de couche masqué sans diagnostic/repli.')
  brokenLayer.dispose()

  // Deferred session buffers the newest links/selection, and rejects late events.
  let resolve!: (module: TripMapModule) => void, received: readonly MapTransfer[] = [], selectedSession: string | null = null
  let clickAfterDispose: ((ids: string[]) => void) | undefined
  const container = document.createElement('div')
  const session = startTripMap(container, [], () => {}, () => new Promise((ready) => { resolve = ready }), 1000, undefined, (ids) => { selectedIds = ids })
  session.transfers?.(links, base.id)
  resolve({ mountTripMap(_container, _points, _notify, _select, onTransferSelect) {
    clickAfterDispose = onTransferSelect
    return { update() {}, recenter() {}, dispose() {}, transfers(next, id) { received = next; selectedSession = id } }
  } })
  await Promise.resolve(); await Promise.resolve()
  assert(received === links && selectedSession === base.id, 'Liaisons/sélection perdues pendant l’import différé.')
  session.dispose(); selectedIds = []; clickAfterDispose?.([base.id]); assert(!selectedIds.length, 'Événement après démontage propagé.')
  report('Liaisons carte pures/adaptateur : 11 modes, GPS, filtres, cohérence du planning, zéro/facultatifs, doublons, ±180°, même point, couches et sélection/cycle de vie différé sans caméra ni mutation.')

  const database = new RoamDatabase(`roam-v2-test-map-transfers-${crypto.randomUUID()}`)
  const repository = createActivityRepository(database), transferRepo = createTransferRepository(database)
  const trip: Trip = { id: tripId, destination: 'Test carte déplacements', country: 'Test', startDate: a.date!, endDate: '2027-01-01', travelers: 1, image: '' }
  const host = document.createElement('div'); host.style.width = '100%'; host.style.maxWidth = '375px'; document.body.append(host)
  const root = createRoot(host)
  const offline = connection.getSnapshot().offline
  let fits = 0, loads = 0, reads = 0, drawn: readonly MapTransfer[] = [], selectedDrawn: string | null = null
  const load: TripMapLoader = async () => ({ mountTripMap(element, initial, notify, onSelect, onTransferSelect) {
    loads++
    const markerBox = document.createElement('div'), transferBox = document.createElement('div')
    element.append(markerBox, transferBox)
    const control = createTripMapController(initial, {
      markers(points) { markerBox.replaceChildren(...points.map((point) => { const button = document.createElement('button'); button.textContent = point.title; button.dataset.marker = point.id; button.onclick = () => onSelect?.([point.id]); return button })) },
      fit() { fits++; notify({ phase: 'ready', interactive: true, message: 'Carte de test prête' }) },
      dispose() { element.replaceChildren() },
    })
    return { ...control, transfers(next, id) { drawn = next; selectedDrawn = id; transferBox.replaceChildren(...next.map((link) => {
      const button = document.createElement('button'); button.textContent = 'Liaison simulée'; button.dataset.link = link.transfer.id
      button.onclick = () => onTransferSelect?.(next.map((item) => item.transfer.id)); return button
    })) } }
  } })
  const read = (id: string) => { reads++; return repository.listActivities(id) }
  function Harness() {
    const liveTrip = useLiveQuery(() => database.trips.get(tripId), [])
    return liveTrip ? <TripMap readJourneys={noNativeMapRows} readAccommodations={noNativeMapRows} trip={liveTrip} readActivities={read} load={load} /> : null
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((ready) => setTimeout(ready, 20)); assert(condition(), 'Carte des déplacements non actualisée.') }
  try {
    window.dispatchEvent(new Event('online'))
    await database.trips.add(trip)
    let first = await repository.createActivity(tripId, a), second = await repository.createActivity(tripId, b)
    let transfer = await transferRepo.saveTransfer(tripId, { fromActivityId: first.id, toActivityId: second.id, mode: 'walk', currency: 'EUR', estimatedCost: 0, durationMinutes: 0, notes: '<script>texte seulement</script>' })
    const overlap = await transferRepo.saveTransfer(tripId, { fromActivityId: first.id, toActivityId: second.id, mode: 'bus', currency: 'JPY' })
    flushSync(() => root.render(<Harness />))
    await wait(() => drawn.length === 2)
    assert(fits === 1 && reads === 1 && host.textContent?.includes('pas des itinéraires routiers'), 'Caméra/requêtes/avertissement initial incorrects.')
    const readsBeforeSelection = reads
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-link]')!.click())
    await wait(() => Boolean(host.querySelector('.trip-transfer-preview')))
    assert(host.querySelectorAll('.trip-transfer-preview fieldset button').length === 2 && selectedDrawn !== null, 'Choix des liaisons superposées absent.')
    assert(host.querySelector('.trip-transfer-preview')?.textContent?.includes('0 min') && host.querySelector('.trip-transfer-preview')?.textContent?.includes('0,00'), 'Zéros durée/coût cachés.')
    assert(!host.querySelector('.trip-transfer-preview script'), 'Notes interprétées comme HTML.')
    assert(reads === readsBeforeSelection, 'Sélection déclenche une lecture supplémentaire.')
    const fitsBefore = fits, loadsBefore = loads
    transfer = await transferRepo.saveTransfer(tripId, { ...transfer, mode: 'train', durationMinutes: 25 }, transfer.id, transferKey(transfer))
    await wait(() => host.querySelector('.trip-transfer-preview h3')?.textContent?.includes('Train') === true)
    assert(fits === fitsBefore && loads === loadsBefore, `Modification de transfert recrée/recentre la carte : fits ${fits}/${fitsBefore}, loads ${loads}/${loadsBefore}.`)
    // listActivities intentionally observes the parent trip, so a trip write
    // legitimately invalidates its existing live query; no second query is added.
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-marker]')!.click())
    assert(host.querySelector('.trip-map-preview[aria-label="Aperçu de l’activité"]') && !host.querySelector('.trip-transfer-preview'), 'Sélection marqueur cassée par les liaisons.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-map-preview .primary-button')!.click())
    flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-label="Fermer la fiche et revenir à la carte"]')!.click())
    assert(fits === fitsBefore && loads === loadsBefore && drawn.length === 2, 'Retour fiche perd les liaisons/caméra.')
    const listButton = host.querySelector<HTMLButtonElement>('.trip-transfer-list button')!
    listButton.focus(); flushSync(() => listButton.click()); await new Promise((ready) => requestAnimationFrame(ready))
    assert(document.activeElement === host.querySelector('.trip-transfer-preview button[aria-label="Fermer l’aperçu du déplacement"]'), 'Focus clavier absent de l’aperçu.')
    flushSync(() => host.querySelector('.trip-transfer-preview')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert(!host.querySelector('.trip-transfer-preview') && document.activeElement === listButton, 'Échap/retour focus cassé.')
    second = await repository.updateActivity(tripId, second.id, { ...second, latitude: first.latitude, longitude: first.longitude })
    await wait(() => drawn.every((link) => link.geometry.type === 'Point'))
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-transfer-list button')!.click())
    assert(host.querySelector('.trip-transfer-preview')?.textContent?.includes('mêmes coordonnées'), 'Liaison au même lieu non expliquée.')
    const select = host.querySelector<HTMLSelectElement>('.trip-map-filters select')!
    flushSync(() => { select.value = 'day'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    const day = host.querySelectorAll<HTMLSelectElement>('.trip-map-filters select')[1]
    flushSync(() => { day.value = '2027-01-01'; day.dispatchEvent(new Event('change', { bubbles: true })) })
    assert(!host.querySelector('.trip-transfer-preview') && host.querySelectorAll('.trip-transfer-list button').length === 0, 'Liaison hors journée visible/sélectionnée.')
    flushSync(() => { day.value = trip.startDate; day.dispatchEvent(new Event('change', { bubbles: true })) })
    await wait(() => host.querySelectorAll('.trip-transfer-list button').length === 2)
    assert(!host.querySelector('.trip-transfer-preview'), 'Sélection hors filtre ressuscitée.')
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-transfer-list button')!.click())
    await transferRepo.deleteTransfer(tripId, transfer.id, transferKey(transfer))
    await wait(() => host.querySelectorAll('.trip-transfer-list button').length === 1)
    assert(!host.querySelector('.trip-transfer-preview'), 'Aperçu conservé après suppression du transfert sélectionné.')
    second = await repository.updateActivity(tripId, second.id, { ...second, date: '2027-01-01' })
    await wait(() => host.querySelectorAll('.trip-transfer-list button').length === 0)
    assert((await database.trips.get(tripId))?.manualTransfers?.length === 1, 'Lien changé de jour supprimé au lieu d’être masqué.')
    second = await repository.updateActivity(tripId, second.id, { ...second, date: trip.startDate })
    await wait(() => host.querySelectorAll('.trip-transfer-list button').length === 1)
    window.dispatchEvent(new Event('offline'))
    await wait(() => !host.querySelector('.trip-map-canvas'))
    flushSync(() => host.querySelector<HTMLButtonElement>('.trip-transfer-list button')!.click())
    assert(host.querySelector('.trip-transfer-preview') && host.scrollWidth <= host.clientWidth + 1 && host.querySelector<HTMLButtonElement>('.trip-transfer-list button')!.getBoundingClientRect().height >= 44, 'Liste hors connexion/tactile/mobile perdue.')
    assert((await database.activities.get(first.id))?.estimatedCost === a.estimatedCost && (await database.trips.get(tripId))?.manualTransfers?.[0].id === overlap.id, 'Montants ou transferts modifiés par l’affichage.')
    report('Liaisons carte UI : clic/choix superposé, mode/durée/coût/zéro, sélection marqueur et fiche/retour, caméra stable, filtres, modifications/suppression réactives, même point, clavier/Échap, offline et largeur 375 px (base isolée, carte simulée).')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
