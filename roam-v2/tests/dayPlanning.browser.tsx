import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLiveQuery } from 'dexie-react-hooks'
import { RoamDatabase } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { DayTimeline } from '../src/components/program/DayTimeline'
import { timedFixture } from './dayPlanning.core'
import '../src/components/program/program.css'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testDayPlanningUI(report: (message: string) => void) {
  const fixture = [timedFixture('Après', '12:00', '13:00'), timedFixture('Avant', '09:00', '10:00'),
    { ...timedFixture('Matin', '08:00'), scheduleType: 'period' as const, period: 'morning' as const, startTime: undefined }]
  const markup = renderToStaticMarkup(<DayTimeline activities={fixture} onEdit={() => {}} onOpen={() => {}} />)
  assert(markup.indexOf('Avant') < markup.indexOf('Après') && markup.includes('À organiser') && markup.includes('Créneau libre'), 'Structure chronologique/sections absentes.')
  const overlap = renderToStaticMarkup(<DayTimeline activities={[timedFixture('A', '09:00', '11:00'), timedFixture('B', '10:00', '12:00')]} onEdit={() => {}} onOpen={() => {}} />)
  assert(overlap.includes('Chevauchement') && overlap.includes('horaires en conflit'), 'Conflit non lisible.')
  const unknown = renderToStaticMarkup(<DayTimeline activities={[timedFixture('Inconnu', '09:00')]} onEdit={() => {}} onOpen={() => {}} />)
  assert(unknown.includes('Fin non renseignée') && !unknown.includes('Créneau libre'), 'Durée absente mal représentée.')
  const host = document.createElement('div'); host.style.width = '100%'; host.style.maxWidth = '375px'; document.body.append(host)
  const previousFocus = document.activeElement
  const root = createRoot(host)
  let opened = ''; let edited = ''; let adds = 0
  const database = new RoamDatabase(`roam-v2-test-planning-${crypto.randomUUID()}`)
  const repository = createActivityRepository(database)
  const callbacks = { onOpen: (activity: { id: string }) => { opened = activity.id }, onEdit: (activity: { id: string }) => { edited = activity.id } }
  const waitFor = async (condition: () => boolean) => {
    const limit = performance.now() + 4000
    while (!condition() && performance.now() < limit) await new Promise((resolve) => setTimeout(resolve, 20))
    assert(condition(), 'Planning réactif non actualisé.')
  }
  function ReactiveDay({ day }: { day: string }) {
    const activities = useLiveQuery(() => repository.listActivities('planning-trip', day), [day])
    return <DayTimeline activities={activities ?? []} {...callbacks} />
  }
  try {
    flushSync(() => root.render(<DayTimeline activities={[]} {...callbacks} onAdd={() => { adds++ }} />))
    assert(host.textContent?.includes('Aucune activité'), 'État vide absent.')
    flushSync(() => host.querySelector<HTMLButtonElement>('button')!.click()); assert(adds === 1, 'Ajout depuis état vide perdu.')
    flushSync(() => root.render(<DayTimeline activities={fixture} {...callbacks} />))
    const open = host.querySelector<HTMLButtonElement>('[aria-label="Consulter l’activité Avant"]')!
    assert(open && open.type === 'button' && open.getAttribute('aria-haspopup') === 'dialog', 'Accès fiche au clavier perdu.')
    open.focus(); assert(document.activeElement === open, 'Carte non accessible au focus.')
    flushSync(() => open.click()); assert(opened === 'Avant', 'Ouverture de fiche incorrecte.')
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Modifier l’activité Avant"]')!.click())
    assert(edited === 'Avant' && opened === 'Avant', 'Action de modification perdue ou propagée.')
    assert(host.querySelectorAll('time').length >= 4, 'Horaires non balisés.')
    const longTitle = 'Une activité avec un titre très long et une localisation détaillée pour vérifier les petits écrans'
    flushSync(() => root.render(<DayTimeline activities={[{ ...timedFixture('Long', '09:00', '11:00'), title: longTitle, location: longTitle }, timedFixture('Conflit', '10:00', '12:00')]} {...callbacks} />))
    assert(host.scrollWidth <= host.clientWidth + 1, 'Le planning déborde horizontalement avec un long contenu.')
    if (window.matchMedia('(max-width: 640px)').matches) {
      const button = host.querySelector<HTMLButtonElement>('.activity-edit')!
      assert(button.getBoundingClientRect().height >= 44, 'Action tactile trop petite.')
    }
    await database.open()
    await database.trips.add({ id: 'planning-trip', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 1, image: '' })
    const first = await repository.createActivity('planning-trip', timedFixture('Début', '09:00', '10:00'))
    const second = await repository.createActivity('planning-trip', timedFixture('Suite', '12:00', '13:00'))
    await repository.createActivity('planning-trip', { ...timedFixture('Autre jour', '07:00', '08:00'), date: '2027-01-01' })
    flushSync(() => root.render(<ReactiveDay day="2026-12-31" />))
    await waitFor(() => host.querySelectorAll('.day-timeline-item').length === 2)
    assert(host.querySelector('.day-timeline-item h3')?.textContent === 'Début' && host.querySelector('.day-timeline-free'), 'Ordre/créneau initial incorrect.')
    await repository.updateActivity('planning-trip', second.id, { ...second, startTime: '08:00', endTime: '08:30' })
    await waitFor(() => host.querySelector('.day-timeline-item h3')?.textContent === 'Suite')
    assert(host.querySelector('.day-timeline-free')?.textContent?.includes('08:30') && host.querySelector('.day-timeline-free')?.textContent?.includes('30 min'), 'Créneau non recalculé après modification.')
    await repository.updateActivity('planning-trip', first.id, { ...first, startTime: '08:15', endTime: '10:00' })
    await waitFor(() => host.textContent?.includes('Chevauchement') === true)
    assert(!host.querySelector('.day-timeline-free'), 'Créneau conservé malgré chevauchement.')
    flushSync(() => root.render(<ReactiveDay day="2027-01-01" />))
    await waitFor(() => host.querySelector('.day-timeline-item h3')?.textContent === 'Autre jour')
    assert(host.querySelectorAll('.day-timeline-item').length === 1, 'Activités mélangées entre journées.')
    report('UI planning : sections/horaires, fiches/actions/focus, ajout vide, useLiveQuery après modification, conflits et changement de journée (base isolée).')
  } finally {
    flushSync(() => root.unmount()); host.remove(); database.close(); await database.delete()
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
  }
}
