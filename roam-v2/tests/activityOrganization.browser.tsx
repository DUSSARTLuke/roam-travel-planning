import { OrganizationContext } from '../src/components/program/organizationContext'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { schedulingKey, reorderActivities } from '../src/db/activityOrganization'
import { compareActivities, type TripActivity } from '../src/db/activityModel'
import { buildDayPlanning } from '../src/components/program/dayPlanning'
import { ActivityOrganizationPanel } from '../src/components/program/ActivityOrganization'
import { ActivityList } from '../src/components/program/ActivityList'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Organisation invalide acceptée.') }
export async function testActivityOrganization(report: (message: string) => void) {
  const database = new RoamDatabase(`roam-v2-test-organization-${crypto.randomUUID()}`)
  const target = new RoamDatabase(`roam-v2-test-organization-target-${crypto.randomUUID()}`)
  const repo = createActivityRepository(database)
  const trip: Trip = { id: 'organization-trip', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const trigger = document.createElement('button'); document.body.append(trigger)
  try {
    await database.trips.add(trip)
    await database.trips.add({ ...trip, id: 'other-trip' })
    let a = await repo.createActivity(trip.id, { title: 'A', category: 'visit', date: trip.startDate, scheduleType: 'unscheduled', period: null, sortOrder: 0,
      location: 'Lieu', address: 'Adresse', latitude: 0, longitude: -0.5, estimatedCost: 0, paidAmount: 5, currency: 'JPY', reservationReference: 'REF', notes: 'Notes' })
    const b = await repo.createActivity(trip.id, { title: 'B', category: 'rest', date: trip.startDate, scheduleType: 'period', period: 'morning', sortOrder: 0 })
    // Historical rows without order remain valid and deterministic.
    await database.activities.update(a.id, { sortOrder: undefined })
    a = await repo.getActivity(trip.id, a.id)
    const original = JSON.stringify(a)
    assert(reorderActivities([a, b], b.id, 'up').length === 0, 'Première position non protégée.')
    await repo.reorderActivity(trip.id, a.id, 'up')
    let day = await repo.listActivities(trip.id, trip.startDate)
    assert(day[0].id === a.id, 'Réordre période/sans horaire non persisté.')
    await repo.reorderActivity(trip.id, a.id, 'down')
    day = await repo.listActivities(trip.id, trip.startDate)
    assert(day[1].id === a.id, 'Descendre incorrect.')
    await repo.reorderActivity(trip.id, a.id, 'down')
    assert((await repo.listActivities(trip.id, trip.startDate))[1].id === a.id, 'Dernière position non protégée.')
    assert(JSON.stringify(a) === original, 'Fonction pure a muté son entrée.')
    a = await repo.getActivity(trip.id, a.id)
    const stableFields = (item: TripActivity) => { const { date: _date, scheduleType: _mode, period: _period, startTime: _start, endTime: _end, updatedAt: _updated, ...rest } = item; return JSON.stringify(rest) }
    const before = stableFields(a)
    a = await repo.organizeActivity(trip.id, a.id, { date: '2027-01-01' }, schedulingKey(a))
    assert(a.date === '2027-01-01' && stableFields(a) === before, 'Déplacement a modifié des données annexes.')
    const oldKey = schedulingKey(a)
    a = await repo.organizeActivity(trip.id, a.id, { startTime: '10:00', endTime: '11:00' }, oldKey)
    assert(a.startTime === '10:00' && stableFields(a) === before, 'Horaire a perdu des champs.')
    await rejects(() => repo.organizeActivity(trip.id, a.id, { date: trip.startDate }, oldKey))
    await rejects(() => repo.organizeActivity('other-trip', a.id, { date: trip.startDate }, schedulingKey(a)))
    await rejects(() => repo.organizeActivity(trip.id, a.id, { startTime: '12:00', endTime: '11:00' }, schedulingKey(a)))
    await rejects(() => repo.reorderActivity(trip.id, a.id, 'up'))
    const c = await repo.createActivity(trip.id, { title: 'C', category: 'visit', date: a.date, scheduleType: 'exact', startTime: '10:30', endTime: '12:00', period: null, sortOrder: 0 })
    assert(buildDayPlanning([a, c]).conflictCount === 2, 'Chevauchement perdu après modification.')
    a = await repo.organizeActivity(trip.id, a.id, { unscheduled: true }, schedulingKey(a))
    assert(a.startTime === undefined && a.endTime === undefined && a.period === null && stableFields(a) === before, 'Retrait horaire incorrect.')
    a = await repo.organizeActivity(trip.id, a.id, { date: null }, schedulingKey(a))
    assert((await repo.listActivities(trip.id, null))[0].id === a.id, 'Déplacement vers idées incorrect.')
    const secondConnection = new RoamDatabase(database.name)
    try { await secondConnection.activities.update(a.id, { notes: 'Autre onglet' }) } finally { secondConnection.close() }
    a = await repo.organizeActivity(trip.id, a.id, { date: trip.startDate }, schedulingKey(a))
    assert(a.notes === 'Autre onglet', 'Écrasement concurrent des notes.')
    await Promise.all([repo.reorderActivity(trip.id, a.id, 'up'), repo.reorderActivity(trip.id, a.id, 'down')])
    const order = (await repo.listActivities(trip.id, trip.startDate)).map((item) => item.id).join()
    database.close(); await database.open()
    assert((await repo.listActivities(trip.id, trip.startDate)).map((item) => item.id).join() === order, 'Ordre perdu après réouverture.')
    const legacyIdea = await repo.createActivity(trip.id, { title: 'Idée historique', category: 'other', date: null, scheduleType: 'unscheduled', period: null })
    assert(legacyIdea.sortOrder === undefined, 'Ordre historique rempli automatiquement.')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert((await createActivityRepository(target).listActivities(trip.id, trip.startDate)).map((item) => item.id).join() === order, 'Ordre perdu via ZIP.')
    assert((await createActivityRepository(target).getActivity(trip.id, a.id)).longitude === -0.5, 'Localisation perdue via ZIP.')
    assert((await createActivityRepository(target).getActivity(trip.id, legacyIdea.id)).sortOrder === undefined, 'Ordre historique sans valeur altéré via ZIP.')
    let selected = ''; let moved = ''
    flushSync(() => root.render(<OrganizationContext value={{ activities: [a, b].sort(compareActivities), busy: false,
      open: (activity, mode) => { selected = activity.id; moved = mode }, reorder: () => {} }}>
      <ActivityList activities={[a]} onOpen={() => { throw new Error('Propagation involontaire') }} onEdit={() => {}} />
    </OrganizationContext>))
    const move = host.querySelector<HTMLButtonElement>('[aria-label="Déplacer A"]')!
    move.focus(); assert(document.activeElement === move && move.getBoundingClientRect().height >= 44, 'Action tactile/clavier inaccessible.')
    move.click(); assert(selected === a.id && moved === 'date', 'Action déplacer incorrecte.')
    let closed = false
    flushSync(() => root.render(<ActivityOrganizationPanel activity={a} trip={trip} mode="time" trigger={trigger} persist={repo.organizeActivity} onClose={() => { closed = true }} />))
    const dialog = host.querySelector('dialog')!
    assert(dialog.open, 'Formulaire rapide non modal.')
    const remove = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Retirer'))!
    remove.click(); remove.click()
    const limit = performance.now() + 4000
    while (!closed && performance.now() < limit) await new Promise((resolve) => setTimeout(resolve, 20))
    assert(closed && (await repo.getActivity(trip.id, a.id)).scheduleType === 'unscheduled', 'Formulaire rapide non enregistré.')
    flushSync(() => root.render(null))
    assert(document.activeElement === trigger, 'Focus non restauré.')
    // Native input edits exercise form state, dirty cancellation and real repository save.
    const change = (input: HTMLInputElement, value: string) => flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    a = await repo.getActivity(trip.id, a.id)
    closed = false
    flushSync(() => root.render(<ActivityOrganizationPanel key="date" activity={a} trip={trip} mode="date" trigger={trigger} persist={repo.organizeActivity} onClose={() => { closed = true }} />))
    change(host.querySelector<HTMLInputElement>('input[type="date"]')!, '2027-01-02')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(!closed && host.textContent?.includes('Abandonner ces modifications'), 'Saisie non enregistrée perdue à Échap.')
    flushSync(() => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Continuer la saisie')!.click())
    flushSync(() => host.querySelector('form')!.requestSubmit())
    let deadline = performance.now() + 4000
    while (!closed && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    a = await repo.getActivity(trip.id, a.id)
    assert(closed && a.date === '2027-01-02', 'Déplacement via formulaire rapide incorrect.')
    closed = false
    flushSync(() => root.render(<ActivityOrganizationPanel key="time" activity={a} trip={trip} mode="time" trigger={trigger} persist={repo.organizeActivity} onClose={() => { closed = true }} />))
    const times = host.querySelectorAll<HTMLInputElement>('input[type="time"]')
    change(times[0], '08:30'); change(times[1], '09:45')
    flushSync(() => host.querySelector('form')!.requestSubmit())
    deadline = performance.now() + 4000
    while (!closed && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    a = await repo.getActivity(trip.id, a.id)
    assert(closed && a.startTime === '08:30' && a.endTime === '09:45', 'Enregistrement horaire via formulaire incorrect.')
    assert(host.scrollWidth <= host.clientWidth + 1, 'Débordement horizontal du formulaire rapide.')
    report('Organisation rapide : ordre historique/mixte, limites, dates, horaires, conflits, isolation, concurrence, réouverture, ZIP et UI tactile/clavier validés.')
  } finally { flushSync(() => root.unmount()); host.remove(); trigger.remove(); await database.delete(); await target.delete() }
}
