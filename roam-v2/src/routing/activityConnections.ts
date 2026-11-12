import { compareActivities, type TripActivity } from '../db/activityModel'
import { activityIncludesParticipant } from '../db/activityParticipants'
import type { Trip } from '../db/database'
import type { Journey, JourneySegment, Place } from '../evolution/v21/contracts'
import { buildDayPlanning } from '../components/program/dayPlanning'

export type ActivityConnection = {
  key: string; from: TripActivity; to: TripActivity; participantIds?: string[]; uncertain: boolean
}
export type SavedConnection = { journey: Journey; pair?: ActivityConnection; participantIds?: string[]; stale: boolean }
export const connectionKey = (from: string, to: string) => JSON.stringify([from, to])
export function connectionPlace(activity: TripActivity): Place {
  return { name: activity.location || activity.title, address: activity.address, latitude: activity.latitude, longitude: activity.longitude }
}
export function connectionPlacesCurrent(journey: Journey, pair: ActivityConnection): boolean {
  return [pair.from, pair.to].every((activity, index) => {
    const place = journey.stops[index]?.place
    return place && (place.address ?? '') === (activity.address ?? '') && place.latitude === activity.latitude && place.longitude === activity.longitude
  })
}
export function connectionEndpoints(journey: Journey): [string, string] | undefined {
  const from = journey.stops[0]?.link, to = journey.stops.at(-1)?.link
  return from?.kind === 'activity' && to?.kind === 'activity' && from.state === 'linked' && to.state === 'linked'
    ? [from.id, to.id] : undefined
}

// Pure read model. No generated journeys, network, writes or invented people.
export function individualConnections(trip: Trip, activities: readonly TripActivity[]): ActivityConnection[] {
  const grouped = new Map<string, ActivityConnection>()
  const people = trip.participants?.length ? trip.participants.map(person => person.id) : [undefined]
  for (const person of people) {
    const days = new Map<string, TripActivity[]>()
    for (const activity of activities) {
      if (activity.tripId !== trip.id || activity.date === null || (person === undefined ? activity.participantIds !== undefined : !activityIncludesParticipant(activity, person))) continue
      const rows = days.get(activity.date) ?? []; rows.push(activity); days.set(activity.date, rows)
    }
    for (const rows of days.values()) {
      rows.sort((a, b) => a.scheduleType === 'exact' && b.scheduleType === 'exact' ? a.startTime.localeCompare(b.startTime) || compareActivities(a, b) : compareActivities(a, b))
      const conflicts = new Set(buildDayPlanning(rows).timed.filter(item => item.conflicts.length).map(item => item.activity.id))
      for (let index = 0; index < rows.length - 1; index++) {
        const from = rows[index], to = rows[index + 1]
        if (conflicts.has(from.id) || conflicts.has(to.id)) continue
        const key = connectionKey(from.id, to.id), previous = grouped.get(key)
        if (previous && person !== undefined) previous.participantIds!.push(person)
        else if (!previous) grouped.set(key, { key, from, to, participantIds: person === undefined ? undefined : [person], uncertain: from.scheduleType !== 'exact' || to.scheduleType !== 'exact' || !from.endTime || rows.some(row => row.scheduleType !== 'exact') })
      }
    }
  }
  return [...grouped.values()]
}

export function buildConnectionPlan(trip: Trip, activities: readonly TripActivity[], journeys: readonly Journey[]) {
  const pairs = individualConnections(trip, activities)
  const saved: SavedConnection[] = []
  for (const journey of journeys) {
    if (journey.tripId !== trip.id) continue
    const endpoints = connectionEndpoints(journey)
    const pair = endpoints ? pairs.find(item => item.key === connectionKey(...endpoints)) : undefined
    if (!pair && journey.purpose !== 'activity-connection') continue
    const relevant = pair?.participantIds?.filter(id => journey.participantIds === undefined || journey.participantIds.includes(id))
    const empty = relevant?.length === 0 || journey.participantIds?.length === 0
    const missing = journey.participantIds?.some(id => !pair?.participantIds?.includes(id)) ?? false
    const dateChanged = !!pair && (journey.departure !== undefined && journey.departure.date !== pair.from.date || journey.arrival !== undefined && journey.arrival.date !== pair.to.date)
    const placeChanged = journey.purpose === 'activity-connection' && pair && !connectionPlacesCurrent(journey, pair)
    saved.push({ journey, pair, participantIds: relevant, stale: !pair || empty || missing || dateChanged || !!placeChanged })
  }
  const available = pairs.flatMap(pair => {
    const matches = saved.filter(item => item.pair?.key === pair.key)
    if (pair.participantIds === undefined) return matches.length ? [] : [pair]
    const remaining = pair.participantIds.filter(id => !matches.some(item => item.participantIds?.includes(id)))
    return remaining.length ? [{ ...pair, participantIds: remaining }] : []
  })
  return { pairs, available, saved }
}

// This is only an external link, never fetched or embedded by Roam.
export function externalConnectionUrl(from: TripActivity, to: TripActivity, mode: JourneySegment['mode']): string | undefined {
  const point = (activity: TripActivity) => activity.latitude !== undefined && activity.longitude !== undefined
    ? `${activity.latitude},${activity.longitude}` : activity.address?.trim() || undefined
  const origin = point(from), destination = point(to)
  if (!origin || !destination || mode === 'plane' || mode === 'boat' || mode === 'other') return undefined
  const travelmode = mode === 'walk' ? 'walking' : mode === 'bicycle' ? 'bicycling' : mode === 'car' || mode === 'taxi' ? 'driving' : 'transit'
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', origin, destination, travelmode })}`
}
