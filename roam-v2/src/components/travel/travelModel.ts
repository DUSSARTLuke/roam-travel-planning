import { buildDayPlanning } from '../program/dayPlanning'
import type { Trip } from '../../db/database'
import { type TripActivity } from '../../db/activityModel'
import { getTripDays } from '../program/dates'
import { buildTripOverview, type LocalClock } from '../dashboard/overviewModel'
export function travelDay(trip: Trip, selected: string | undefined, today: string) {
  const days = getTripDays(trip.startDate, trip.endDate)
  return { days, date: selected && days.includes(selected) ? selected : days.includes(today) ? today : today < trip.startDate ? days[0] : days.at(-1) }
}
export function travelActivities(trip: Trip, activities: readonly TripActivity[], date: string, clock: LocalClock) {
  const planning = buildDayPlanning(activities.filter((activity) => activity.tripId === trip.id && activity.date === date))
  const items = [...planning.timed.map((entry) => entry.activity), ...planning.toOrganize]
  const next = buildTripOverview(trip, activities, clock).next
  return { items, nextId: next?.date === date ? next.id : undefined }
}
