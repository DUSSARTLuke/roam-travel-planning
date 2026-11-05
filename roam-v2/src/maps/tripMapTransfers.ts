import type { FeatureCollection, MultiLineString, Point } from 'geojson'
import type { TripActivity } from '../db/activityModel'
import { validateTransfer, type ManualTransfer, type TransferMode } from '../db/transferModel'
import { transferPlacement } from '../components/program/transferPlanning'
import { activityMapPoint } from './mapPoint'
import { coordinateKey, MERCATOR_LIMIT, type TripMapPoint } from './tripMapModel'

export const transferColors: Record<TransferMode, string> = {
  walk: '#86efac', bicycle: '#22d3ee', bus: '#fbbf24', metro: '#c084fc', tram: '#f472b6',
  train: '#60a5fa', car: '#fb923c', taxi: '#fde047', plane: '#e2e8f0', boat: '#2dd4bf', other: '#a1a1aa',
}
export type TransferGeometry = MultiLineString | Point
export type MapTransfer = { transfer: ManualTransfer; from: TripActivity; to: TripActivity; day: string; geometry: TransferGeometry }
const longitude = (value: number) => ((value + 180) % 360 + 360) % 360 - 180

// Straight indicative links, split at the dateline; no route or distance is inferred.
export function transferGeometry(from: TripMapPoint, to: TripMapPoint): TransferGeometry {
  const start = longitude(from.longitude), finish = longitude(to.longitude)
  if (coordinateKey(from) === coordinateKey(to)) return { type: 'Point', coordinates: [start, from.latitude] }
  let delta = finish - start
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  const end = start + delta
  const a = [start, from.latitude], b = [end, to.latitude]
  if (end >= -180 && end <= 180) return { type: 'MultiLineString', coordinates: [[a, b]] }
  const edge = end > 180 ? 180 : -180
  const latitude = from.latitude + (to.latitude - from.latitude) * ((edge - start) / delta)
  return { type: 'MultiLineString', coordinates: [[a, [edge, latitude]], [[-edge, latitude], [finish, to.latitude]]] }
}

// Pass the same filtered activity set as the markers. No additional DB reads.
export function tripMapTransfers(values: readonly ManualTransfer[], activities: readonly TripActivity[], tripId: string): MapTransfer[] {
  const local = activities.filter((activity) => activity.tripId === tripId)
  const byId = new Map(local.map((activity) => [activity.id, activity]))
  const counts = new Map<string, number>()
  for (const value of values) if (value && typeof value.id === 'string') counts.set(value.id, (counts.get(value.id) ?? 0) + 1)
  return values.flatMap((value) => {
    try {
      const transfer = validateTransfer(value)
      if (counts.get(transfer.id) !== 1) return []
      const from = byId.get(transfer.fromActivityId), to = byId.get(transfer.toActivityId)
      if (!from || !to) return []
      const start = activityMapPoint(from), finish = activityMapPoint(to)
      if (!start || !finish || Math.abs(start.latitude) > MERCATOR_LIMIT || Math.abs(finish.latitude) > MERCATOR_LIMIT) return []
      const placement = transferPlacement(transfer, local)
      if (!placement.day || placement.warning) return []
      return [{ transfer, from, to, day: placement.day, geometry: transferGeometry({ ...start, id: from.id, title: from.title }, { ...finish, id: to.id, title: to.title }) }]
    } catch { return [] } // Invalid records remain stored; never draw a misleading link.
  })
}
export function transferFeatures(links: readonly MapTransfer[], selected: string | null): FeatureCollection<TransferGeometry> {
  return { type: 'FeatureCollection', features: links.map((link) => ({ type: 'Feature', geometry: link.geometry,
    properties: { id: link.transfer.id, mode: link.transfer.mode, color: transferColors[link.transfer.mode], selected: link.transfer.id === selected } })) }
}
