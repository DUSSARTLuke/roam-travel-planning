import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { TripOverview } from '../src/components/dashboard/TripOverview'
import { buildTripOverview, localClock, tripProgress, type LocalClock } from '../src/components/dashboard/overviewModel'
import { timedFixture } from './dayPlanning.core'
import { connection } from '../src/pwa/connection'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testTripOverview(report: (message: string) => void) {
  const trip: Trip = { id: 'overview', destination: 'Londres', country: 'Royaume-Uni', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '', referenceCurrency: 'EUR', plannedBudget: { amount: 50, currency: 'EUR' } }
  const a = { ...timedFixture('past', '09:00', '10:00'), tripId: trip.id, date: '2026-12-31', title: 'Déjà passée', currency: 'EUR', estimatedCost: 100, paidAmount: 40 }
  const b = { ...a, id: 'next', date: '2027-01-01', startTime: '12:00', endTime: '13:00', title: 'Prochaine', reservationStatus: 'confirmed' as const }
  const c = { ...a, id: 'later', date: '2027-01-02', title: 'Plus tard', reservationReference: 'ABC', paidAmount: undefined }
  const idea = { ...a, id: 'idea', date: null, scheduleType: 'unscheduled' as const, startTime: undefined, endTime: undefined, period: null, title: 'Idée' }
  const unTimed = { ...idea, id: 'untimed', date: '2027-01-01', title: 'Sans horaire' }
  const foreign = { ...b, id: 'foreign', tripId: 'other', startTime: '11:01', title: 'Autre voyage' }
  const outside = { ...b, id: 'outside', date: '2027-02-01', reservationStatus: undefined }
  const rows = [c, a, idea, foreign, unTimed, b, outside]
  const original = JSON.stringify([trip, rows])
  const before = tripProgress(trip, '2026-12-30'), during = tripProgress(trip, '2027-01-01'), after = tripProgress(trip, '2027-01-03')
  assert(before.status === 'before' && before.until === 1 && before.days === 3, 'Compte à rebours incorrect.')
  assert(during.status === 'during' && during.day === 2 && during.days === 3 && after.status === 'after', 'Jour du voyage/fin incorrects.')
  const dst = tripProgress({ startDate: '2026-03-28', endDate: '2026-03-30' }, '2026-03-29')
  assert(dst.status === 'during' && dst.days === 3 && dst.day === 2, 'Changement d’heure altère les jours civils.')
  const local = localClock(new Date(2027, 0, 1, 0, 1))
  assert(local.date === '2027-01-01' && local.time === '00:01', 'Horloge locale décalée par UTC.')
  assert(tripProgress({ startDate: 'invalid', endDate: trip.endDate }, local.date).status === 'invalid', 'Dates invalides acceptées.')
  const overview = buildTripOverview(trip, rows, { date: '2027-01-01', time: '11:00' })
  assert(overview.next?.id === b.id && overview.flexible?.id === unTimed.id && overview.untimed === 1 && overview.ideas === 1, 'Prochaine activité confondue avec première/horaire inventé/isolation.')
  assert(overview.reservationCounts.confirmed === 1 && overview.reservationCounts.unknown === 1 && overview.reservations.length === 2, 'Réservation supposée confirmée.')
  assert(buildTripOverview(trip, [unTimed, idea], { date: '2027-01-01', time: '11:00' }).next === null, 'Horaire inventé pour activité sans heure.')
  assert(buildTripOverview(trip, rows, { date: '2027-01-01', time: '12:01' }).next?.id === c.id, 'Activité passée présentée prochaine.')
  assert(buildTripOverview(trip, rows, { date: '2027-01-03', time: '00:00' }).next === null, 'Activité hors séjour présentée prochaine.')
  const morning = { ...unTimed, id: 'morning', scheduleType: 'period' as const, period: 'morning' as const }
  assert(buildTripOverview(trip, [morning], { date: '2027-01-01', time: '08:00' }).next === null, 'Créneau matin transformé en heure inventée.')
  assert(JSON.stringify([trip, rows]) === original, 'Tableau de bord modifie les données.')

  const database = new RoamDatabase(`roam-v2-test-overview-${crypto.randomUUID()}`), repository = createActivityRepository(database)
  const host = document.createElement('div'); host.className = 'trip-dashboard'; document.body.append(host)
  const root = createRoot(host), offline = connection.getSnapshot().offline
  let reads = 0, destination = ''
  const readActivities = async (tripId: string) => { reads++; return repository.listActivities(tripId) }
  let clock: LocalClock = { date: '2027-01-01', time: '11:00' }
  const render = (currentTrip = trip) => flushSync(() => root.render(<TripOverview key={currentTrip.id} trip={currentTrip} readActivities={readActivities} clock={clock} navigate={(tab) => { destination = tab }} />))
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((done) => setTimeout(done, 20)); assert(condition(), 'Accueil non actualisé.') }
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === name)!
  try {
    await database.trips.add(trip)
    const other: Trip = { ...trip, id: 'other', plannedBudget: undefined }
    await database.trips.add(other)
    await repository.createActivity(trip.id, a)
    const upcoming = await repository.createActivity(trip.id, b)
    await repository.createActivity(trip.id, c)
    await repository.createActivity(trip.id, idea)
    await repository.createActivity(trip.id, unTimed)
    window.dispatchEvent(new Event('offline')); render()
    await wait(() => host.textContent?.includes('Prochaine') === true && host.textContent.includes('Estimé connu'))
    assert(host.textContent?.includes('Jour 2 sur 3') && host.textContent.includes('Synthèse incomplète') && host.textContent.includes('Dépassement connu'), 'Accueil perd suivi du séjour/budget incomplet.')
    assert(host.textContent?.includes('Sans heure précise à consulter') && host.textContent.includes('Sans horaire'), 'Activité sans heure masquée ou horaire inventé.')
    assert(host.textContent?.includes('Statut non renseigné'), 'Statut absent masqué.')
    const initialReads = reads
    clock = { date: '2027-01-01', time: '12:01' }; render()
    assert(host.querySelector('#overview-next')?.parentElement?.textContent?.includes('Plus tard'), 'Passage de l’heure non réactif.')
    assert(reads === initialReads, 'Horloge provoque une nouvelle requête IndexedDB.')
    clock = { date: '2027-01-01', time: '11:00' }; render()
    flushSync(() => button('Voir l’activité').click())
    await wait(() => Boolean(host.querySelector('dialog[open]')))
    assert(host.querySelector('dialog h2')?.textContent === 'Prochaine', 'Mauvaise fiche ouverte.')
    await repository.updateActivity(trip.id, upcoming.id, { ...upcoming, title: 'Prochaine modifiée' })
    await wait(() => host.querySelector('dialog h2')?.textContent === 'Prochaine modifiée')
    flushSync(() => button(' Modifier l’activité').click())
    await wait(() => Boolean(host.querySelector('dialog form')))
    assert(host.querySelectorAll('dialog[open]').length === 1, 'Panneaux de fiche et modification superposés.')
    flushSync(() => button('Annuler').click())
    await wait(() => host.querySelector('dialog h2')?.textContent === 'Prochaine modifiée')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(!host.querySelector('dialog[open]') && document.activeElement === button('Voir l’activité'), 'Fermeture/focus de fiche incorrects.')
    flushSync(() => button('Consulter le Programme').click()); assert(destination === 'program', 'Raccourci Programme incorrect.')
    flushSync(() => button('Ouvrir le Budget et ses conversions').click()); assert(destination === 'budget', 'Raccourci Budget incorrect.')
    flushSync(() => button('Voir l’activité').click())
    await repository.deleteActivity(trip.id, upcoming.id)
    await wait(() => !host.querySelector('dialog[open]'))
    clock = { date: '2027-01-03', time: '00:00' }; render()
    assert(host.textContent?.includes('Voyage terminé'), 'Fin de séjour non actualisée.')
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); assert(host.scrollWidth <= host.clientWidth + 1, 'Accueil déborde sur mobile.') }
    render(other)
    await wait(() => host.textContent?.includes('Aucune information de réservation enregistrée') === true)
    assert(!host.textContent?.includes('Prochaine modifiée') && host.textContent?.includes('Aucun montant de dépense') && host.textContent?.includes('Aucun budget prévisionnel'), 'Changement de voyage/états vides incorrects.')
    const failed = async () => { throw new Error('Erreur lecture simulée') }
    flushSync(() => root.render(<TripOverview trip={other} readActivities={failed} clock={clock} navigate={() => {}} />))
    await wait(() => Boolean(host.querySelector('[role="alert"]')))
    assert(!host.textContent?.includes('Estimé connu') && host.textContent?.includes('Réessayer les informations'), 'Échec présenté comme budget vide.')
    report('Accueil : avant/pendant/après, jours civils/DST/minuit, prochaine réelle et sans horaire, réservations sans statut inventé, Budget 2.8/incomplet, fiche/focus/réactivité/suppression, isolation, erreurs, navigation, offline et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
