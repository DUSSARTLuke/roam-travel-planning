import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import type { ActivityDocument } from '../../db/documentModel'
import { validateTripSharing } from '../../money/expenseSharing'
import { validateTripTransfers } from '../../db/transferModel'
import { assertJourney, type Journey, type OwnedDocument, type Place } from './contracts'

export type LegacySnapshot = {
  databaseVersion: 4 | 5; trips: readonly Trip[]; activities: readonly TripActivity[]
  documents: readonly ActivityDocument[]; blobIds: readonly string[]
  metadata?: readonly { key: string; [field: string]: unknown }[]
}
export const legacyJourneyId = (tripId: string, transferId: string) => `legacy-transfer:${encodeURIComponent(tripId)}:${encodeURIComponent(transferId)}`
function unique<T extends { id: string }>(rows: readonly T[], label: string): Map<string, T> {
  const map = new Map(rows.map(row => [row.id, row]))
  if (map.size !== rows.length) throw new Error(`${label} : identifiant dupliqué.`)
  return map
}
function snapshotPlace(activity: TripActivity): Place {
  return { name: activity.location?.trim() || activity.title,
    ...(activity.address !== undefined ? { address: activity.address } : {}),
    ...(activity.latitude !== undefined ? { latitude: activity.latitude } : {}),
    ...(activity.longitude !== undefined ? { longitude: activity.longitude } : {}) }
}
// Simulation only. Input is cloned; no Dexie open, write, random ID or clock.
// Returns a proposed V6 payload, NOT a runnable migration or restore operation.
export function planV6(snapshot: LegacySnapshot, allocateJourneyId = legacyJourneyId) {
  if (![4, 5].includes(snapshot.databaseVersion)) throw new Error('Schéma source incompatible.')
  const source = structuredClone(snapshot)
  const trips = unique(source.trips, 'Voyages'), activities = unique(source.activities, 'Activités')
  unique(source.documents, 'Documents')
  if (source.activities.some(activity => !trips.has(activity.tripId))) throw new Error('Activité sans voyage.')
  const blobs = new Set(source.blobIds)
  if (blobs.size !== source.blobIds.length || blobs.size !== source.documents.length || source.documents.some(document => !blobs.has(document.id))) throw new Error('Métadonnées et Blob non bijectifs.')
  const journeys: Journey[] = []
  const plannedTrips = source.trips.map(trip => {
    validateTripSharing(trip, activities)
    const transfers = validateTripTransfers(trip.manualTransfers, trip.id, activities)
    for (const transfer of transfers) {
      const from = activities.get(transfer.fromActivityId)!, to = activities.get(transfer.toActivityId)!
      const id = allocateJourneyId(trip.id, transfer.id)
      const journey: Journey = {
        id, tripId: trip.id, title: `${from.title} → ${to.title}`,
        stops: [from, to].map((activity, index) => ({ id: `${id}:stop:${index}`, kind: 'activity', place: snapshotPlace(activity), link: { kind: 'activity', id: activity.id, state: 'linked' } })),
        segments: [{ id: `${id}:segment:0`, fromStopId: `${id}:stop:0`, toStopId: `${id}:stop:1`, mode: transfer.mode,
          ...(transfer.durationMinutes !== undefined ? { durationMinutes: transfer.durationMinutes } : {}) }],
        ...(from.date !== null ? { departure: { date: from.date, ...(from.scheduleType === 'exact' && from.endTime ? { time: from.endTime } : {}) } } : {}),
        ...(to.date !== null ? { arrival: { date: to.date, ...(to.scheduleType === 'exact' ? { time: to.startTime } : {}) } } : {}),
        estimatedCost: transfer.estimatedCost, paidAmount: transfer.paidAmount, currency: transfer.currency,
        ...(transfer.notes !== undefined ? { notes: transfer.notes } : {}),
        createdAt: transfer.createdAt, updatedAt: transfer.updatedAt,
        legacy: { kind: 'manualTransfer', tripId: trip.id, id: transfer.id },
      }
      assertJourney(journey); journeys.push(journey)
    }
    const { manualTransfers: _legacyTransfers, expenseShares, ...rest } = trip
    return { ...rest, ...(expenseShares ? { expenseShares: expenseShares.map(share => share.kind === 'transfer'
      ? { ...share, kind: 'journey' as const, expenseId: legacyJourneyId(trip.id, share.expenseId) } : share) } : {}) }
  })
  const documents: OwnedDocument[] = source.documents.map(document => {
    const activity = activities.get(document.activityId)
    if (!activity) throw new Error('Document sans activité.')
    const { activityId, ...metadata } = document
    return { ...metadata, tripId: activity.tripId, owner: { kind: 'activity', id: activityId } }
  })
  return { databaseVersion: 6 as const, trips: plannedTrips, activities: source.activities, journeys,
    accommodations: [], documents, blobIds: source.blobIds, metadata: source.metadata ?? [],
    identityMap: journeys.map(journey => ({ tripId: journey.tripId, legacyTransferId: journey.legacy!.id, journeyId: journey.id })),
  }
}
export function planZip1To2(formatVersion: number, snapshot: LegacySnapshot) {
  if (formatVersion !== 1 || ![4, 5].includes(snapshot.databaseVersion)) throw new Error('Source ZIP historique incompatible.')
  // The existing ZIP1 reader must verify CRC, SHA, limits and relations FIRST.
  // No ZIP parsing or claim of binary verification in this semantic adapter.
  return { formatVersion: 2 as const, payload: planV6(snapshot) }
}
