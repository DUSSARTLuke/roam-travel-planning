import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { ActivityMapPreview } from '../src/components/program/ActivityMapPreview'
import { connection } from '../src/pwa/connection'
import type { MapPoint } from '../src/maps/mapPoint'
import type { MapPreviewLoader, MapPreviewState } from '../src/maps/previewSession'
import type { TripActivity } from '../src/db/activityModel'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); flushSync(() => {}) }
export async function testMapPreviewUI(report: (message: string) => void) {
  const previousOffline = connection.getSnapshot().offline
  const previousFocus = document.activeElement
  window.dispatchEvent(new Event('online'))
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const base: TripActivity = { id: 'map-test', tripId: 'map-trip', title: 'Test', category: 'visit', date: null,
    scheduleType: 'unscheduled', period: null, sortOrder: 0, createdAt: '2026-11-04T12:00:00.000Z', updatedAt: '2026-11-04T12:00:00.000Z' }
  let loads = 0
  let disposals = 0
  let notify!: (state: MapPreviewState) => void
  const points: MapPoint[] = []
  const load: MapPreviewLoader = async () => { loads++; return { mountMapPreview(_container, point, reportState) {
    points.push(point); notify = reportState; reportState({ phase: 'ready', message: 'Carte test chargée' })
    return { update(next) { points.push(next) }, dispose() { disposals++ } }
  } } }
  const render = (activity: TripActivity) => flushSync(() => root.render(<ActivityMapPreview activity={activity} load={load} />))
  try {
    render(base); await settle(); assert(loads === 0 && !host.querySelector('figure'), 'Carte vide ou module inutile chargé.')
    render({ ...base, latitude: 0, longitude: 0, location: 'Point zéro' }); await settle()
    assert(Number(loads) === 1 && points[0].latitude === 0 && points[0].longitude === 0 && host.textContent?.includes('Point zéro'), 'Carte zéro absente.')
    assert(host.querySelector('a[href="https://www.openstreetmap.org/copyright"]'), 'Attribution OSM absente.')
    render({ ...base, latitude: -33.86, longitude: 151.2, location: 'Lieu modifié' }); await settle()
    assert(points.at(-1)?.latitude === -33.86 && points.at(-1)?.name === 'Lieu modifié' && Number(loads) === 1, 'Aperçu non actualisé ou recréé inutilement.')
    flushSync(() => notify({ phase: 'error', message: 'Tuiles indisponibles — test' }))
    assert(host.textContent?.includes('Tuiles indisponibles') && host.querySelector('button')?.textContent?.includes('Réessayer'), 'Repli cartographique absent.')
    flushSync(() => host.querySelector<HTMLButtonElement>('button')!.click()); await settle()
    assert(Number(loads) === 2 && Number(disposals) === 1, 'Retry non nettoyé.')
    flushSync(() => window.dispatchEvent(new Event('offline'))); await settle()
    assert(host.textContent?.includes('hors connexion') && Number(disposals) === 2, 'Carte non nettoyée offline.')
    const before = loads
    render({ ...base, latitude: 51.5, longitude: -0.12 }); await settle()
    assert(loads === before, 'Module demandé hors connexion.')
    flushSync(() => window.dispatchEvent(new Event('online'))); await settle()
    assert(Number(loads) === before + 1, 'Carte non reprise en ligne.')
    render(base); await settle(); assert(!host.querySelector('figure'), 'Carte conservée après retrait des coordonnées.')
    render({ ...base, latitude: 90, longitude: 0 }); await settle()
    assert(host.textContent?.includes('polaires') && !host.querySelector('.activity-map-canvas'), 'Coordonnée polaire falsifiée.')
    report('UI carte : absence, zéro, mise à jour, marqueur transmis, attribution, erreurs/retry, offline, pôles et démontage avec moteur simulé.')
  } finally {
    flushSync(() => root.unmount()); host.remove()
    window.dispatchEvent(new Event(previousOffline ? 'offline' : 'online'))
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
  }
}
