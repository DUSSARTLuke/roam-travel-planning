import { MAX_ACTIVITY_DOCUMENTS, MAX_DOCUMENT_BYTES } from '../../db/documentModel'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import type { ActivityDocument } from '../../db/documentModel'
import { validateExpenseShares, validateParticipants } from '../../money/expenseSharing'
import { assertJourney, assertAccommodation, type Journey, type Accommodation } from './contracts'

export function validateV6Graph(trips: readonly Trip[], activities: readonly TripActivity[], journeys: readonly Journey[], accommodations: readonly Accommodation[], documents: readonly ActivityDocument[]) {
  const tripIds = new Set(trips.map(t => t.id)), acts = new Map(activities.map(a => [a.id,a])), stays = new Map(accommodations.map(a => [a.id,a])), routes = new Map(journeys.map(j => [j.id,j]))
  if (routes.size !== journeys.length || stays.size !== accommodations.length) throw new Error('Entité V6 dupliquée.')
  const legacy = new Set<string>()
  for (const journey of journeys) {
    assertJourney(journey)
    if (!tripIds.has(journey.tripId)) throw new Error('Déplacement sans voyage.')
    if (journey.legacy) {
      if (journey.legacy.kind !== 'manualTransfer' || journey.legacy.tripId !== journey.tripId || typeof journey.legacy.id !== 'string' || !journey.legacy.id || journey.legacy.id.length > 512) throw new Error('Provenance du déplacement invalide.')
      const key = JSON.stringify([journey.tripId, journey.legacy.id])
      if (legacy.has(key)) throw new Error('Ancien transfert migré plusieurs fois.')
      legacy.add(key)
    }
    for (const stop of journey.stops) if (stop.link) {
      if (!['activity', 'accommodation'].includes(stop.link.kind) || !['linked','deleted'].includes(stop.link.state)) throw new Error('Référence de lieu invalide.')
      const parent = (stop.link.kind === 'activity' ? acts : stays).get(stop.link.id)
      if (stop.link.state === 'linked' ? !parent || parent.tripId !== journey.tripId : parent !== undefined) throw new Error('Référence de lieu incohérente ou hors voyage.')
    }
  }
  for (const stay of accommodations) { assertAccommodation(stay); if (!tripIds.has(stay.tripId)) throw new Error('Hébergement sans voyage.') }
  for (const trip of trips) {
    const participants = validateParticipants(trip.participants)
    const shared = new Set<string>()
    for (const share of validateExpenseShares(trip.expenseShares, participants)) {
      const parent = share.kind === 'activity' ? acts.get(share.expenseId) : share.kind === 'accommodation' ? stays.get(share.expenseId) : share.kind === 'journey' ? routes.get(share.expenseId) : journeys.find(j=>j.tripId===trip.id && j.legacy?.id===share.expenseId)
      if (!parent || parent.tripId !== trip.id) throw new Error('Partage sans dépense du voyage.')
      if(share.kind==='accommodation'&&(parent as Accommodation).budgetExcluded)throw new Error('Partage sur un hébergement exclu du budget.')
      const key=JSON.stringify([share.kind==='transfer'?'journey':share.kind,parent.id])
      if (shared.has(key)) throw new Error('Une même dépense possède plusieurs partages via ses alias.')
      shared.add(key)
    }
  }
  const documentCounts = new Map<string, number>()
  for (const doc of documents) {
    if (!doc.owner || !['activity','journey','accommodation'].includes(doc.owner.kind)) throw new Error('Propriétaire documentaire absent ou invalide.')
    if (typeof doc.owner.id !== 'string' || !doc.owner.id || doc.owner.id.length > 512 || !Number.isSafeInteger(doc.size) || doc.size < 1 || doc.size > MAX_DOCUMENT_BYTES) throw new Error('Métadonnées documentaires invalides.')
    const ownerKey = JSON.stringify([doc.owner.kind, doc.owner.id]); const count = (documentCounts.get(ownerKey) ?? 0) + 1; documentCounts.set(ownerKey, count)
    if (count > MAX_ACTIVITY_DOCUMENTS) throw new Error('Plus de cinq documents pour un propriétaire.')
    const parent = (doc.owner.kind === 'activity' ? acts : doc.owner.kind === 'journey' ? routes : stays).get(doc.owner.id)
    if (!parent || parent.tripId !== doc.tripId || (doc.owner.kind === 'activity' ? doc.activityId !== undefined && doc.activityId !== doc.owner.id : doc.activityId !== undefined)) throw new Error('Document sans propriétaire valide du voyage.')
  }
}
// V2 read-only projection, never exported as a second set of expenses.
export function projectLegacyTransfers(trip: Trip, journeys: readonly Journey[], versions?: ReadonlyMap<string, {identity: string; revision: number}>) {
  return journeys.filter(j => j.tripId === trip.id && j.legacy && j.stops.length === 2 && j.stops.every(s => s.link?.kind === 'activity' && s.link.state === 'linked'))
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.legacy!.id.localeCompare(b.legacy!.id))
    .map(j => ({ id: j.legacy!.id, fromActivityId: j.stops[0].link!.id, toActivityId: j.stops[1].link!.id, mode: j.segments[0].mode,
      ...(j.segments[0].durationMinutes !== undefined ? { durationMinutes: j.segments[0].durationMinutes } : {}),
      estimatedCost: j.estimatedCost, paidAmount: j.paidAmount, currency: j.currency!, notes: j.notes, createdAt: j.createdAt, updatedAt: j.updatedAt, ...(versions?.has(j.id) ? {_journeyVersion: versions.get(j.id)} : {}) }))
}
