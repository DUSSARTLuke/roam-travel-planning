import { createDocumentRepository } from '../src/db/documents'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TravelMode, type TravelDestination } from '../src/components/travel/TravelMode'
import { travelDay, travelActivities } from '../src/components/travel/travelModel'
import { timedFixture } from './dayPlanning.core'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createTripLibraryReader } from '../src/db/tripLibrary'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testTravelMode(report: (message: string) => void) {
  const trip: Trip = { id: 'travel', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '' }
  const clock = { date: '2027-01-01', time: '10:00' }
  const early = { ...timedFixture('early', '09:00', '09:30', 50), tripId: trip.id, date: clock.date, title: 'Passée' }
  const next = { ...early, id: 'next', title: 'Prochaine', startTime: '11:00', sortOrder: 100, reservationReference: 'ABC', address: 'Adresse test' }
  const flexible = { ...early, id: 'flexible', title: 'Sans heure', scheduleType: 'unscheduled' as const, period: null, startTime: undefined, endTime: undefined }
  const rows = [next, flexible, early, { ...next, id: 'foreign', tripId: 'foreign' }]
  const before = JSON.stringify(rows)
  assert(travelDay(trip, undefined, '2026-12-30').date === trip.startDate && travelDay(trip, undefined, '2027-01-03').date === trip.endDate && travelDay(trip, undefined, clock.date).date === clock.date, 'Journée futur/présent/passé incorrecte.')
  assert(travelDay(trip, trip.startDate, clock.date).date === trip.startDate && travelDay(trip, 'invalid', clock.date).date === clock.date, 'Sélection perdue ou date invalide acceptée.')
  const plan = travelActivities(trip, rows, clock.date, clock)
  assert(plan.items.map((item) => item.id).join(',') === 'early,next,flexible' && plan.nextId === 'next', 'Chronologie/ordre manuel/isolation/prochaine incorrects.')
  assert(travelActivities(trip, rows, clock.date, { ...clock, time: '12:00' }).nextId === undefined && JSON.stringify(rows) === before, 'Heure inventée ou données mutées.')
  const database = new RoamDatabase(`roam-v2-test-travel-${crypto.randomUUID()}`), read = createTripLibraryReader(database)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  let selected: string | undefined, target: TravelDestination | undefined
  const render = () => flushSync(() => root.render(<TravelMode trip={trip} selectedDate={selected} clock={clock} read={read} readDocument={createDocumentRepository(database).getDocument} onDateChange={(date) => { selected = date; render() }} navigate={(destination, date) => { target = destination; selected = date }} onClose={() => {}} />))
  const wait = async (predicate: () => boolean) => { const end = performance.now() + 6000; while (!predicate() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(predicate(), 'Mode voyage non actualisé.') }
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!
  try {
    await database.trips.add(trip); await database.activities.bulkAdd([early, next, flexible])
    await database.activityDocuments.add({ id: 'missing', activityId: next.id, name: 'Document manquant.pdf', mime: 'application/pdf', size: 20, importedAt: '2026-11-06T12:00:00.000Z' })
    window.dispatchEvent(new Event('offline')); render()
    await wait(() => host.querySelectorAll('[data-travel-activity]').length === 3)
    assert(host.textContent?.includes('jour 2 sur 3') && host.querySelector('.travel-next')?.textContent?.includes('Prochaine') && host.textContent.includes('Statut non renseigné'), 'Jour/prochaine/statut inventé.')
    flushSync(() => button('Ouvrir / télécharger Document manquant.pdf').click())
    await wait(() => Boolean(host.querySelector('dialog [role="alert"]')))
    host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); await wait(() => !host.querySelector('dialog'))
    const trigger = host.querySelector<HTMLButtonElement>('[data-travel-activity="next"] button')!
    flushSync(() => trigger.click()); await wait(() => Boolean(host.querySelector('[role="dialog"],dialog')))
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Revenir au mode voyage"]')!
    assert(close, 'Fiche existante absente.'); flushSync(() => close.click()); await wait(() => !host.querySelector('[role="dialog"],dialog'))
    assert(host.querySelector<HTMLSelectElement>('select')!.value === clock.date, 'Retour fiche perd la journée.')
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Journée suivante"]')!.click())
    assert(selected === trip.endDate && host.textContent?.includes('Aucune activité'), 'Navigation/état vide incorrect.')
    flushSync(() => button('Programme').click()); assert(target === 'program' && selected === trip.endDate, 'Raccourci perd le contexte.')
    selected = clock.date; render(); await database.activities.update(next.id, { title: 'Modifiée' }); await wait(() => host.textContent?.includes('Modifiée') === true)
    for (const width of [320, 375]) { host.style.width = `${width}px`; await new Promise((resolve) => requestAnimationFrame(resolve)); assert(host.scrollWidth <= host.clientWidth + 1, `Débordement mode voyage ${width}px.`) }
    await database.activities.delete(next.id); await wait(() => !host.querySelector('[data-travel-activity="next"]'))
    report('Mode voyage : futur/en cours/terminé, dates locales/décembre-janvier, chronologie, prochaine sans heure inventée, isolation, documents manquants, fiche/retour, sélection/raccourcis, réactivité, mobile 320/375 et offline.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete() }
}
