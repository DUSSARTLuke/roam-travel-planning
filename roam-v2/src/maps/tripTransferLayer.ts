import type { GeoJSONSource, Map as LibreMap, MapMouseEvent } from 'maplibre-gl'
import { transferFeatures, type MapLink } from './tripMapTransfers'

const sourceId = 'roam-manual-transfers'
const lineId = `${sourceId}-lines`, lineHitId = `${sourceId}-hit`, pointId = `${sourceId}-same-point`
// Isolated adapter: it never reads/writes the camera, storage or remote services.
export function mountTransferLayer(map: LibreMap, onSelect: (ids: string[]) => void, onError: () => void) {
  let live = true, links: readonly MapLink[] = [], selected: string | null = null
  let styleReady = map.isStyleLoaded()
  function sync() {
    if (!live || !styleReady) return
    try {
      const data = transferFeatures(links, selected)
      const source = map.getSource(sourceId) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else map.addSource(sourceId, { type: 'geojson', data })
      if (!map.getLayer(lineId)) map.addLayer({ id: lineId, type: 'line', source: sourceId, filter: ['==', '$type', 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 6, 3], 'line-dasharray': [2, 2] } })
      if (!map.getLayer(lineHitId)) map.addLayer({ id: lineHitId, type: 'line', source: sourceId, filter: ['==', '$type', 'LineString'], paint: { 'line-width': 34, 'line-opacity': 0 } })
      if (!map.getLayer(pointId)) map.addLayer({ id: pointId, type: 'circle', source: sourceId, filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': ['case', ['get', 'selected'], 32, 28], 'circle-color': ['get', 'color'], 'circle-opacity': 0.18, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['case', ['get', 'selected'], 4, 2] } })
    } catch { onError() }
  }
  function hits(event: MapMouseEvent) {
    const layers = [lineHitId, pointId].filter((id) => map.getLayer(id))
    if (!layers.length) return []
    try {
      const features = map.queryRenderedFeatures([[event.point.x - 5, event.point.y - 5], [event.point.x + 5, event.point.y + 5]], { layers })
      const ids = new Set(features.map((feature) => feature.properties?.id))
      // Deduplicate dateline segments/world copies, and reject stale removed IDs.
      return links.filter((link) => ids.has(link.transfer.id)).map((link) => link.transfer.id)
    } catch { onError(); return [] }
  }
  function click(event: MapMouseEvent) { if (!live) return; const ids = hits(event); if (ids.length) onSelect(ids) }
  function hover(event: MapMouseEvent) { if (live) map.getCanvas().style.cursor = hits(event).length ? 'pointer' : '' }
  function styleLoaded() { styleReady = true; sync() }
  map.on('style.load', styleLoaded); map.on('click', click); map.on('mousemove', hover)
  return {
    update(next: readonly MapLink[], id: string | null) { if (!live) return; links = next; selected = id; sync() },
    dispose() {
      if (!live) return; live = false
      map.off('style.load', styleLoaded); map.off('click', click); map.off('mousemove', hover)
      map.getCanvas().style.cursor = ''
      // The owning trip map is removed immediately afterwards, with its layers.
      links = []
    },
  }
}
