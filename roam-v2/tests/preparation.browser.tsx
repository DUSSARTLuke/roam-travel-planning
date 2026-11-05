import { useLiveQuery } from 'dexie-react-hooks'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createPreparationRepository, copyPreparationTasks } from '../src/db/preparation'
import { preparationSummary, taskStatus, sortPreparationTasks, validatePreparationTasks, preparationTemplates, type PreparationTask } from '../src/preparation/tasks'
import { PreparationChecklist } from '../src/components/preparation/PreparationChecklist'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { readBackupZip } from '../src/backup/readZip'
import { createStoredZip } from '../src/backup/zip'
import { sha256 } from '../src/backup/sha256'
import { connection } from '../src/pwa/connection'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Préparatif invalide accepté.') }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testPreparation(report: (message: string) => void) {
  const trip: Trip = { id: 'prep', destination: 'Préparatifs', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '' }
  const task: PreparationTask = { id: 'p', title: 'Passeport', category: 'documents', priority: 'normal', completed: false, dueDate: '2026-12-31', createdAt: stamp, updatedAt: stamp }
  const tasks = [task, { ...task, id: 'high', priority: 'high' as const }, { ...task, id: 'nodate', dueDate: undefined, priority: 'high' as const }, { ...task, id: 'done', completed: true, dueDate: '2026-12-29' }]
  assert(validatePreparationTasks(undefined).length === 0, 'Ancien voyage peuplé automatiquement.')
  assert(taskStatus(task, '2026-12-31') === 'todo' && taskStatus(task, '2027-01-01') === 'overdue' && taskStatus(tasks[3], '2027-01-01') === 'done', 'Échéance/retard/terminé incorrects.')
  assert(preparationSummary(tasks, '2027-01-01').completed === 1 && preparationSummary(tasks, '2027-01-01').overdue === 2, 'Progression erronée.')
  const empty = preparationSummary([], '2027-01-01')
  assert(empty.total === 0 && empty.completed === 0 && empty.overdue === 0, 'Progression vide incorrecte.')
  await rejects(() => validatePreparationTasks(Array.from({ length: 501 }, (_, index) => ({ ...task, id: String(index) }))))
  const original = JSON.stringify(tasks)
  assert(sortPreparationTasks(tasks).map((item) => item.id).join() === 'high,p,nodate,done' && JSON.stringify(tasks) === original, 'Tri par échéance/priorité/état instable ou destructif.')
  for (const invalid of [null, [{ ...task, dueDate: '2026-02-30' }], [{ ...task, priority: 'urgent' }], [{ ...task, category: 'fake' }], [{ ...task, title: '' }], [{ ...task, completed: 'false' }], [task, task], [{ ...task, updatedAt: 'invalid' }], [{ ...task, notes: 'x'.repeat(5001) }], [{ ...task, templateId: 'unknown' }]]) await rejects(() => validatePreparationTasks(invalid))
  assert(copyPreparationTasks(undefined).preparationTasks === undefined, 'Duplication d’ancien voyage crée des tâches.')
  const clone = copyPreparationTasks([tasks[3]]).preparationTasks![0]
  assert(clone.id !== tasks[3].id && !clone.completed && clone.title === tasks[3].title && clone.dueDate === tasks[3].dueDate, 'Copie perd contenu ou garde les coches/identifiants.')

  const database = new RoamDatabase(`roam-v2-test-preparation-${crypto.randomUUID()}`), second = new RoamDatabase(database.name), target = new RoamDatabase(`roam-v2-test-preparation-restore-${crypto.randomUUID()}`)
  const repo = createPreparationRepository(database), other = createPreparationRepository(second)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), offline = connection.getSnapshot().offline
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((ready) => setTimeout(ready, 20)); assert(condition(), 'Préparatifs non actualisés.') }
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!
  const setInput = (input: HTMLInputElement, value: string) => flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  try {
    await database.trips.add(trip); await database.trips.add({ ...trip, id: 'other' }); await second.open()
    let p = await repo.save(trip.id, { title: '  Passeport  ', category: 'documents', priority: 'high', dueDate: '2026-12-31', notes: '  Notes  ' })
    assert(p.title === 'Passeport' && p.notes === 'Notes', 'Création non normalisée.')
    await rejects(() => other.save('other', { title: 'Intrus', category: 'other', priority: 'normal' }, p.id, JSON.stringify(p)))
    const stale = p
    p = await repo.setCompleted(trip.id, p.id, true, JSON.stringify(p))
    await rejects(() => other.save(trip.id, { title: 'Écrasement', category: 'other', priority: 'normal' }, stale.id, JSON.stringify(stale)))
    await rejects(() => other.remove(trip.id, stale.id, JSON.stringify(stale)))
    p = await other.setCompleted(trip.id, p.id, false, JSON.stringify(p))
    p = await repo.save(trip.id, { title: 'Passeport corrigé', category: 'documents', priority: 'low' }, p.id, JSON.stringify(p))
    assert(p.dueDate === undefined && p.notes === undefined && (await database.trips.get(trip.id))!.preparationTasks![0].dueDate === undefined, 'Effacement échéance/notes échoué.')
    const [newTask] = await Promise.all([repo.save(trip.id, { title: 'Bagage', category: 'luggage', priority: 'normal' }), other.save(trip.id, { title: 'Billet', category: 'transport', priority: 'normal' }), database.trips.update(trip.id, { country: 'Préservé' })])
    assert((await database.trips.get(trip.id))!.preparationTasks!.length === 3 && (await database.trips.get(trip.id))!.country === 'Préservé', 'Écriture concurrente efface d’autres tâches/champs.')
    const firstAdd = await repo.addTemplates(trip.id, ['identity', 'bags'])
    await Promise.all([repo.addTemplates(trip.id, ['identity', 'tickets']), other.addTemplates(trip.id, ['identity', 'tickets'])])
    const latest = (await database.trips.get(trip.id))!
    assert(firstAdd === 2 && latest.preparationTasks!.filter((item) => item.templateId === 'identity').length === 1 && latest.preparationTasks!.filter((item) => item.templateId === 'tickets').length === 1, 'Modèles répétés/automatiques ou course non protégée.')
    await rejects(() => repo.addTemplates(trip.id, ['bad']))
    const before = JSON.stringify(latest)
    const failure = () => { throw new Error('Quota simulé') }
    database.trips.hook('updating', failure)
    await rejects(() => repo.remove(trip.id, p.id, JSON.stringify(p)))
    database.trips.hook('updating').unsubscribe(failure)
    assert(JSON.stringify(await database.trips.get(trip.id)) === before, 'Erreur partiellement écrite.')
    const copied: Trip = { ...trip, id: 'copy', ...copyPreparationTasks(latest.preparationTasks) }
    await database.trips.add(copied)
    assert(copied.preparationTasks!.every((item) => !latest.preparationTasks!.some((old) => old.id === item.id) && !item.completed), 'Duplication non indépendante.')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared = await prepareRestore(archive.blob); await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert(JSON.stringify((await target.trips.get(trip.id))!.preparationTasks) === JSON.stringify(latest.preparationTasks), 'ZIP/restauration perd préparatifs/types.')
    const files = await readBackupZip(archive.blob)
    const json = JSON.parse(await files.get('data/trips.json')!.text()); json[0].preparationTasks[0].completed = 'false'
    const replacement = new Blob([JSON.stringify(json)]); files.set('data/trips.json', replacement)
    const manifest = JSON.parse(await files.get('manifest.json')!.text()), entry = manifest.inventory.find((item: { path: string }) => item.path === 'data/trips.json')
    entry.size = replacement.size; entry.sha256 = await sha256(replacement); files.set('manifest.json', new Blob([JSON.stringify(manifest)]))
    await rejects(async () => validateRestoreArchive(await createStoredZip([...files].map(([path, blob]) => ({ path, blob })))))
    database.close(); await database.open()
    assert((await database.trips.get(trip.id))!.preparationTasks!.length === latest.preparationTasks!.length, 'Préparatifs non persistés.')
    await repo.remove(trip.id, newTask.id, JSON.stringify(newTask))
    await database.trips.update(trip.id, { archived: true }); await rejects(() => repo.save(trip.id, { title: 'Refus', category: 'other', priority: 'normal' }))
    await database.trips.update(trip.id, { archived: false }); await updateTripTrash(trip.id, 'trash', undefined, database)
    await rejects(() => repo.setCompleted(trip.id, p.id, true, JSON.stringify(p)))
    await updateTripTrash(trip.id, 'restore', undefined, database)
    assert((await database.trips.get(trip.id))!.preparationTasks!.some((item) => item.id === p.id), 'Corbeille/restauration efface les préparatifs.')

    // Real isolated writes and live updates from a second connection, fully offline.
    const uiTrip = { ...trip, id: 'ui' }; await database.trips.add(uiTrip)
    let today = '2027-01-01'
    function Harness({ id = uiTrip.id }: { id?: string }) {
      const current = useLiveQuery(() => database.trips.get(id), [id])
      return current ? <PreparationChecklist key={id} trip={current} today={today} repository={repo} /> : null
    }
    window.dispatchEvent(new Event('offline')); flushSync(() => root.render(<Harness />))
    await wait(() => host.textContent?.includes('Aucun préparatif ajouté') === true)
    assert((await database.trips.get(uiTrip.id))!.preparationTasks === undefined, 'Affichage peuple automatiquement l’ancien voyage.')
    host.querySelector<HTMLDetailsElement>('.preparation-content')!.open = true
    flushSync(() => button('Ajouter une tâche').click())
    setInput(host.querySelector('dialog input')!, 'Téléphoner')
    setInput(host.querySelector('dialog input[type="date"]')!, '2026-12-31')
    flushSync(() => { const form = host.querySelector('dialog form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Téléphoner') === true)
    let uiTask = (await database.trips.get(uiTrip.id))!.preparationTasks![0]
    assert((await database.trips.get(uiTrip.id))!.preparationTasks!.length === 1 && host.textContent?.includes('En retard'), 'Double soumission ou retard perdu.')
    flushSync(() => host.querySelector<HTMLInputElement>('.preparation-task input[type="checkbox"]')!.click())
    await wait(() => host.textContent?.includes('1 / 1') === true)
    uiTask = await other.setCompleted(uiTrip.id, uiTask.id, false, JSON.stringify((await database.trips.get(uiTrip.id))!.preparationTasks![0]))
    await wait(() => host.textContent?.includes('0 / 1') === true)
    today = '2026-12-31'; flushSync(() => root.render(<Harness />))
    assert(!host.querySelector('.is-overdue'), 'Date limite aujourd’hui traitée en retard.')
    flushSync(() => button('Modifier').click())
    setInput(host.querySelector('dialog input')!, 'Téléphoner encore')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(host.querySelector('.sharing-discard'), 'Échap perd la saisie sans confirmation.')
    flushSync(() => button('Continuer la saisie').click())
    database.trips.hook('updating', failure)
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => host.querySelector('dialog [role="alert"]')?.textContent === 'Quota simulé')
    database.trips.hook('updating').unsubscribe(failure)
    assert(host.querySelector<HTMLInputElement>('dialog input')!.value === 'Téléphoner encore', 'Erreur perd la saisie.')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Téléphoner encore') === true)
    flushSync(() => button('Supprimer').click()); assert((await database.trips.get(uiTrip.id))!.preparationTasks!.length === 1, 'Suppression sans confirmation.')
    flushSync(() => button('Confirmer la suppression').click())
    await wait(() => host.textContent?.includes('Aucun préparatif ajouté') === true)
    assert(document.activeElement === button('Ajouter une tâche'), 'Focus non restauré après suppression.')
    host.querySelector<HTMLDetailsElement>('.preparation-templates')!.open = true
    flushSync(() => host.querySelector<HTMLInputElement>('.preparation-templates input')!.click())
    flushSync(() => button('Ajouter les modèles sélectionnés').click())
    await wait(() => host.textContent?.includes(preparationTemplates[0].title) === true && Boolean(host.querySelector('.preparation-task')))
    assert((await database.trips.get(uiTrip.id))!.preparationTasks!.length === 1, 'Modèle non ajouté explicitement.')
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((ready) => requestAnimationFrame(() => requestAnimationFrame(ready))); assert(host.scrollWidth <= host.clientWidth + 1, 'Checklist déborde sur mobile.') }
    flushSync(() => root.render(<Harness id="other" />))
    await wait(() => host.textContent?.includes('Aucun préparatif ajouté') === true)
    assert(!host.querySelector('.preparation-task'), 'Changement de voyage conserve des tâches étrangères.')
    report('Préparatifs : CRUD/cocher/décocher, progression/retards/dates civiles, catégories/priorités/tri, modèles explicites sans doublons, conflits/rollback/deux connexions, anciennes données, duplication, persistance/ZIP, formulaire/focus/erreurs, offline et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); second.close(); await database.delete(); await target.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
