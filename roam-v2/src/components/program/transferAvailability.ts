import type { TripActivity } from '../../db/activityModel'
import type { ManualTransfer } from '../../db/transferModel'
import { buildDayPlanning, type DayPlanning, type FreePeriod } from './dayPlanning'

export type UnknownTransferReason = 'different-day' | 'missing-activity' | 'order' | 'hours' | 'end'
  | 'negative-interval' | 'multiple' | 'simultaneous' | 'activity-conflict' | 'earlier-end' | 'duration' | 'invalid-duration'
export type TransferTiming =
  | { state: 'available' | 'occupied' | 'conflict'; rawMinutes: number; durationMinutes: number; remainingMinutes: number }
  | { state: 'unknown'; reason: UnknownTransferReason; rawMinutes?: number }
export type GapTiming = TransferTiming | { state: 'raw'; rawMinutes: number }
const samePair = (a: ManualTransfer, b: ManualTransfer) => a.fromActivityId === b.fromActivityId && a.toActivityId === b.toActivityId

// Shared by cards and timelines. Only scheduling fields are read; costs and
// persisted activity/transfer objects are never changed or copied for storage.
export function assessTransferTiming(transfer: ManualTransfer, activities: readonly TripActivity[], transfers: readonly ManualTransfer[], plan?: DayPlanning): TransferTiming {
  const from = activities.find((item) => item.id === transfer.fromActivityId)
  const to = activities.find((item) => item.id === transfer.toActivityId)
  if (!from || !to) return { state: 'unknown', reason: 'missing-activity' }
  if (from.tripId !== to.tripId || from.date === null || from.date !== to.date) return { state: 'unknown', reason: 'different-day' }
  const day = plan ?? buildDayPlanning(activities.filter((item) => item.date === from.date && item.tripId === from.tripId))
  const departure = day.timed.findIndex((item) => item.activity.id === from.id)
  const arrival = day.timed.findIndex((item) => item.activity.id === to.id)
  if (departure < 0 || arrival < 0) return { state: 'unknown', reason: 'hours' }
  const a = day.timed[departure]; const b = day.timed[arrival]
  const raw = a.end === undefined ? {} : { rawMinutes: b.start - a.end }
  if (day.timed.filter((item) => item.start === a.start).length > 1 || day.timed.filter((item) => item.start === b.start).length > 1) return { state: 'unknown', reason: 'simultaneous', ...raw }
  if (arrival !== departure + 1) return { state: 'unknown', reason: 'order', ...raw }
  if (a.conflicts.length || b.conflicts.length) return { state: 'unknown', reason: 'activity-conflict', ...raw }
  if (a.end === undefined) return { state: 'unknown', reason: 'end' }
  if (b.start < a.end) return { state: 'unknown', reason: 'negative-interval', ...raw }
  if (day.timed.slice(0, departure).some((item) => item.end === undefined)) return { state: 'unknown', reason: 'earlier-end', ...raw }
  if (transfers.filter((item) => samePair(item, transfer)).length !== 1) return { state: 'unknown', reason: 'multiple', ...raw }
  if (transfer.durationMinutes === undefined) return { state: 'unknown', reason: 'duration', ...raw }
  if (!Number.isFinite(transfer.durationMinutes) || transfer.durationMinutes < 0) return { state: 'unknown', reason: 'invalid-duration', ...raw }
  const rawMinutes = b.start - a.end
  const remainingMinutes = rawMinutes - transfer.durationMinutes
  return { state: remainingMinutes > 0 ? 'available' : remainingMinutes === 0 ? 'occupied' : 'conflict', rawMinutes, durationMinutes: transfer.durationMinutes, remainingMinutes }
}

export function buildTransferDayPlanning(activities: readonly TripActivity[], transfers: readonly ManualTransfer[] = []) {
  const planning = buildDayPlanning(activities)
  const gaps = new Map<FreePeriod, GapTiming>()
  for (const entry of planning.entries) {
    if (entry.kind !== 'free') continue
    // Preserve the existing union of occupied activity intervals. A gap may
    // start at the end of an earlier overlapping activity, not the last row.
    const previous = planning.timed.filter((item) => item.start < entry.end).at(-1)
    const departures = planning.timed.filter((item) => item.start === previous?.start).map((item) => item.activity.id)
    const arrivals = planning.timed.filter((item) => item.start === entry.end).map((item) => item.activity.id)
    const matches = transfers.filter((item) => departures.includes(item.fromActivityId) && arrivals.includes(item.toActivityId))
    if (!matches.length) { gaps.set(entry, { state: 'raw', rawMinutes: entry.durationMinutes }); continue }
    const timing = assessTransferTiming(matches[0], activities, transfers, planning)
    if (matches.length > 1) gaps.set(entry, { state: 'unknown', reason: timing.state === 'unknown' && timing.reason === 'simultaneous' ? 'simultaneous' : 'multiple', rawMinutes: entry.durationMinutes })
    else if (timing.state === 'unknown') gaps.set(entry, { ...timing, rawMinutes: entry.durationMinutes })
    else if (timing.rawMinutes !== entry.durationMinutes) gaps.set(entry, { state: 'unknown', reason: 'activity-conflict', rawMinutes: entry.durationMinutes })
    else gaps.set(entry, timing)
  }
  return { planning, gaps }
}

// A card presents timing only if no corresponding raw gap can carry it. This
// covers touching activities (zero interval), incomplete hours and no-hour links.
export function transferTimingOutsideGap(transfer: ManualTransfer, activities: readonly TripActivity[], transfers: readonly ManualTransfer[]): TransferTiming | null {
  // One explanatory note per ordered pair, even without a gap row. This is
  // presentation deduplication only: duplicate routes remain unknown, not chosen.
  if (transfers.find((item) => samePair(item, transfer))?.id !== transfer.id) return null
  const from = activities.find((item) => item.id === transfer.fromActivityId)
  if (!from || from.date === null) return assessTransferTiming(transfer, activities, transfers)
  const dayActivities = activities.filter((item) => item.date === from.date && item.tripId === from.tripId)
  const planning = buildDayPlanning(dayActivities)
  const timing = assessTransferTiming(transfer, activities, transfers, planning)
  if (timing.rawMinutes !== undefined && planning.entries.some((entry) => entry.kind === 'free' && planning.timed.some((item) => item.activity.id === transfer.toActivityId && item.start === entry.end))) return null
  return timing
}

export const unknownTransferMessages: Record<UnknownTransferReason, string> = {
  'different-day': 'Temps disponible inconnu : les activités ne sont pas dans la même journée.',
  'missing-activity': 'Temps disponible inconnu : une activité est introuvable.',
  order: 'Temps disponible inconnu : les activités ne se suivent pas dans cet ordre.',
  hours: 'Temps disponible inconnu : les deux activités doivent avoir une heure précise.',
  end: 'Temps disponible inconnu : la fin de l’activité de départ n’est pas renseignée.',
  'negative-interval': 'Le début de l’arrivée précède la fin du départ ; le temps disponible ne peut pas être calculé.',
  multiple: 'Temps disponible inconnu : plusieurs déplacements relient ces activités. Choisis celui à conserver.',
  simultaneous: 'Temps disponible inconnu : plusieurs activités commencent à la même heure.',
  'activity-conflict': 'Temps disponible inconnu : les horaires des activités sont déjà en conflit.',
  'earlier-end': 'Temps disponible inconnu : une activité précédente n’a pas de fin renseignée.',
  duration: 'Temps disponible inconnu : la durée du déplacement n’est pas renseignée.',
  'invalid-duration': 'Temps disponible inconnu : la durée du déplacement est invalide.',
}
