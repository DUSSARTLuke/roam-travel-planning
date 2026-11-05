import type { Trip } from '../db/database'
import type { TripActivity } from '../db/activityModel'
import { getTripDays } from '../components/program/dates'
import { initialProgramNavigation, type ProgramNavigation } from '../components/program/programNavigation'

export type TripMapNavigation = { mode: 'all' | 'day'; selectedDate: string }

// Shared local calendar date, independent from the presentation of either tab.
export function tripMapNavigation(trip: Pick<Trip, 'startDate' | 'endDate'>, previous?: TripMapNavigation, programDate?: string): TripMapNavigation {
  const days = getTripDays(trip.startDate, trip.endDate)
  const date = programDate ?? previous?.selectedDate ?? trip.startDate
  return { mode: previous?.mode ?? 'all', selectedDate: days.includes(date) ? date : days[0] ?? trip.startDate }
}

export function programNavigationFromMap(trip: Pick<Trip, 'startDate'>, map: TripMapNavigation, previous?: ProgramNavigation): ProgramNavigation {
  const base = previous ?? initialProgramNavigation(trip.startDate)
  // Keep the user's Programme presentation, including Multi-jours/Calendrier.
  return { ...base, selectedDate: map.selectedDate, month: map.selectedDate.slice(0, 7) }
}

export function filterMapActivities(activities: readonly TripActivity[], tripId: string, navigation: TripMapNavigation): TripActivity[] {
  return activities.filter((activity) => activity.tripId === tripId && (navigation.mode === 'all' || activity.date === navigation.selectedDate))
}
