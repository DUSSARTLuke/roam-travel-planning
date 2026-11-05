import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLiveQuery } from 'dexie-react-hooks'
import { timedFixture } from './dayPlanning.core'
import type { TripActivity } from '../src/db/activityModel'
import type { ManualTransfer } from '../src/db/transferModel'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey } from '../src/db/transferModel'
import { assessTransferTiming, buildTransferDayPlanning, transferTimingOutsideGap } from '../src/components/program/transferAvailability'
import { DayTimeline } from '../src/components/program/DayTimeline'
import { TransferCard } from '../src/components/program/TransferCard'
import { MultiDayProgram } from '../src/components/program/MultiDayProgram'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const transferFixture = (from: TripActivity, to: TripActivity, durationMinutes?: number): ManualTransfer => ({
  id: 'transfer-timing', fromActivityId: from.id, toActivityId: to.id, mode: 'walk', currency: 'JPY', estimatedCost: 100,
  ...(durationMinutes !== undefined ? { durationMinutes } : {}), createdAt: from.createdAt, updatedAt: from.updatedAt,
})
export async function testTransferAvailability(report: (message: string) => void) {
  let checks = 0
  const check = (value: unknown, message: string) => { checks++; assert(value, message) }
  const a = { ...timedFixture('A', '09:00', '10:00'), estimatedCost: 0, paidAmount: 25, currency: 'GBP' }
  const b = timedFixture('B', '12:00', '13:00')
  const pair = [a, b]
  const raw = [...buildTransferDayPlanning(pair).gaps.values()][0]
  check(raw.state === 'raw' && raw.rawMinutes === 120, 'Créneau sans trajet modifié.')
  for (const [duration, state, remaining] of [[30, 'available', 90], [120, 'occupied', 0], [150, 'conflict', -30], [0, 'available', 120], [0.5, 'available', 119.5]] as const) {
    const transfer = transferFixture(a, b, duration)
    const timing = assessTransferTiming(transfer, pair, [transfer])
    check(timing.state === state && timing.rawMinutes === 120 && 'remainingMinutes' in timing && timing.remainingMinutes === remaining, 'Durée/égalité/déficit/zéro/précision incorrects.')
    const gap = [...buildTransferDayPlanning(pair, [transfer]).gaps.values()][0]
    check(gap.state === state && 'remainingMinutes' in gap && gap.remainingMinutes === remaining, 'Trajet non relié au créneau brut.')
    check(transferTimingOutsideGap(transfer, pair, [transfer]) === null, 'Calcul répété dans la carte et le créneau.')
  }
  const arrivalWithoutEnd = { ...b, endTime: undefined }
  const arrivalRoute = transferFixture(a, arrivalWithoutEnd, 30)
  check(assessTransferTiming(arrivalRoute, [a, arrivalWithoutEnd], [arrivalRoute]).state === 'available', 'Fin de l’arrivée exigée alors que son début suffit.')
  const missingDuration = transferFixture(a, b)
  check(assessTransferTiming(missingDuration, pair, [missingDuration]).state === 'unknown', 'Durée absente remplacée par zéro.')
  const unknownEnd = { ...a, endTime: undefined }
  check(assessTransferTiming(missingDuration, [unknownEnd, b], [missingDuration]).state === 'unknown' && !buildTransferDayPlanning([unknownEnd, b], [missingDuration]).gaps.size, 'Fin absente inventée.')
  const noTime: TripActivity = { ...a, scheduleType: 'unscheduled', startTime: undefined, endTime: undefined, period: null }
  check(assessTransferTiming(missingDuration, [noTime, b], [missingDuration]).state === 'unknown', 'Activité sans horaire convertie en horaire.')
  const period: TripActivity = { ...noTime, scheduleType: 'period', period: 'morning' }
  check(assessTransferTiming(missingDuration, [period, b], [missingDuration]).state === 'unknown', 'Période convertie en heure.')
  for (const duration of [-1, NaN, Infinity]) {
    const invalid = transferFixture(a, b, duration)
    const result = assessTransferTiming(invalid, pair, [invalid])
    check(result.state === 'unknown' && result.reason === 'invalid-duration', 'Durée invalide acceptée.')
  }
  const route = transferFixture(a, b, 30)
  const sameStart = { ...b, startTime: '09:00' }
  const simultaneous = assessTransferTiming(route, [a, sameStart], [route])
  check(simultaneous.state === 'unknown' && simultaneous.reason === 'simultaneous', 'Simultanéité traitée comme un ordre fiable.')
  const overlapping = { ...b, startTime: '09:30' }
  const conflict = buildTransferDayPlanning([a, overlapping], [route])
  check(conflict.planning.conflictCount === 2 && !conflict.gaps.size && assessTransferTiming(route, [a, overlapping], [route]).state === 'unknown', 'Chevauchement existant perdu/doublement déduit.')
  const instantInside = { ...b, startTime: '09:30', endTime: '09:30' }
  const negative = assessTransferTiming(route, [a, instantInside], [route])
  check(negative.state === 'unknown' && negative.reason === 'negative-interval', 'Intervalle négatif avec activité instantanée transformé en retard de trajet.')
  const reversed = { ...a, startTime: '14:00', endTime: '15:00' }
  const wrongOrder = assessTransferTiming(route, [reversed, b], [route])
  check(wrongOrder.state === 'unknown' && wrongOrder.reason === 'order' && [...buildTransferDayPlanning([reversed, b], [route]).gaps.values()][0].state === 'raw', 'Trajet inversé déduit.')
  const otherDay = { ...b, date: '2027-01-01' }
  const moved = assessTransferTiming(route, [a, otherDay], [route])
  check(moved.state === 'unknown' && moved.reason === 'different-day', 'Trajet inter-journées déduit.')
  check(assessTransferTiming(route, [a, { ...b, tripId: 'another-trip' }], [route]).state === 'unknown', 'Trajet inter-voyages déduit.')
  const second = { ...route, id: 'second', durationMinutes: 15 }
  const multiple = [...buildTransferDayPlanning(pair, [route, second]).gaps.values()][0]
  check(multiple.state === 'unknown' && multiple.reason === 'multiple', 'Plusieurs trajets additionnés ou choisis silencieusement.')
  const inverse = { ...route, id: 'inverse', fromActivityId: b.id, toActivityId: a.id }
  check([...buildTransferDayPlanning(pair, [route, inverse]).gaps.values()][0].state === 'available', 'Trajet inverse considéré comme doublon direct.')
  const middle = timedFixture('Intermédiaire', '11:00', '11:30')
  check([...buildTransferDayPlanning([a, middle, b], [route]).gaps.values()].every((item) => item.state === 'raw'), 'Trajet sautant une activité déduit.')
  const long = timedFixture('Longue', '08:00', '11:00')
  const covered = [...buildTransferDayPlanning([long, a, b], [route]).gaps.values()][0]
  check(covered.rawMinutes === 60 && covered.state === 'unknown', 'Créneau de l’union des activités remplacé par la fin du dernier élément.')
  const earlier = timedFixture('Fin antérieure inconnue', '08:00')
  const earlierTiming = assessTransferTiming(route, [earlier, a, b], [route])
  check(earlierTiming.state === 'unknown' && earlierTiming.reason === 'earlier-end' && !buildTransferDayPlanning([earlier, a, b], [route]).gaps.size, 'Fin inconnue précédente ignorée.')
  const touching = { ...b, startTime: '10:00' }
  const touchRoute = transferFixture(a, touching, 5)
  const touchingTiming = transferTimingOutsideGap(touchRoute, [a, touching], [touchRoute])
  check(touchingTiming?.state === 'conflict' && touchingTiming.remainingMinutes === -5, 'Déficit d’un intervalle nul non signalé.')
  const touchDuplicate = { ...touchRoute, id: 'touch-duplicate' }
  const duplicateCards = [touchRoute, touchDuplicate].map((item) => renderToStaticMarkup(<TransferCard transfer={item} transfers={[touchRoute, touchDuplicate]} activities={[a, touching]} onEdit={() => {}} />)).join('')
  check((duplicateCards.match(/plusieurs déplacements relient/g) ?? []).length === 1, 'Même alerte répétée sur chaque carte d’une paire sans intervalle.')
  const dupStart = { ...middle, startTime: b.startTime }
  const ambiguous = [...buildTransferDayPlanning([a, b, dupStart], [route]).gaps.values()][0]
  check(ambiguous.state === 'unknown', 'Arrivées simultanées ignorées dans le créneau.')
  const frozenActivities = Object.freeze(pair.map((item) => Object.freeze({ ...item })))
  const frozenTransfers = Object.freeze([Object.freeze({ ...route })])
  const original = JSON.stringify([frozenActivities, frozenTransfers])
  buildTransferDayPlanning(frozenActivities, frozenTransfers)
  check(JSON.stringify([frozenActivities, frozenTransfers]) === original, 'Données ou montants modifiés par un calcul.')
  const cards = (activity: TripActivity) => activity.id === a.id ? <TransferCard transfer={route} transfers={[route]} activities={pair} onEdit={() => {}} /> : null
  const markup = renderToStaticMarkup(<DayTimeline activities={pair} transfers={[route]} onOpen={() => {}} onEdit={() => {}} afterActivity={cards} />)
  check(markup.includes('Créneau brut : 2 h') && markup.includes('Temps libre après le déplacement : 1 h 30') && (markup.match(/Temps libre après le déplacement/g) ?? []).length === 1, 'Affichage origine/reste dupliqué ou absent.')
  const multi = renderToStaticMarkup(<MultiDayProgram days={[a.date!]} selectedDate={a.date!} activities={pair} transfers={[route]} onSelect={() => {}} onEdit={() => {}} onOpen={() => {}} />)
  check(multi.includes('Temps libre après le déplacement : 1 h 30'), 'Conversion de créneau absente de Multi-jours.')
  const unknownMarkup = renderToStaticMarkup(<DayTimeline activities={pair} transfers={[missingDuration]} onOpen={() => {}} onEdit={() => {}} />)
  check(unknownMarkup.includes('Créneau brut : 2 h') && unknownMarkup.includes('Temps disponible inconnu') && !unknownMarkup.includes('gap-available'), 'Temps inconnu présenté comme libre.')
  const occupied = renderToStaticMarkup(<DayTimeline activities={pair} transfers={[transferFixture(a, b, 120)]} onOpen={() => {}} onEdit={() => {}} />)
  check(occupied.includes('Aucun temps libre') && occupied.includes('gap-occupied'), 'Intervalle entièrement occupé mal présenté.')
  const deficit = renderToStaticMarkup(<DayTimeline activities={pair} transfers={[transferFixture(a, b, 150)]} onOpen={() => {}} onEdit={() => {}} />)
  check(deficit.includes('Il manque 30 min') && deficit.includes('gap-conflict'), 'Déficit non affiché.')
  const overlapCard = renderToStaticMarkup(<TransferCard transfer={route} transfers={[route]} activities={[a, overlapping]} onEdit={() => {}} />)
  check(!overlapCard.includes('Il manque'), 'Seconde alerte de retard contradictoire avec le chevauchement.')
  report(`Disponibilités après trajet : ${checks} contrôles purs/rendus, inconnus explicites, conflits, zéro, doublons, immutabilité et vues partagées.`)

  const database = new RoamDatabase(`roam-v2-test-transfer-time-${crypto.randomUUID()}`)
  const repo = createActivityRepository(database); const routes = createTransferRepository(database)
  const host = document.createElement('div'); host.style.width = '100%'; host.style.maxWidth = '375px'; document.body.append(host)
  const root = createRoot(host)
  const trip: Trip = { id: 'timing-trip', destination: 'Test', country: 'Test', startDate: a.date!, endDate: b.date!, travelers: 1, image: '' }
  const waitFor = async (condition: () => boolean) => {
    const end = performance.now() + 5000
    while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
    assert(condition(), 'Temps après trajet non actualisé.')
  }
  function Reactive({ multi = false }: { multi?: boolean }) {
    const data = useLiveQuery(() => database.transaction('r', database.trips, database.activities, async () => ({
      activities: await database.activities.where('tripId').equals(trip.id).toArray(), trip: await database.trips.get(trip.id),
    })), [])
    if (!data) return null
    return multi ? <MultiDayProgram days={[trip.startDate]} selectedDate={trip.startDate} activities={data.activities} transfers={data.trip?.manualTransfers} onSelect={() => {}} onEdit={() => {}} onOpen={() => {}} />
      : <DayTimeline activities={data.activities} transfers={data.trip?.manualTransfers} onEdit={() => {}} onOpen={() => {}} />
  }
  try {
    await database.trips.add(trip)
    const first = await repo.createActivity(trip.id, a)
    let last = await repo.createActivity(trip.id, b)
    let saved = await routes.saveTransfer(trip.id, { ...route, fromActivityId: first.id, toActivityId: last.id })
    const before = JSON.stringify([await database.activities.toArray(), await database.trips.toArray()])
    flushSync(() => root.render(<Reactive />))
    await waitFor(() => host.textContent?.includes('Temps libre après le déplacement : 1 h 30') === true)
    assert(JSON.stringify([await database.activities.toArray(), await database.trips.toArray()]) === before, 'Affichage a écrit des données.')
    last = await repo.updateActivity(trip.id, last.id, { ...last, startTime: '11:00' })
    await waitFor(() => host.textContent?.includes('Temps libre après le déplacement : 30 min') === true)
    saved = await routes.saveTransfer(trip.id, { ...saved, durationMinutes: 90 }, saved.id, transferKey(saved))
    await waitFor(() => host.textContent?.includes('Il manque 30 min') === true)
    flushSync(() => root.render(<Reactive multi />))
    await waitFor(() => !!host.querySelector('.program-multi') && host.textContent?.includes('Il manque 30 min') === true)
    saved = await routes.saveTransfer(trip.id, { ...saved, durationMinutes: 60 }, saved.id, transferKey(saved))
    await waitFor(() => host.textContent?.includes('Aucun temps libre') === true)
    saved = await routes.saveTransfer(trip.id, { ...saved, durationMinutes: undefined }, saved.id, transferKey(saved))
    await waitFor(() => host.textContent?.includes('durée du déplacement n’est pas renseignée') === true)
    assert(host.scrollWidth <= host.clientWidth + 1, 'Disponibilité débordante sur petit écran.')
    assert((await repo.getActivity(trip.id, first.id)).paidAmount === 25 && (await database.trips.get(trip.id))!.manualTransfers![0].estimatedCost === 100, 'Montants modifiés par effet de bord.')
    report('Réactivité des disponibilités : horaire puis durée modifiés en IndexedDB, Jour/Multi-jours, états disponible/occupé/conflit/inconnu, mobile et aucune écriture au rendu (base isolée).')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete() }
}
