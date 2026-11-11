import type { TripActivity } from '../db/activityModel'
import { activityMapPoint } from './mapPoint'

export const MERCATOR_LIMIT = 85.051129
export type TripMapPoint = { id: string; title: string; latitude: number; longitude: number; name: string; kind?: 'activity'|'home'|'station'|'airport'|'accommodation'|'free' }
export function tripMapPoints(activities: readonly TripActivity[], tripId: string): TripMapPoint[] {
  return activities.flatMap((activity) => {
    if (activity.tripId !== tripId) return []
    const point = activityMapPoint(activity)
    return point ? [{ ...point, id: activity.id, title: activity.title }] : []
  })
}
export function drawablePoints(points: readonly TripMapPoint[]) { return points.filter((point) => Math.abs(point.latitude) <= MERCATOR_LIMIT) }
const circleLongitude = (longitude: number) => (longitude % 360 + 360) % 360
export function coordinateKey(point: TripMapPoint): string { return `${point.latitude}/${circleLongitude(point.longitude)}` }

// Remove the largest empty longitude arc. Bounds may exceed ±180 for a narrow
// dateline crossing, without changing any original GPS values in storage/list.
export function tripMapBounds(points: readonly TripMapPoint[]): [[number, number], [number, number]] | null {
  if (!points.length) return null
  const longitudes = points.map((point) => circleLongitude(point.longitude)).sort((a, b) => a - b)
  let largest = -1; let cut = 0
  for (let index = 0; index < longitudes.length; index++) {
    const next = index + 1 < longitudes.length ? longitudes[index + 1] : longitudes[0] + 360
    if (next - longitudes[index] > largest) { largest = next - longitudes[index]; cut = index }
  }
  let west = longitudes[(cut + 1) % longitudes.length]
  let east = longitudes[cut]
  if (east < west) east += 360
  if ((west + east) / 2 > 180) { west -= 360; east -= 360 }
  return [[west, Math.min(...points.map((point) => point.latitude))], [east, Math.max(...points.map((point) => point.latitude))]]
}
export function displayedLongitude(point: TripMapPoint, west: number): number {
  return west + ((point.longitude - west) % 360 + 360) % 360
}

export type TripMapSurface = { markers: (points: readonly TripMapPoint[]) => void; fit: (points: readonly TripMapPoint[]) => void; dispose: () => void }
// Camera ownership is explicit and testable: updates never reframe the map.
export function createTripMapController(initial: readonly TripMapPoint[], surface: TripMapSurface, frameInitially = true) {
  let points = initial; let live = true
  surface.markers(points); if (frameInitially) surface.fit(points)
  return {
    update(next: readonly TripMapPoint[]) { if (!live) return; points = next; surface.markers(points) },
    recenter() { if (live) surface.fit(points) },
    dispose() { if (!live) return; live = false; surface.dispose() },
  }
}
