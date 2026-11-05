import { hasReservationInformation } from '../../reservations/library'
import type { Trip } from '../../db/database'
import type { TripActivity, ReservationStatus } from '../../db/activityModel'
import { parseDate } from '../program/dates'

export type LocalClock = { date: string; time: string }
// Civil dates/clock only. No toISOString(), guessed destination timezone or UTC conversion.
export function localClock(now: Date): LocalClock {
  return { date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` }
}
export function tripProgress(trip: Pick<Trip, 'startDate' | 'endDate'>, today: string) {
  const start = parseDate(trip.startDate), end = parseDate(trip.endDate), current = parseDate(today)
  if (!start || !end || !current || end < start) return { status: 'invalid' as const }
  // UTC noon is used solely for calendar-day arithmetic, never for an activity time.
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const offset = Math.round((current.getTime() - start.getTime()) / 86400000)
  return offset < 0 ? { status: 'before' as const, days, until: -offset }
    : offset >= days ? { status: 'after' as const, days }
      : { status: 'during' as const, days, day: offset + 1 }
}
export function buildTripOverview(trip: Trip, activities: readonly TripActivity[], clock: LocalClock) {
  const local = activities.filter((activity) => activity.tripId === trip.id)
  const scheduled = local.filter((activity) => activity.date !== null && parseDate(activity.date) && activity.date >= trip.startDate && activity.date <= trip.endDate && activity.date >= clock.date)
  const exact = scheduled.filter((activity) => activity.scheduleType === 'exact' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(activity.startTime) && (activity.date! > clock.date || activity.startTime >= clock.time))
    .sort((a, b) => a.date!.localeCompare(b.date!) || a.startTime!.localeCompare(b.startTime!) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
  const flexible = scheduled.filter((activity) => activity.scheduleType !== 'exact').sort((a, b) => a.date!.localeCompare(b.date!) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id))
  const reservations = local.filter(hasReservationInformation)
  const counts: Record<ReservationStatus | 'unknown', number> = { confirmed: 0, to_book: 0, pending: 0, not_required: 0, cancelled: 0, unknown: 0 }
  for (const activity of reservations) counts[activity.reservationStatus !== undefined && Object.hasOwn(counts, activity.reservationStatus) ? activity.reservationStatus : 'unknown']++
  return { progress: tripProgress(trip, clock.date), next: exact[0] ?? null, flexible: flexible[0] ?? null,
    untimed: flexible.length,
    ideas: local.filter((activity) => activity.date === null).length,
    reservations, reservationCounts: counts }
}
