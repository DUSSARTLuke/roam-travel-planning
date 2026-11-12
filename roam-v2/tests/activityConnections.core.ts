import type { Trip } from '../src/db/database'
import type { TripActivity } from '../src/db/activityModel'
import { individualConnections, buildConnectionPlan, connectionPlace, externalConnectionUrl } from '../src/routing/activityConnections'
import type { Journey } from '../src/evolution/v21/contracts'
const assert = (value: unknown, message: string) => { if (!value) throw Error(message) }
export const connectionTrip: Trip = { id: 'connections', destination: 'Test B1', country: 'Test', startDate: '2028-02-29', endDate: '2028-03-01', travelers: 2, image: '', participants: [{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }] }
export function connectionActivity(id: string, startTime = '09:00', endTime = '10:00', participantIds?: string[]): TripActivity {
  return { id, tripId: connectionTrip.id, title: id, date: connectionTrip.startDate, scheduleType: 'exact', startTime, endTime, period: null, category: 'visit', participantIds, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z' }
}
export function connectionJourney(from: TripActivity, to: TripActivity, participantIds?: string[], id = 'connection-1'): Journey {
  return { id, tripId: from.tripId, title: `${from.title} → ${to.title}`, purpose: 'activity-connection', participantIds,
    stops: [from, to].map((row, index) => ({ id: `${id}:s${index}`, kind: 'activity', link: { kind: 'activity', id: row.id, state: 'linked' }, place: connectionPlace(row) })),
    segments: [{ id: `${id}:edge`, fromStopId: `${id}:s0`, toStopId: `${id}:s1`, mode: 'walk', durationMinutes: 15, durationSource: 'manual', safetyMarginMinutes: 5, distanceMeters: 1200 }],
    departure: { date: from.date! }, arrival: { date: to.date! }, createdAt: from.createdAt, updatedAt: from.updatedAt }
}
export function testActivityConnectionsCore(report: (message: string) => void) {
  const a = connectionActivity('A'), b = connectionActivity('B', '10:15', '11:00'), c = connectionActivity('C', '11:15', '12:00')
  const pairs = individualConnections(connectionTrip, [c, a, b])
  assert(pairs.length === 2 && pairs[0].participantIds?.length === 2 && pairs[0].from.id === 'A', 'Collective ordering/deduplication')
  const solo = individualConnections(connectionTrip, [{ ...a, participantIds: ['alice'] }, { ...b, participantIds: ['alice'] }])
  assert(solo.length === 1 && solo[0].participantIds?.join() === 'alice', 'Individual succession')
  assert(individualConnections(connectionTrip, [{ ...a, participantIds: ['alice'] }, { ...b, participantIds: ['bob'] }]).length === 0, 'Disjoint travelers linked')
  const branch = [{ ...a }, { ...b, id: 'Alice B', participantIds: ['alice'] }, { ...b, id: 'Bob C', participantIds: ['bob'] }, c]
  const divergent = individualConnections(connectionTrip, branch)
  assert(divergent.length === 4 && !divergent.some(pair => pair.from.id === 'Alice B' && pair.to.id === 'Bob C'), 'Divergence/convergence and disjoint simultaneous events')
  assert(individualConnections(connectionTrip, [a, { ...b, startTime: '09:30' }, c]).length === 0, 'Ambiguous overlap routed')
  assert(individualConnections(connectionTrip, [a, { ...b, date: '2028-03-01' }]).length === 0, 'Cross-day route')
  assert(individualConnections(connectionTrip, [a, { ...b, participantIds: [] }]).length === 0, 'Empty participants treated collective')
  assert(individualConnections({ ...connectionTrip, participants: undefined }, [a, b])[0].participantIds === undefined, 'Legacy virtual collective')
  const free = { ...a, scheduleType: 'unscheduled' as const, period: null, startTime: undefined, endTime: undefined, sortOrder: 1 }
  const freeB = { ...free, id: 'Free B', title: 'Free B', sortOrder: 2 }
  assert(individualConnections(connectionTrip, [freeB, free])[0].from.id === 'A' && individualConnections(connectionTrip, [free, freeB])[0].uncertain, 'Unscheduled manual order')
  assert(individualConnections(connectionTrip, [{ ...free, sortOrder: 3 }, freeB])[0].from.id === 'Free B', 'Reorder ignored')
  const journey = connectionJourney(a, b, ['alice'])
  const plan = buildConnectionPlan(connectionTrip, [a, b], [journey])
  assert(plan.saved.length === 1 && plan.available[0].participantIds?.join() === 'bob', 'Different journeys by traveler unavailable')
  assert(buildConnectionPlan(connectionTrip, [a, b], [connectionJourney(a, b, ['alice', 'bob'])]).available.length === 0, 'Existing route duplicated')
  assert(buildConnectionPlan(connectionTrip, [a, b, { ...c, startTime: '10:05', endTime: '10:10' }], [journey]).saved[0].stale, 'Changed successor not flagged')
  assert(buildConnectionPlan(connectionTrip, [a], [journey]).saved[0].stale, 'Deleted activity not flagged')
  assert(buildConnectionPlan(connectionTrip, [{ ...a, address: 'Nouveau lieu' }, b], [journey]).saved[0].stale, 'Changed place not flagged')
  assert(buildConnectionPlan(connectionTrip, [a, { ...b, participantIds: ['bob'] }], [journey]).saved[0].stale, 'Changed participants not flagged')
  assert(!externalConnectionUrl(a, b, 'walk'), 'Missing place generates misleading link')
  assert(externalConnectionUrl({ ...a, latitude: 0, longitude: 0 }, { ...b, address: 'Test & adresse' }, 'transit')?.includes('travelmode=transit'), 'External link encoding / GPS zero')
  assert(!externalConnectionUrl({ ...a, address: 'A' }, { ...b, address: 'B' }, 'plane'), 'Unsupported mode external route')
  report('B1 pur : collectifs/individuels, simultanéité, divergence/convergence, ordre manuel incertain, GPS absent/zéro, mutualisation, changements et suppressions, aucune traversée de journée.')
}
