import { coordinateKey, createTripMapController, displayedLongitude, tripMapBounds, type TripMapPoint } from './tripMapModel'
import type { TripMapHandle, TripMapState } from './tripMapSession'
import { Map as LibreMap, Marker, NavigationControl, setWorkerUrl, setWorkerCount, setMaxParallelImageRequests } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { osmRasterStyle, osmMapRequest } from './osmRaster'
import type { MapPoint } from './mapPoint'
import type { MapPreviewHandle, MapPreviewState } from './previewSession'

setWorkerUrl(workerUrl)
setWorkerCount(1)
setMaxParallelImageRequests(4)
export function mountMapPreview(container: HTMLElement, point: MapPoint, notify: (state: MapPreviewState) => void): MapPreviewHandle {
  // OSM raster tiles are Web Mercator: do not falsify polar coordinates.
  if (Math.abs(point.latitude) > 85.051129) throw new Error('Coordonnées polaires hors du fond Web Mercator.')
  let removed = false
  let failed = false
  let current = point
  let marker: Marker | undefined
  let observer: ResizeObserver | undefined
  let frame: number | undefined
  const map = new LibreMap({ container, style: osmRasterStyle(), center: [point.longitude, point.latitude], zoom: 14, minZoom: 1, maxZoom: 18,
    attributionControl: false, renderWorldCopies: false, fadeDuration: 0, maxTileCacheSize: 32,
    cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, scrollZoom: false,
    locale: { 'Map.Title': 'Aperçu du lieu', 'Marker.Title': 'Lieu de l’activité', 'NavigationControl.ZoomIn': 'Zoom avant', 'NavigationControl.ZoomOut': 'Zoom arrière',
      'CooperativeGesturesHandler.WindowsHelpText': 'Utilise les boutons pour zoomer', 'CooperativeGesturesHandler.MacHelpText': 'Utilise les boutons pour zoomer',
      'CooperativeGesturesHandler.MobileHelpText': 'Déplace la carte avec deux doigts' },
    // OSM requires Referer and normal browser HTTP caching. No no-store/no-cache
    // headers, no tile prefetch, no application tile cache or offline download.
    transformRequest: osmMapRequest,
  })
  function dispose() {
    if (removed) return
    removed = true
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer?.disconnect(); marker?.remove(); map.remove()
  }
  try {
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    const element = document.createElement('div')
    element.className = 'activity-map-marker'
    element.setAttribute('role', 'img')
    function label(next: MapPoint) {
      element.setAttribute('aria-label', next.name ? `Lieu : ${next.name}` : 'Lieu de l’activité')
      element.title = next.name || 'Lieu de l’activité'
    }
    label(point)
    marker = new Marker({ element, anchor: 'bottom' }).setLngLat([point.longitude, point.latitude]).addTo(map)
    map.on('error', () => { failed = true; if (!removed) notify({ phase: 'error', message: 'Certaines tuiles ou ressources cartographiques ne sont pas disponibles. Les informations textuelles restent utilisables.' }) })
    map.on('idle', () => { if (!removed && !failed && map.isSourceLoaded('osm')) notify({ phase: 'ready', message: 'Carte du lieu chargée.' }) })
    map.getCanvas().setAttribute('aria-label', 'Carte interactive du lieu. Utilise les boutons de zoom ou les flèches du clavier.')
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { if (!removed) map.resize() }); observer.observe(container) }
    frame = requestAnimationFrame(() => { if (!removed) map.resize() })
    return {
      update(next) {
        if (removed) return
        if (Math.abs(next.latitude) > 85.051129) { notify({ phase: 'error', message: 'Le fond OSM ne couvre pas les pôles. Les coordonnées restent disponibles.' }); return }
        label(next)
        if (next.latitude !== current.latitude || next.longitude !== current.longitude) {
          failed = false
          notify({ phase: 'loading', message: 'Chargement du nouveau lieu…' })
          marker?.setLngLat([next.longitude, next.latitude]); map.jumpTo({ center: [next.longitude, next.latitude] })
        }
        current = next
      },
      dispose,
    }
  } catch (error) { dispose(); throw error }
}

// Global trip renderer shares MapLibre, worker, provider and request policy with
// the existing individual preview. Its update path never changes the camera.
export function mountTripMap(container: HTMLElement, initial: readonly TripMapPoint[], notify: (state: TripMapState) => void, onSelect?: (ids: string[]) => void): TripMapHandle {
  let removed = false; let failed = false; let points = initial
  const markers = new Map<string, { marker: Marker; button: HTMLButtonElement; click: (event: MouseEvent) => void }>()
  let selected: string | null = null
  let observer: ResizeObserver | undefined
  let frame: number | undefined
  function selection() {
    for (const [id, entry] of markers) {
      entry.button.setAttribute('aria-pressed', String(id === selected))
      entry.button.classList.toggle('is-selected', id === selected)
    }
  }
  const map = new LibreMap({ container, style: osmRasterStyle(), center: [0, 0], zoom: 1, minZoom: -2, maxZoom: 18,
    attributionControl: false, renderWorldCopies: true, fadeDuration: 0, maxTileCacheSize: 32,
    cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, scrollZoom: false, transformRequest: osmMapRequest,
    locale: { 'Map.Title': 'Carte du voyage', 'Popup.Close': 'Fermer les lieux', 'NavigationControl.ZoomIn': 'Zoom avant', 'NavigationControl.ZoomOut': 'Zoom arrière',
      'CooperativeGesturesHandler.WindowsHelpText': 'Utilise les boutons pour zoomer', 'CooperativeGesturesHandler.MacHelpText': 'Utilise les boutons pour zoomer',
      'CooperativeGesturesHandler.MobileHelpText': 'Déplace la carte avec deux doigts' },
  })
  function dispose() {
    if (removed) return; removed = true
    if (frame !== undefined) cancelAnimationFrame(frame)
    observer?.disconnect()
    for (const entry of markers.values()) { entry.button.removeEventListener('click', entry.click); entry.marker.remove() }
    markers.clear(); map.remove()
  }
  try {
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('error', () => { failed = true; if (!removed) notify({ phase: 'error', interactive: true, message: 'Certaines tuiles cartographiques sont indisponibles. La liste des lieux reste utilisable.' }) })
    map.on('idle', () => { if (!removed && !failed && map.isSourceLoaded('osm')) notify({ phase: 'ready', interactive: true, message: 'Carte du voyage chargée.' }) })
    map.getCanvas().setAttribute('aria-label', 'Carte interactive du voyage. Flèches pour déplacer la carte, boutons pour zoomer. Les lieux sont également listés sous la carte.')
    const controller = createTripMapController(initial, {
      markers(next) {
        points = next
        const ids = new Set(next.map((point) => point.id))
        for (const [id, entry] of markers) if (!ids.has(id)) { entry.button.removeEventListener('click', entry.click); entry.marker.remove(); markers.delete(id) }
        const west = tripMapBounds(next)?.[0][0] ?? -180
        const counts = new Map<string, number>()
        for (const point of next) counts.set(coordinateKey(point), (counts.get(coordinateKey(point)) ?? 0) + 1)
        next.forEach((point) => {
          let entry = markers.get(point.id)
          if (!entry) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'trip-map-marker'
            const click = (event: MouseEvent) => {
              event.stopPropagation()
              const current = points.find((item) => item.id === point.id)
              if (!current) return
              const coincident = points.filter((item) => coordinateKey(item) === coordinateKey(current))
              onSelect?.(coincident.map((item) => item.id))
            }
            button.addEventListener('click', click)
            entry = { button, click, marker: new Marker({ element: button, anchor: 'center' }).setLngLat([displayedLongitude(point, west), point.latitude]).addTo(map) }; markers.set(point.id, entry)
          }
          const count = counts.get(coordinateKey(point))!
          entry.button.textContent = count > 1 ? String(count) : '●'
          entry.button.setAttribute('aria-label', `${point.title}${point.name ? ` — ${point.name}` : ''}${count > 1 ? ` ; ${count} activités au même point` : ''}`)
          entry.button.title = entry.button.getAttribute('aria-label')!
          entry.marker.setLngLat([displayedLongitude(point, west), point.latitude])
        })
        selection()
      },
      fit(next) {
        const bounds = tripMapBounds(next); if (!bounds) return
        notify(failed ? { phase: 'error', interactive: true, message: 'Certaines tuiles cartographiques sont indisponibles. La liste des lieux reste utilisable.' }
          : { phase: 'loading', interactive: true, message: 'Chargement des tuiles cartographiques…' })
        if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) map.jumpTo({ center: bounds[0], zoom: 14 })
        else map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 })
      }, dispose,
    })
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { if (!removed) map.resize() }); observer.observe(container) }
    frame = requestAnimationFrame(() => { if (!removed) map.resize() })
    return { ...controller, select(id) { selected = id; selection() } }
  } catch (error) { dispose(); throw error }
}
