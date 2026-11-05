import { compareActivities, type ReservationType, type ReservationStatus, type TripActivity } from '../db/activityModel'
import type { ActivityDocument } from '../db/documentModel'
import { reservationLabels, reservationTypeLabels } from '../components/program/activityPresentation'
export function hasReservationInformation(activity: TripActivity): boolean {
  return Boolean(activity.reservationType !== undefined || activity.reservationStatus !== undefined || activity.reservationReference || activity.reservationProvider || activity.reservationPeople !== undefined || activity.reservationDeadline || activity.reservationNotes)
}
export function reservationGroup(activity: TripActivity): ReservationType {
  if (activity.reservationType !== undefined && Object.hasOwn(reservationTypeLabels, activity.reservationType)) return activity.reservationType
  return activity.category === 'transport' ? 'transport' : activity.category === 'visit' || activity.category === 'outing' ? 'activity' : 'other'
}
export type LibraryEntry = { activity: TripActivity; type: ReservationType; reservation: boolean; documents: ActivityDocument[] }
export type LibraryFilters = { query: string; type: ReservationType | 'all'; status: ReservationStatus | 'all' | 'unknown'; documents: 'all' | 'with' | 'without' }
export const initialLibraryFilters: LibraryFilters = { query: '', type: 'all', status: 'all', documents: 'all' }
const searchable = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR')
// No new reservation/document objects are persisted. Each activity and document
// appears once, with references to the original data and deterministic ordering.
export function buildTripLibrary(tripId: string, activities: readonly TripActivity[], documents: readonly ActivityDocument[]): LibraryEntry[] {
  const local = new Map(activities.filter((activity) => activity.tripId === tripId).map((activity) => [activity.id, activity]))
  const seen = new Set<string>(), byActivity = new Map<string, ActivityDocument[]>()
  for (const document of documents) {
    if (!local.has(document.activityId) || seen.has(document.id)) continue
    seen.add(document.id)
    const rows = byActivity.get(document.activityId) ?? []; rows.push(document); byActivity.set(document.activityId, rows)
  }
  return [...local.values()].sort(compareActivities).flatMap((activity) => {
    const files = (byActivity.get(activity.id) ?? []).sort((a, b) => a.importedAt.localeCompare(b.importedAt) || a.id.localeCompare(b.id))
    const reservation = hasReservationInformation(activity)
    return reservation || files.length > 0 ? [{ activity, type: reservationGroup(activity), reservation, documents: files }] : []
  })
}
export function filterTripLibrary(entries: readonly LibraryEntry[], filters: LibraryFilters): LibraryEntry[] {
  const words = searchable(filters.query.trim()).split(/\s+/).filter(Boolean)
  return entries.filter((entry) => {
    if (filters.type !== 'all' && entry.type !== filters.type) return false
    if (filters.status === 'unknown' ? entry.activity.reservationStatus !== undefined : filters.status !== 'all' && entry.activity.reservationStatus !== filters.status) return false
    if (filters.documents === 'with' && !entry.documents.length || filters.documents === 'without' && entry.documents.length > 0) return false
    const activity = entry.activity
    const haystack = searchable([activity.title, activity.date, activity.startTime, activity.endTime, activity.location, activity.address, activity.notes, activity.reservationReference, activity.reservationProvider, activity.reservationNotes, activity.reservationDeadline, reservationTypeLabels[entry.type], activity.reservationStatus ? reservationLabels[activity.reservationStatus] : 'Statut non renseigné', ...entry.documents.map((document) => document.name)].filter(Boolean).join(' '))
    return words.every((word) => haystack.includes(word))
  })
}
