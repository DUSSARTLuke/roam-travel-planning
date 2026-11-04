import type { StyleSpecification, RequestParameters } from 'maplibre-gl'

// Isolated provider configuration. No token, geocoder or tile downloads here.
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export function osmRasterStyle(): StyleSpecification {
  return { version: 8,
    sources: { osm: { type: 'raster', tiles: [OSM_TILE_URL], tileSize: 256, minzoom: 0, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-fade-duration': 0 } }],
  }
}
// Browser cache and Referer must remain enabled under the OSM usage policy.
export function osmMapRequest(url: string): RequestParameters {
  return { url, credentials: 'same-origin', referrerPolicy: 'strict-origin-when-cross-origin' }
}
