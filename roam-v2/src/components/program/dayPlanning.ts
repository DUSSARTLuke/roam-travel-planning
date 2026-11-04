import { compareActivities, type TripActivity } from '../../db/activityModel'

export type PlanningConflict = { activity: TripActivity; kind: 'overlap' | 'same-start' }
export type TimedActivity = { kind: 'activity'; activity: TripActivity; start: number; end?: number; durationMinutes?: number; conflicts: PlanningConflict[] }
export type FreePeriod = { kind: 'free'; start: number; end: number; durationMinutes: number }
export type DayPlanning = { entries: (TimedActivity | FreePeriod)[]; timed: TimedActivity[]; toOrganize: TripActivity[]; hasUnknownEnd: boolean; conflictCount: number }

function minutes(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}
export function planningTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
export function planningDuration(value: number): string {
  const hours = Math.floor(value / 60)
  const remaining = value % 60
  return hours ? `${hours} h${remaining ? ` ${remaining}` : ''}` : `${remaining} min`
}

// Input is the selected day's activities. Keep references, not duplicate records.
// Free periods cover only bounded gaps between exact activities. Unknown ends
// prevent claiming later gaps are free; periods never acquire invented hours.
export function buildDayPlanning(activities: readonly TripActivity[]): DayPlanning {
  const timed: TimedActivity[] = []
  const toOrganize: TripActivity[] = []
  for (const activity of activities) {
    const start = activity.scheduleType === 'exact' ? minutes(activity.startTime) : undefined
    if (start === undefined) { toOrganize.push(activity); continue }
    const rawEnd = minutes(activity.endTime)
    const end = rawEnd !== undefined && rawEnd >= start ? rawEnd : undefined
    timed.push({ kind: 'activity', activity, start, ...(end !== undefined ? { end, durationMinutes: end - start } : {}), conflicts: [] })
  }
  timed.sort((a, b) => a.start - b.start || compareActivities(a.activity, b.activity))
  toOrganize.sort(compareActivities)
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]
      let kind: PlanningConflict['kind']
      if (a.start === b.start) kind = 'same-start'
      else if (a.end === undefined || b.start >= a.end) break
      else if (b.end === b.start) continue // Explicit zero-length interval has no occupied duration.
      else kind = 'overlap'
      a.conflicts.push({ activity: b.activity, kind })
      b.conflicts.push({ activity: a.activity, kind })
    }
  }
  const entries: DayPlanning['entries'] = []
  let coveredUntil: number | undefined
  let unknownEnd = false
  for (const item of timed) {
    if (!unknownEnd && coveredUntil !== undefined && item.start > coveredUntil) {
      entries.push({ kind: 'free', start: coveredUntil, end: item.start, durationMinutes: item.start - coveredUntil })
    }
    entries.push(item)
    if (item.end === undefined) unknownEnd = true
    else coveredUntil = Math.max(coveredUntil ?? item.end, item.end)
  }
  return { entries, timed, toOrganize, hasUnknownEnd: unknownEnd, conflictCount: timed.filter((item) => item.conflicts.length > 0).length }
}
