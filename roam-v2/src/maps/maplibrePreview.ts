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
