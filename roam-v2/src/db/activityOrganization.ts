import { compareActivities, type TripActivity } from './activityModel'

export type OrderDirection = 'up' | 'down'
// Only the selected trip/day's non-exact activities. Missing historical order = 0.
// Dense ranks resolve ties without touching dates, times or other activity data.
export function reorderActivities(activities: readonly TripActivity[], id: string, direction: OrderDirection) {
  const ordered = [...activities].sort(compareActivities)
  const index = ordered.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('Activité introuvable dans cette liste.')
  const target = index + (direction === 'up' ? -1 : 1)
  if (target < 0 || target >= ordered.length) return []
  ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
  return ordered.flatMap((item, sortOrder) => item.sortOrder === sortOrder ? [] : [{ id: item.id, sortOrder }])
}
export function schedulingKey(activity: TripActivity): string {
  return JSON.stringify([activity.date, activity.scheduleType, activity.startTime, activity.endTime, activity.period])
}
