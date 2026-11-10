import assert from 'node:assert/strict'
import { planV6, planZip1To2 } from '../src/evolution/v21/migrationPlan'
import { assertJourney, assertAccommodation, detachJourneyPlace } from '../src/evolution/v21/contracts'
import { buildTripBudget } from '../src/money/tripBudget'
function paid(budget: ReturnType<typeof buildTripBudget>) {
  if (budget.totals.status !== 'calculated') throw new Error('Budget invalide dans la fixture')
  return budget.totals.paid
}
const at = '2026-11-10T00:00:00.000Z'
const trip = { id: 't', destination: 'Paris', country: 'France', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '', manualTransfers: [
  { id: 'transfer', fromActivityId: 'a', toActivityId: 'b', mode: 'train' as const, currency: 'EUR', estimatedCost: 20, paidAmount: 7, durationMinutes: 0, createdAt: at, updatedAt: at },
] }
const activity = (id: string) => ({ id, tripId: 't', title: id, category: 'other' as const, date: '2026-12-31', scheduleType: 'unscheduled' as const, period: null, sortOrder: 0, createdAt: at, updatedAt: at, latitude: 0, longitude: -1 })
const activities = [activity('a'), activity('b')]
// Regression first: a stored payment must not disappear from transfer totals.
const budget = buildTripBudget(trip, activities)
assert.equal(paid(budget).amount, 7, 'paidAmount du déplacement perdu dans le Budget')
console.log('PASS budget : paiement transfert, sans double comptage')
const source = { databaseVersion: 5 as const, trips: [trip], activities, documents: [{ id: 'd', activityId: 'a', name: 'ticket.pdf', mime: 'application/pdf' as const, size: 5, importedAt: at }], blobIds: ['d'] }
const before = structuredClone(source), plan = planV6(source)
assert.deepEqual(source, before)
assert.deepEqual(plan, planV6(source), 'Simulation non déterministe')
assert.equal(plan.journeys.length, 1); assert.equal(plan.journeys[0].paidAmount, 7)
assert.equal(plan.journeys[0].segments[0].durationMinutes, 0)
assert.equal(plan.journeys[0].departure?.time, undefined)
assert.equal(plan.journeys[0].stops[0].place.latitude, 0)
assert.deepEqual(plan.documents[0].owner, { kind: 'activity', id: 'a' })
assert.equal(plan.documents[0].id, 'd'); assert.deepEqual(plan.blobIds, ['d'])
assert(!('manualTransfers' in plan.trips[0])); assert.deepEqual(plan.activities, activities)
assert.equal(planZip1To2(1, { ...source, databaseVersion: 4 }).formatVersion, 2)
assert.throws(() => planZip1To2(2, source)); assert.throws(() => planV6({ ...source, blobIds: [] }))
assert.throws(() => planV6({ ...source, activities: [activities[0]] }))
assert.throws(() => planV6({ ...source, documents: [...source.documents, ...source.documents] }))
const detached = detachJourneyPlace(plan.journeys[0], { kind: 'activity', id: 'a' })
assert.equal(detached.stops[0].link?.state, 'deleted')
assert.deepEqual(detached.stops[0].place, plan.journeys[0].stops[0].place)
assert.equal(detached.paidAmount, 7); assert.equal(plan.journeys[0].stops[0].link?.state, 'linked')
assert.throws(() => assertJourney({ ...detached, stops: [detached.stops[0]] }))
assert.throws(() => assertJourney({ ...detached, segments: [{ ...detached.segments[0], toStopId: 'absent' }] }))
assert.throws(() => assertJourney({ ...detached, paidAmount: NaN }))
const stay = { id: 'hotel', tripId: 't', place: { name: 'Hôtel', latitude: 0, longitude: 0 }, arrivalDate: '2026-12-31', departureDate: '2027-01-02', checkInTime: '15:00', estimatedCost: 0, createdAt: at, updatedAt: at }
assertAccommodation(stay)
assert.throws(() => assertAccommodation({ ...stay, departureDate: '2026-12-30' }))
assert.throws(() => assertAccommodation({ ...stay, place: { name: 'X', latitude: 1 } }))
assert.throws(() => assertAccommodation({ ...stay, checkOutTime: '25:00' }))
assert.equal(planV6({ databaseVersion: 5, trips: [], activities: [], documents: [], blobIds: [] }).journeys.length, 0)
console.log('PASS contrats, suppression non destructive, simulation V4/V5→V6 et ZIP1→2 ; aucune base ouverte')
const withPayment = (paidAmount: number | undefined, currency = 'EUR') => buildTripBudget({ ...trip, manualTransfers: [{ ...trip.manualTransfers[0], currency, paidAmount }] }, activities)
assert.equal(paid(withPayment(0)).amount, 0)
assert.equal(paid(withPayment(undefined)).amount, null)
assert.equal(paid(withPayment(7, 'JPY')).amount, null)
assert.equal(paid(withPayment(7, 'JPY')).excluded.length, 1)
assert.equal(paid(buildTripBudget({ ...trip, manualTransfers: [trip.manualTransfers[0], trip.manualTransfers[0]] }, activities)).amount, 7)
const automaticTrip = { ...trip, manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.01, updatedAt: at }], manualTransfers: [{ ...trip.manualTransfers[0], currency: 'JPY' }] }
assert.equal(paid(buildTripBudget(automaticTrip, activities)).amount, 0.07)
assertJourney({ ...detached, stops: [...detached.stops, { id: 'end', kind: 'free', place: { name: 'Domicile' } }], segments: [...detached.segments, { id: 'second', fromStopId: detached.stops[1].id, toStopId: 'end', mode: 'walk' }], departure: { date: '2026-12-31', time: '23:00' }, arrival: { date: '2027-01-01', time: '01:00' } })
assert.throws(() => assertJourney({ ...detached, segments: [{ ...detached.segments[0], mode: 'invalid' as never }] }))
assert.throws(() => assertAccommodation({ ...stay, reservation: { people: 0 } }))
const housingLinked = { ...detached, stops: [{ ...detached.stops[0], link: { kind: 'accommodation' as const, id: 'hotel', state: 'linked' as const } }, detached.stops[1]] }
assert.equal(detachJourneyPlace(housingLinked, { kind: 'accommodation', id: 'hotel' }).stops[0].link?.state, 'deleted')
const second = { ...trip, id: 'other', manualTransfers: trip.manualTransfers.map(t => ({ ...t, fromActivityId: 'c', toActivityId: 'd' })) }
const multi = planV6({ databaseVersion: 5, trips: [trip, second], activities: [...activities, { ...activity('c'), tripId: 'other' }, { ...activity('d'), tripId: 'other' }], documents: [], blobIds: [] })
assert.equal(new Set(multi.journeys.map(j => j.id)).size, 2, 'Collision d’identifiants entre voyages')
const sharing = { ...trip, participants: [{ id: 'p', name: 'Personne' }], expenseShares: [{ kind: 'transfer' as const, expenseId: 'transfer', payerId: 'p', shares: [{ participantId: 'p', weight: 1 }], amount: 7, currency: 'EUR', updatedAt: at }] }
const sharedPlan = planV6({ ...source, trips: [sharing] })
assert.equal(sharedPlan.trips[0].expenseShares?.[0].kind, 'journey')
assert.equal(sharedPlan.trips[0].expenseShares?.[0].expenseId, sharedPlan.journeys[0].id)
const drift = planV6({ ...source, activities: [activities[0], { ...activities[1], date: '2027-01-01' }] })
assert.equal(drift.journeys[0].arrival?.date, '2027-01-01')
const legacyNoDate = planV6({ ...source, activities: activities.map(a => ({ ...a, date: null })) })
assert.equal(legacyNoDate.journeys[0].departure, undefined)
assert.equal(legacyNoDate.journeys[0].arrival, undefined)
const jsonPlan = JSON.parse(JSON.stringify(planZip1To2(1, source)))
assert.equal(jsonPlan.payload.journeys[0].stops[0].place.latitude, 0)
assert.equal(jsonPlan.payload.journeys[0].paidAmount, 7)
const large = { ...trip, manualTransfers: Array.from({ length: 1000 }, (_, index) => ({ ...trip.manualTransfers[0], id: `t${index}` })) }
assert.equal(planV6({ ...source, trips: [large] }).journeys.length, 1000)
console.log('PASS devises/absent/zéro, segments/nuit, partages, isolation, dates historiques et simulation 1000 trajets')

const marker = [{ key: 'initialization', initialized: true }]
assert.deepEqual(planV6({ ...source, metadata: marker }).metadata, marker)
assert.deepEqual(planV6({ ...source, trips: [{ ...trip, manualTransfers: undefined }] }).journeys, [])
assert.throws(() => planV6({ ...source, trips: [{ ...trip, manualTransfers: [...trip.manualTransfers, ...trip.manualTransfers] }] }))
assert.throws(() => planV6({ ...source, activities: [{ ...activities[0], tripId: 'absent' }, activities[1]] }))
assert.throws(() => planV6({ ...source, blobIds: ['d', 'orphan'] }))
assert.deepEqual(source, before)
console.log('PASS métadonnées, voyage sans transfert, orphelins et doublons refusés sans mutation')
