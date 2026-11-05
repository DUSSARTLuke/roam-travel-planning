import appStyles from '../src/App.css?inline'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TripMap } from '../src/components/map/TripMap'
import type { Trip } from '../src/db/database'
import type { ManualTransfer } from '../src/db/transferModel'
import { connection } from '../src/pwa/connection'
import { tripMapNavigation, type TripMapNavigation } from '../src/maps/tripMapNavigation'
import { initialMapView, validMapCamera, tripMapInteractionOptions, type TripMapView, type TripMapCamera } from '../src/maps/tripMapView'
import { createTripMapController } from '../src/maps/tripMapModel'
import type { TripMapLoader, TripMapState } from '../src/maps/tripMapSession'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const settle = async () => { await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise((resolve) => setTimeout(resolve, 30)) }
export async function testTripMapMobile(report: (message: string) => void) {
  const camera: TripMapCamera = { longitude: 181, latitude: -5, zoom: 7 }
  assert(validMapCamera(camera) && !validMapCamera({ ...camera, latitude: NaN }) && !validMapCamera({ ...camera, zoom: Infinity }), 'Caméra invalide admise.')
  const nav: TripMapNavigation = { mode: 'day', selectedDate: '2026-12-31' }
  const original: TripMapView = { filterKey: 'day:2026-12-31', camera, expanded: true, selection: ['a'], transferSelection: [] }
  const saved = initialMapView(nav, original)
  assert(saved.camera?.longitude === 181 && saved.selection[0] === 'a' && saved.selection !== original.selection, 'Instantané de vue non indépendant.')
  const changed = initialMapView({ ...nav, selectedDate: '2027-01-01' }, original)
  assert(!changed.camera && !changed.selection.length, 'Caméra/sélection restaurées sur un autre filtre.')
  for (const ratio of [0, 1, 2, 3, NaN]) {
    const options = tripMapInteractionOptions(ratio)
    assert(options.pixelRatio >= 1 && options.pixelRatio <= 2 && options.cooperativeGestures && !options.scrollZoom && !options.doubleClickZoom && !options.dragRotate && options.maxTileCacheSize === 32 && options.cancelPendingTileRequestsWhileZooming, 'Politique tactile/GPU/requêtes incorrecte.')
  }
  let pureFits = 0
  const restoredController = createTripMapController([], { markers() {}, fit() { pureFits++ }, dispose() {} }, false)
  restoredController.update([]); assert(pureFits === 0, 'Caméra restaurée écrasée par le cadrage initial/actualisation.')
  restoredController.recenter(); assert(Number(pureFits) === 1, 'Recentrage explicite ignoré après restauration.'); restoredController.dispose()

  const trip: Trip = { id: 'mobile-view', destination: 'Voyage mobile', country: 'Test', startDate: nav.selectedDate, endDate: '2027-01-01', travelers: 1, image: '' }
  const fixture = [
    { ...timedFixture('mobile-a', '09:00', '10:00'), tripId: trip.id, title: 'Lieu très long avec une adresse à consulter sur un petit téléphone', latitude: 0, longitude: 179 },
    { ...timedFixture('mobile-b', '11:00', '12:00'), tripId: trip.id, latitude: -5, longitude: -179 },
  ]
  const transfer: ManualTransfer = { id: 'mobile-transfer', fromActivityId: fixture[0].id, toActivityId: fixture[1].id, mode: 'bus', currency: 'EUR', durationMinutes: 15, createdAt: fixture[0].createdAt, updatedAt: fixture[0].updatedAt }
  trip.manualTransfers = [transfer]
  const style = document.createElement('style'); style.textContent = appStyles; document.head.append(style)
  const host = document.createElement('div'); host.style.maxWidth = '100%'; document.body.append(host)
  const root = createRoot(host)
  const offline = connection.getSnapshot().offline
  let loads = 0, mounts = 0, disposed = 0, fits = 0, resizes = 0, reads = 0
  let currentCamera = camera, lastInitial: TripMapCamera | undefined, lastView: TripMapView | undefined
  let notify!: (state: TripMapState) => void
  let move!: (next: TripMapCamera) => void
  const loader: TripMapLoader = async () => {
    loads++
    return { mountTripMap(container, points, reportState, select, selectTransfer, options) {
      mounts++; notify = reportState; lastInitial = options?.camera
      currentCamera = options?.camera ?? { longitude: 0, latitude: 0, zoom: 1 }
      move = (next) => { currentCamera = next; options?.onCameraChange?.(next) }
      const markerBox = document.createElement('div'), transferBox = document.createElement('div')
      container.append(markerBox, transferBox)
      const controller = createTripMapController(points, {
        markers(next) { markerBox.replaceChildren(...next.map((point) => { const button = document.createElement('button'); button.dataset.marker = point.id; button.textContent = point.title; button.onclick = () => select?.([point.id]); return button })) },
        fit() { fits++; move({ longitude: 179, latitude: 0, zoom: 9 }) },
        dispose() { options?.onCameraChange?.(currentCamera); disposed++; container.replaceChildren() },
      }, !options?.camera)
      reportState({ phase: 'ready', interactive: true, message: 'Carte mobile simulée' })
      return { ...controller, resize() { resizes++ }, transfers(links) {
        transferBox.replaceChildren(...links.map((link) => { const button = document.createElement('button'); button.dataset.link = link.transfer.id; button.textContent = 'Liaison'; button.onclick = () => selectTransfer?.([link.transfer.id]); return button }))
      } }
    } }
  }
  const read = async () => { reads++; return fixture }
  function Harness() {
    const [tab, setTab] = useState(true), [view, setView] = useState<TripMapView>(), [navigation, setNavigation] = useState<TripMapNavigation>(() => tripMapNavigation(trip))
    return <div className="app-shell"><header className="topbar"><span>ROAM</span><button type="button" data-tab onClick={() => setTab((value) => !value)}>Changer d’onglet</button></header>
      <main className="main-content">{tab ? <TripMap trip={trip} load={loader} readActivities={read} initialNavigation={navigation} onNavigationChange={setNavigation} initialView={view} onViewChange={(next) => { lastView = next; setView(next) }} /> : <p>Autre onglet</p>}</main>
      <nav className="bottom-nav" aria-label="Navigation mobile test">{['Accueil', 'Programme', 'Carte', 'Budget', 'Plus'].map((label) => <button type="button" key={label} className="bottom-nav-item" onClick={() => setTab(label === 'Carte')}><span aria-hidden="true">●</span><span>{label}</span></button>)}</nav>
    </div>
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Vue carte mobile non actualisée.') }
  const click = (selector: string) => flushSync(() => host.querySelector<HTMLButtonElement>(selector)!.click())
  try {
    window.dispatchEvent(new Event('offline'))
    host.style.width = '320px'
    flushSync(() => root.render(<Harness />))
    await wait(() => Boolean(host.querySelector('.trip-transfer-list')))
    assert(loads === 0 && !host.querySelector('.trip-map-canvas') && host.querySelectorAll('.trip-map-places li').length === 2 && host.querySelectorAll('.trip-transfer-list button').length === 1, 'Ouverture offline charge MapLibre ou masque les listes.')
    click('.trip-map-place-select'); assert(host.querySelector('.trip-map-preview[aria-label="Aperçu de l’activité"]'), 'Aperçu offline inaccessible.')
    window.dispatchEvent(new Event('online'))
    await wait(() => mounts === 1)
    assert(lastView?.selection[0] === fixture[0].id && fits === 1, 'Retour réseau perd la sélection.')
    for (const width of [320, 375, 1100]) {
      host.style.width = `${width}px`
      await settle()
      const surface = host.querySelector<HTMLElement>('.trip-map-surface')!, canvas = host.querySelector<HTMLElement>('.trip-map-canvas')!
      const normalHeight = canvas.getBoundingClientRect().height
      const before = { mounts, fits, reads, resizes }
      click('button[aria-label="Agrandir la carte"]'); await settle()
      assert(surface.classList.contains('is-expanded') && host.querySelector('button[aria-label="Réduire la carte"]')?.getAttribute('aria-pressed') === 'true', 'Agrandissement non explicite/accessibilité perdue.')
      assert(canvas === host.querySelector('.trip-map-canvas') && mounts === before.mounts && fits === before.fits && reads === before.reads && resizes > before.resizes, 'Agrandissement recrée/recentre/relit la carte.')
      assert(host.scrollWidth <= host.clientWidth + 1 && canvas.getBoundingClientRect().width > 180, `Débordement/largeur illisible : ${width}.`)
      assert(canvas.getBoundingClientRect().height >= normalHeight || innerHeight < 700, 'Mode agrandi plus petit sans contrainte de hauteur.')
      const attribution = host.querySelector<HTMLElement>('.trip-map-canvas-attribution')!.getBoundingClientRect(), bounds = canvas.getBoundingClientRect()
      assert(attribution.top >= bounds.top && attribution.bottom <= bounds.bottom && attribution.width <= bounds.width, 'Attribution masquée/hors carte.')
      const navigation = host.querySelector<HTMLElement>('.bottom-nav')!
      if (getComputedStyle(navigation).display !== 'none') assert(bounds.bottom <= navigation.getBoundingClientRect().top + 2, `Carte agrandie masquée sous la navigation mobile : largeur ${width}, carte bas=${bounds.bottom}, nav haut=${navigation.getBoundingClientRect().top}, viewport=${innerWidth}x${innerHeight}.`)
      flushSync(() => surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
      assert(!surface.classList.contains('is-expanded') && document.activeElement === host.querySelector('button[aria-label="Agrandir la carte"]'), 'Échap/focus du mode agrandi incorrects.')
    }
    host.style.width = '320px'; await settle()
    flushSync(() => move(camera))
    click('[data-marker]')
    click('.trip-map-preview .primary-button')
    const beforeDetail = { mounts, fits }
    click('button[aria-label="Fermer la fiche et revenir à la carte"]')
    assert(mounts === beforeDetail.mounts && fits === beforeDetail.fits && currentCamera.longitude === camera.longitude, 'Fiche/retour modifie la caméra.')
    click('.trip-map-return')
    assert(document.activeElement === host.querySelector('.trip-map-anchor'), 'Retour carte sans focus accessible.')
    click('[data-tab]'); await settle()
    const beforeTab = fits
    assert(disposed === 1 && !host.querySelector('.trip-map-canvas'), 'Carte cachée conservée en arrière-plan.')
    click('[data-tab]'); await wait(() => mounts === 2)
    assert(lastInitial?.longitude === camera.longitude && lastInitial.zoom === camera.zoom && fits === beforeTab && host.querySelector('.trip-map-preview[aria-label="Aperçu de l’activité"]'), 'Onglets perdent caméra/sélection.')
    click('[data-link]'); await settle()
    click('[data-tab]'); click('[data-tab]'); await wait(() => mounts === 3)
    assert(host.querySelector('.trip-transfer-preview') && lastView?.transferSelection[0] === transfer.id, 'Sélection transfert perdue entre onglets.')
    flushSync(() => notify({ phase: 'error', interactive: true, message: 'Tuiles indisponibles simulées. Les données locales restent accessibles.' }))
    assert(host.querySelectorAll('.trip-map-places li').length === 2 && host.querySelectorAll('.trip-transfer-list button').length === 1 && host.textContent?.includes('Tuiles indisponibles'), 'Erreur tuiles bloque les données.')
    const beforeRetry = fits
    click('button[aria-label="Réessayer la carte"]')
    await wait(() => mounts === 4)
    assert(fits === beforeRetry && lastInitial?.zoom === camera.zoom, 'Réessai explicite perd la caméra.')
    window.dispatchEvent(new Event('offline')); await wait(() => !host.querySelector('.trip-map-canvas'))
    const beforeOffline = loads
    window.dispatchEvent(new Event('offline')); await settle()
    assert(loads === beforeOffline && host.querySelector('.trip-transfer-preview'), 'Offline répété recharge ou perd les sélections.')
    window.dispatchEvent(new Event('online')); await wait(() => mounts === 5)
    assert(fits === beforeRetry && lastInitial?.longitude === camera.longitude, 'Reconnexion recentre la caméra mémorisée.')
    const mode = host.querySelector<HTMLSelectElement>('.trip-map-filters select')!
    flushSync(() => { mode.value = 'day'; mode.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle(); assert(fits === beforeRetry + 1 && !host.querySelector('.trip-transfer-preview'), 'Filtre volontaire ne cadre pas ou conserve la sélection.')
    report('Carte mobile : géométrie 320/375/desktop, agrandir/réduire/Échap sans remontage, navigation et attribution visibles, caméra/sélections par onglet, retour fiche, erreur/retry, offline sans import puis reconnexion et filtres ; gestes/GPU coopératifs configurés, aucun stockage modifié.')
  } finally { flushSync(() => root.unmount()); host.remove(); style.remove(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
