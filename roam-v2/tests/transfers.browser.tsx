import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLiveQuery } from 'dexie-react-hooks'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferModes, transferKey, validateTransferInput, validateTripTransfers, type TransferInput } from '../src/db/transferModel'
import { schedulingKey } from '../src/db/activityOrganization'
import { transferPlacement } from '../src/components/program/transferPlanning'
import { TransferFormPanel } from '../src/components/program/TransferFormPanel'
import { TransferCard } from '../src/components/program/TransferCard'
import { DayTimeline } from '../src/components/program/DayTimeline'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import '../src/components/program/program.css'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Déplacement invalide accepté.') }
async function waitFor(condition: () => boolean) {
  const end = performance.now() + 5000
  while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
  assert(condition(), 'Affichage des déplacements non actualisé.')
}
export async function testTransfers(report: (message: string) => void) {
  const database = new RoamDatabase(`roam-v2-test-transfers-${crypto.randomUUID()}`)
  const target = new RoamDatabase(`roam-v2-test-transfers-target-${crypto.randomUUID()}`)
  const second = new RoamDatabase(database.name)
  const repository = createTransferRepository(database)
  const otherConnection = createTransferRepository(second)
  const activities = createActivityRepository(database)
  const host = document.createElement('div'); document.body.append(host)
  const trigger = document.createElement('button'); document.body.append(trigger)
  const root = createRoot(host)
  const trip: Trip = { id: 'transfers-trip', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' }
  try {
    await database.trips.bulkAdd([trip, { ...trip, id: 'transfers-other' }])
    const input = { title: 'Départ', category: 'visit' as const, date: trip.startDate, scheduleType: 'unscheduled' as const, period: null, location: 'Lieu', estimatedCost: 3, currency: 'GBP', latitude: 0, longitude: -1 }
    let a = await activities.createActivity(trip.id, input)
    const b = await activities.createActivity(trip.id, { ...input, title: 'Arrivée', sortOrder: 1 })
    const c = await activities.createActivity('transfers-other', { ...input, title: 'Autre voyage' })
    const fields: TransferInput = { fromActivityId: a.id, toActivityId: b.id, mode: 'walk', currency: 'EUR' }
    assert(validateTripTransfers(undefined, trip.id, new Map()).length === 0, 'Ancien voyage incompatible.')
    for (const mode of Object.keys(transferModes) as (keyof typeof transferModes)[]) {
      const item = await repository.saveTransfer(trip.id, { ...fields, mode })
      assert(item.mode === mode && item.durationMinutes === undefined && item.estimatedCost === undefined, 'Mode ou champs facultatifs incorrects.')
      await repository.deleteTransfer(trip.id, item.id, transferKey(item))
    }
    let transfer = await repository.saveTransfer(trip.id, { ...fields, durationMinutes: 0, estimatedCost: 0, currency: 'jpy', notes: 'Note' })
    assert(transfer.currency === 'JPY' && transfer.durationMinutes === 0 && transfer.estimatedCost === 0, 'Zéro/devise perdus.')
    for (const value of [-1, NaN, Infinity, 'test']) {
      await rejects(() => validateTransferInput({ ...fields, durationMinutes: value }))
      await rejects(() => validateTransferInput({ ...fields, estimatedCost: value }))
    }
    await rejects(() => validateTransferInput({ ...fields, currency: 'XXX-invalid' }))
    await rejects(() => validateTransferInput({ ...fields, mode: 'rocket' }))
    await rejects(() => repository.saveTransfer(trip.id, { ...fields, toActivityId: a.id }))
    await rejects(() => repository.saveTransfer(trip.id, { ...fields, toActivityId: c.id }))
    await rejects(() => repository.saveTransfer(trip.id, { ...fields, toActivityId: 'missing' }))
    const untouched = JSON.stringify(await database.activities.toArray())
    const oldTransfer = transfer
    transfer = await repository.saveTransfer(trip.id, { ...fields, mode: 'train', durationMinutes: 12.5, estimatedCost: 4.25, currency: 'GBP' }, transfer.id, transferKey(transfer))
    assert(transfer.id === oldTransfer.id && transfer.createdAt === oldTransfer.createdAt, 'Identité du déplacement perdue.')
    await rejects(() => otherConnection.saveTransfer(trip.id, fields, transfer.id, transferKey(oldTransfer)))
    await rejects(() => otherConnection.deleteTransfer(trip.id, transfer.id, transferKey(oldTransfer)))
    const concurrent = await Promise.all([repository.saveTransfer(trip.id, fields), otherConnection.saveTransfer(trip.id, { ...fields, mode: 'bus' })])
    assert((await database.trips.get(trip.id))!.manualTransfers!.length === 3, 'Création concurrente écrasée.')
    await otherConnection.deleteTransfer(trip.id, concurrent[0].id, transferKey(concurrent[0]))
    await repository.deleteTransfer(trip.id, concurrent[1].id, transferKey(concurrent[1]))
    assert(JSON.stringify(await database.activities.toArray()) === untouched, 'Les trajets ont modifié des activités.')
    const beforePlacement = await activities.listActivities(trip.id)
    assert(transferPlacement(transfer, beforePlacement).day === trip.startDate, 'Trajet sans horaires non placé.')
    await activities.reorderActivity(trip.id, b.id, 'up')
    assert(transferPlacement(transfer, await activities.listActivities(trip.id)).warning?.includes('avant le départ'), 'Ordre inversé non signalé.')
    assert(JSON.stringify((await database.trips.get(trip.id))!.manualTransfers![0]) === JSON.stringify(transfer), 'Réordonnancement a modifié le trajet.')
    a = await activities.organizeActivity(trip.id, a.id, { date: '2027-01-01' }, schedulingKey(a))
    assert(transferPlacement(transfer, await activities.listActivities(trip.id)).day === null, 'Changement de jour non signalé.')
    await rejects(() => repository.saveTransfer(trip.id, fields))
    // Date-drifted links are valid backups, retained for explicit correction.
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert(JSON.stringify((await target.trips.get(trip.id))!.manualTransfers, Object.keys(transfer).sort()) === JSON.stringify([transfer], Object.keys(transfer).sort()), 'Trajet altéré via ZIP.')
    const invalid = await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database)
    invalid.trips[0] = { ...invalid.trips[0], manualTransfers: [{ ...transfer, toActivityId: c.id }] }
    await rejects(() => buildExportArchive(invalid))
    await rejects(async () => validateTripTransfers([{ ...transfer, toActivityId: c.id }], trip.id, new Map((await database.activities.toArray()).map((item) => [item.id, item]))))
    a = await activities.organizeActivity(trip.id, a.id, { date: trip.startDate }, schedulingKey(a))
    await database.trips.update(trip.id, { destination: 'Modification concurrente' })
    transfer = await repository.saveTransfer(trip.id, { ...fields, mode: 'taxi', notes: 'Conservée' }, transfer.id, transferKey(transfer))
    assert((await database.trips.get(trip.id))!.destination === 'Modification concurrente', 'Champ voyage écrasé.')
    database.close(); await database.open()
    assert((await database.trips.get(trip.id))!.manualTransfers![0].notes === 'Conservée', 'Trajet perdu après réouverture.')
    const all = await activities.listActivities(trip.id)
    const card = renderToStaticMarkup(<TransferCard transfer={transfer} activities={all} onEdit={() => {}} />)
    assert(card.includes('Départ') && card.includes('Arrivée') && card.includes('Taxi / VTC') && card.includes('Durée non renseignée'), 'Carte de trajet incomplète.')
    const dated = await activities.organizeActivity(trip.id, a.id, { startTime: '09:00', endTime: '10:00' }, schedulingKey(a))
    const later = await activities.organizeActivity(trip.id, b.id, { startTime: '11:00' }, schedulingKey(b))
    const markup = renderToStaticMarkup(<DayTimeline activities={[dated, later]} onOpen={() => {}} onEdit={() => {}}
      afterActivity={(activity) => activity.id === a.id ? <TransferCard transfer={transfer} activities={[dated, later]} onEdit={() => {}} /> : null} />)
    assert(markup.indexOf('program-transfer') > markup.indexOf('activity-card') && markup.includes('Créneau libre'), 'Insertion du trajet a cassé le planning.')
    function ReactiveTransfers() {
      const current = useLiveQuery(() => database.trips.get(trip.id), [])
      return <>{current?.manualTransfers?.map((item) => <TransferCard key={item.id} transfer={item} activities={[dated, later]} onEdit={() => {}} />)}</>
    }
    flushSync(() => root.render(<ReactiveTransfers />))
    await waitFor(() => host.textContent?.includes('Taxi / VTC') === true)
    transfer = await otherConnection.saveTransfer(trip.id, { ...fields, mode: 'plane' }, transfer.id, transferKey(transfer))
    await waitFor(() => host.textContent?.includes('Avion') === true)
    let closed = false
    flushSync(() => root.render(<TransferFormPanel trip={trip} activities={[dated, later]} transfer={null} initialDate={trip.startDate} trigger={trigger}
      persist={repository.saveTransfer} remove={repository.deleteTransfer} onClose={() => { closed = true }} />))
    assert(host.querySelector('dialog')!.open, 'Formulaire non modal.')
    const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => flushSync(() => {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
    })
    const selects = host.querySelectorAll('select')
    change(selects[1], a.id); change(selects[2], b.id); change(selects[3], 'boat')
    const inputs = host.querySelectorAll('input')
    change(inputs[0], '12,5'); change(inputs[1], '0')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(!closed && host.textContent?.includes('Abandonner les modifications'), 'Saisie du trajet perdue à Échap.')
    flushSync(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Annuler')!.click())
    flushSync(() => host.querySelector('form')!.requestSubmit())
    await waitFor(() => closed)
    let created = (await database.trips.get(trip.id))!.manualTransfers!.find((item) => item.mode === 'boat')!
    assert(created.durationMinutes === 12.5 && created.estimatedCost === 0, 'Formulaire virgule/zéro incorrect.')
    flushSync(() => root.render(null)); assert(document.activeElement === trigger, 'Focus non restauré.')
    closed = false
    flushSync(() => root.render(<TransferFormPanel trip={trip} activities={[dated, later]} transfer={created} initialDate={trip.startDate} trigger={trigger}
      persist={repository.saveTransfer} remove={repository.deleteTransfer} onClose={() => { closed = true }} />))
    flushSync(() => [...host.querySelectorAll('button')].find((item) => item.textContent === 'Supprimer le déplacement')!.click())
    assert(!closed && (await database.trips.get(trip.id))!.manualTransfers!.some((item) => item.id === created.id), 'Suppression avant confirmation.')
    const confirm = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Confirmer la suppression')!
    assert(confirm.getBoundingClientRect().height >= 44, 'Zone tactile trop petite.')
    flushSync(() => confirm.click()); confirm.click()
    await waitFor(() => closed)
    assert(!(await database.trips.get(trip.id))!.manualTransfers!.some((item) => item.id === created.id), 'Suppression confirmée non persistée.')
    flushSync(() => root.render(null))
    // Cascade rollback: failing the final activity deletion retains both activity and links.
    const fail = () => { throw new Error('Simulation erreur suppression') }
    database.activities.hook('deleting', fail)
    try { await rejects(() => activities.deleteActivity(trip.id, a.id)) } finally { database.activities.hook('deleting').unsubscribe(fail) }
    assert((await database.trips.get(trip.id))!.manualTransfers!.length === 1 && await database.activities.get(a.id), 'Cascade partielle après erreur.')
    await activities.deleteActivity(trip.id, a.id)
    assert((await database.trips.get(trip.id))!.manualTransfers!.length === 0 && await database.activities.get(b.id), 'Cascade activité incorrecte.')
    assert(await database.activities.get(c.id), 'Autre voyage altéré.')
    await database.trips.update(trip.id, { archived: true })
    await rejects(() => repository.saveTransfer(trip.id, fields))
    await database.trips.update(trip.id, { archived: false })
    await updateTripTrash(trip.id, 'trash', undefined, database)
    await rejects(() => repository.saveTransfer(trip.id, fields))
    report('Déplacements : 11 modes, CRUD, facultatifs/zéro/devises, validation, isolation, concurrence, dates/ordre, réactivité, réouverture, ZIP, formulaire/clavier/mobile et cascade atomique validés sans réseau.')
  } finally { flushSync(() => root.unmount()); host.remove(); trigger.remove(); second.close(); await database.delete(); await target.delete() }
}
