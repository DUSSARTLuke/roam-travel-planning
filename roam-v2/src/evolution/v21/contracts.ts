// V2.1 contracts only. Not registered with Dexie or consumed by the UI.
import type { ReservationStatus } from '../../db/activityModel'
import type { DocumentMime } from '../../db/documentModel'
import { validateCoordinates } from '../../db/activityLocation'
import { isActivityDate } from '../../db/activityModel'
import { validateCurrency } from '../../db/currency'
import { transferModes, type TransferMode } from '../../db/transferModel'

export type Owner = { kind: 'activity' | 'journey' | 'accommodation'; id: string }
export type Place = { name: string; address?: string; latitude?: number; longitude?: number }
export type PlaceLink = { kind: 'activity' | 'accommodation'; id: string; state: 'linked' | 'deleted' }
export type LocalMoment = { date: string; time?: string; timeZone?: string }
export type Money = { estimatedCost?: number; paidAmount?: number; currency?: string }
export type Reservation = {
  status?: ReservationStatus; reference?: string; provider?: string; people?: number
  deadline?: string; notes?: string
}
export type JourneyStop = { id: string; place: Place; kind: 'home' | 'station' | 'airport' | 'accommodation' | 'activity' | 'free'; link?: PlaceLink }
export type JourneySegment = { id: string; fromStopId: string; toStopId: string; mode: TransferMode; durationMinutes?: number }
export type Journey = Money & {
  id: string; tripId: string; title: string; stops: JourneyStop[]; segments: JourneySegment[]
  departure?: LocalMoment; arrival?: LocalMoment; reservation?: Reservation; notes?: string
  createdAt: string; updatedAt: string
  legacy?: { kind: 'manualTransfer'; tripId: string; id: string }
}
export type Accommodation = Money & {
  id: string; tripId: string; place: Place; arrivalDate: string; departureDate: string
  checkInTime?: string; checkOutTime?: string; reservation?: Reservation; notes?: string
  createdAt: string; updatedAt: string
}
export type OwnedDocument = { id: string; tripId: string; owner: Owner; name: string; mime: DocumentMime; size: number; importedAt: string }
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export function assertPlace(place: Place): void {
  if (typeof place.name !== 'string' || !place.name.trim()) throw new Error('Nom de lieu obligatoire.')
  if (place.address !== undefined && typeof place.address !== 'string') throw new Error('Adresse invalide.')
  validateCoordinates(place.latitude, place.longitude)
}
export function assertMoney(money: Money): void {
  for (const value of [money.estimatedCost, money.paidAmount]) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error('Montant invalide.')
  if (money.currency !== undefined && validateCurrency(money.currency) !== money.currency) throw new Error('Devise non normalisée.')
}
function assertMoment(moment: LocalMoment): void {
  if (!isActivityDate(moment.date) || (moment.time !== undefined && !time.test(moment.time))) throw new Error('Date ou heure locale invalide.')
  if (moment.timeZone !== undefined) {
    try { new Intl.DateTimeFormat('fr', { timeZone: moment.timeZone }).format(0) }
    catch { throw new Error('Fuseau horaire invalide.') }
  }
}
export function assertReservation(reservation: Reservation | undefined): void {
  if (!reservation) return
  if (reservation.status !== undefined && !['not_required', 'to_book', 'pending', 'confirmed', 'cancelled'].includes(reservation.status)) throw new Error('Statut de réservation invalide.')
  if (reservation.people !== undefined && (!Number.isSafeInteger(reservation.people) || reservation.people <= 0)) throw new Error('Nombre de personnes invalide.')
  if (reservation.deadline !== undefined && !isActivityDate(reservation.deadline)) throw new Error('Échéance de réservation invalide.')
  for (const text of [reservation.reference, reservation.provider, reservation.notes]) if (text !== undefined && typeof text !== 'string') throw new Error('Détail de réservation invalide.')
}
function assertEntity(entity: { id: string; tripId: string; createdAt: string; updatedAt: string }): void {
  if (![entity.id, entity.tripId].every(value => typeof value === 'string' && value.trim().length > 0)) throw new Error('Identité ou voyage absent.')
  for (const value of [entity.createdAt, entity.updatedAt]) {
    if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Date technique invalide.')
  }
}
export function assertJourney(journey: Journey): void {
  assertEntity(journey); assertReservation(journey.reservation)
  if (!journey.title.trim()) throw new Error('Titre du déplacement obligatoire.')
  assertMoney(journey)
  if (journey.stops.length < 2 || journey.stops.length > 100) throw new Error('Deux à cent étapes requises.')
  const ids = new Set(journey.stops.map(stop => stop.id))
  if (ids.size !== journey.stops.length || ids.has('')) throw new Error('Identifiant d’étape dupliqué ou vide.')
  journey.stops.forEach(stop => assertPlace(stop.place))
  if (journey.segments.length !== journey.stops.length - 1) throw new Error('Un segment par paire d’étapes consécutives requis.')
  const segments = new Set<string>()
  journey.segments.forEach((segment, i) => {
    if (!Object.hasOwn(transferModes, segment.mode)) throw new Error('Mode de transport invalide.')
    if (!segment.id || segments.has(segment.id)) throw new Error('Segment dupliqué ou vide.')
    segments.add(segment.id)
    if (segment.fromStopId !== journey.stops[i].id || segment.toStopId !== journey.stops[i + 1].id) throw new Error('Segment non consécutif.')
    if (segment.durationMinutes !== undefined && (!Number.isFinite(segment.durationMinutes) || segment.durationMinutes < 0)) throw new Error('Durée invalide.')
  })
  if (journey.departure) assertMoment(journey.departure)
  if (journey.arrival) assertMoment(journey.arrival)
  // No elapsed-time inference: local moments may belong to different time zones.
}
export function assertAccommodation(stay: Accommodation): void {
  assertEntity(stay); assertReservation(stay.reservation)
  assertPlace(stay.place); assertMoney(stay)
  if (!isActivityDate(stay.arrivalDate) || !isActivityDate(stay.departureDate) || stay.departureDate < stay.arrivalDate) throw new Error('Période de séjour invalide.')
  if ([stay.checkInTime, stay.checkOutTime].some(value => value !== undefined && !time.test(value))) throw new Error('Horaire de séjour invalide.')
}
// Pure proposal: caller must verify target ownership/revision and persist atomically.
// Keep the last snapshot and costs; never cascade-delete a journey.
export function detachJourneyPlace(journey: Journey, deleted: Owner): Journey {
  return { ...journey, stops: journey.stops.map(stop => stop.link?.kind === deleted.kind && stop.link.id === deleted.id
    ? { ...stop, place: { ...stop.place }, link: { ...stop.link, state: 'deleted' as const } } : stop) }
}
