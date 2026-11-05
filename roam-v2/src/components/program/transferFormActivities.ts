import type { TripActivity } from '../../db/activityModel'
import { buildDayPlanning } from './dayPlanning'

// The same chronological and À organiser order as the Programme, grouped by
// local ISO date. Return references, never sort or rewrite the input records.
export function orderedTransferActivities(activities: readonly TripActivity[], tripId: string): TripActivity[] {
  const byDate = new Map<string, TripActivity[]>()
  for (const activity of activities) {
    if (activity.tripId !== tripId || activity.date === null) continue
    const day = byDate.get(activity.date) ?? []
    day.push(activity)
    byDate.set(activity.date, day)
  }
  return [...byDate.keys()].sort().flatMap((date) => {
    const planning = buildDayPlanning(byDate.get(date)!)
    return [...planning.timed.map((item) => item.activity), ...planning.toOrganize]
  })
}
