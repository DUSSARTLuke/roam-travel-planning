import { ExpenseSharing } from '../src/components/budget/ExpenseSharing'
import { createExpenseSharingRepository } from '../src/db/expenseSharing'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useState } from 'react'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { savePlannedBudget } from '../src/db/plannedBudget'
import { validatePlannedBudget, parsePlannedBudgetAmount, plannedBudgetPosition, copyPlannedBudget, initialBudgetView, filterBudgetEntries, paymentStatus, type BudgetViewState } from '../src/money/budgetTracking'
import { buildTripBudget } from '../src/money/tripBudget'
import { BudgetExpenseExplorer, PlannedBudgetPanel } from '../src/components/budget/BudgetTracking'
import { BudgetDayChart } from '../src/components/budget/BudgetDayChart'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
async function rejects(action: () => unknown) { let rejected = false; try { await action() } catch { rejected = true }; assert(rejected, 'Prévisionnel invalide accepté.') }
export async function testBudgetTracking(report: (message: string) => void) {
  const trip: Trip = { id: 'tracking', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '', referenceCurrency: 'EUR' }
  const activities = [
    { ...timedFixture('a', '09:00', '10:00'), tripId: trip.id, title: 'Repas', category: 'meal' as const, date: trip.startDate, estimatedCost: 100, paidAmount: 40, currency: 'EUR' },
    { ...timedFixture('b', '11:00', '12:00'), tripId: trip.id, title: 'Visite', date: trip.endDate, estimatedCost: 20, paidAmount: 0, currency: 'EUR' },
    { ...timedFixture('c', '13:00', '14:00'), tripId: trip.id, title: 'Idée', date: null, estimatedCost: undefined, paidAmount: undefined, currency: undefined },
  ]
  const before = JSON.stringify([trip, activities]), budget = buildTripBudget(trip, activities)
  assert(plannedBudgetPosition(trip, budget).status === 'absent' && validatePlannedBudget(undefined) === undefined, 'Ancien voyage rempli automatiquement.')
  for (const invalid of [null, '100', { amount: -1, currency: 'EUR' }, { amount: NaN, currency: 'EUR' }, { amount: Infinity, currency: 'EUR' }, { amount: 0, currency: 'ZZZ' }, { amount: '1', currency: 'EUR' }]) await rejects(() => validatePlannedBudget(invalid))
  assert(parsePlannedBudgetAmount('0,50') === 0.5 && parsePlannedBudgetAmount('0') === 0, 'Saisie décimale incorrecte.')
  await rejects(() => parsePlannedBudgetAmount('-1'))
  const withPlan = { ...trip, plannedBudget: { amount: 100, currency: 'EUR' } }
  const position = plannedBudgetPosition(withPlan, budget)
  assert(position.status === 'calculated' && position.remaining === -20 && position.incomplete && position.missing === 1, 'Dépassement/inconnus incorrects.')
  const zero = plannedBudgetPosition({ ...trip, plannedBudget: { amount: 0, currency: 'EUR' } }, buildTripBudget(trip, []))
  assert(zero.status === 'calculated' && zero.remaining === 0 && !zero.incomplete, 'Budget nul confondu avec absence.')
  assert(plannedBudgetPosition({ ...trip, plannedBudget: { amount: 200, currency: 'JPY' } }, budget).status === 'unavailable', 'Conversion prévisionnelle inventée.')
  const converted = plannedBudgetPosition({ ...trip, plannedBudget: { amount: 200, currency: 'JPY' }, manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 1, updatedAt: '2026-11-05T12:00:00.000Z' }] }, budget)
  assert(converted.status === 'calculated' && converted.remaining === 80, 'Conversion du prévisionnel incorrecte.')
  const excluded = buildTripBudget(trip, [...activities, { ...activities[0], id: 'foreign', currency: 'JPY' }])
  const partial = plannedBudgetPosition(withPlan, excluded)
  assert(partial.status === 'calculated' && partial.incomplete && partial.excluded === 1, 'Dépense non convertible cachée.')
  assert(copyPlannedBudget(withPlan).plannedBudget?.amount === 100 && copyPlannedBudget(withPlan).plannedBudget !== withPlan.plannedBudget && !('plannedBudget' in copyPlannedBudget(trip)), 'Duplication/historique altérés.')
  assert(paymentStatus(budget.entries[0]) === 'partial' && paymentStatus(budget.entries[1]) === 'unpaid' && paymentStatus(budget.entries[2]) === 'unknown', 'Statut de paiement inventé.')
  assert(paymentStatus({ ...budget.entries[0], paidAmount: 100 }) === 'paid' && paymentStatus({ ...budget.entries[0], paidAmount: 10, estimatedCost: undefined }) === 'unknown', 'Paiement sans estimation présenté complet.')
  for (const [filter, count] of [[{ category: 'food' }, 1], [{ day: trip.startDate }, 1], [{ day: 'undated' }, 1], [{ payment: 'unknown' }, 1], [{ payment: 'paid' }, 0], [{ category: 'food', payment: 'unpaid' }, 0]] as const) assert(filterBudgetEntries(budget, { ...initialBudgetView, ...filter }).length === count, 'Filtre erroné.')
  assert(JSON.stringify([trip, activities]) === before && buildTripBudget(withPlan, activities).totals.status === budget.totals.status, 'Calcul antérieur ou données modifiés.')

  const db = new RoamDatabase(`roam-v2-test-budget-tracking-${crypto.randomUUID()}`)
  const target = new RoamDatabase(`roam-v2-test-budget-tracking-restore-${crypto.randomUUID()}`)
  const second = new RoamDatabase(db.name), repository = createActivityRepository(db)
  const host = document.createElement('div'); host.className = 'trip-budget-page'; document.body.append(host)
  const root = createRoot(host)
  const offline = connection.getSnapshot().offline
  window.dispatchEvent(new Event('offline'))
  try {
    await db.trips.add(trip); await second.open()
    for (const activity of activities) await repository.createActivity(trip.id, activity)
    await savePlannedBudget(trip.id, { amount: 100, currency: 'EUR' }, 'null', db)
    await db.trips.update(trip.id, { country: 'Concurrent', participants: [{ id: 'p', name: 'Alice' }] })
    await rejects(() => savePlannedBudget(trip.id, { amount: 200, currency: 'EUR' }, 'null', second))
    await savePlannedBudget(trip.id, { amount: 0, currency: 'EUR' }, JSON.stringify({ amount: 100, currency: 'EUR' }), second)
    assert((await db.trips.get(trip.id))?.country === 'Concurrent' && (await db.trips.get(trip.id))?.participants?.[0].name === 'Alice', 'Autres champs écrasés.')
    db.close(); await db.open()
    const live = (await db.trips.get(trip.id))!
    assert(live.plannedBudget?.amount === 0, 'Prévisionnel nul perdu à la réouverture.')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, db))
    const restored = await validateRestoreArchive(archive.blob)
    assert(restored.trips[0].plannedBudget?.amount === 0 && restored.trips[0].plannedBudget?.currency === 'EUR', 'ZIP perd le prévisionnel.')
    const prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert((await target.trips.get(trip.id))?.plannedBudget?.amount === 0, 'Restauration perd le prévisionnel.')
    const invalidSnapshot = await readExportSnapshot({ mode: 'trip', tripId: trip.id }, db)
    invalidSnapshot.trips[0].plannedBudget = { amount: -1, currency: 'EUR' }
    await rejects(() => buildExportArchive(invalidSnapshot))
    await savePlannedBudget(trip.id, undefined, JSON.stringify(live.plannedBudget), db)
    assert((await db.trips.get(trip.id))?.plannedBudget === undefined, 'Retrait du prévisionnel échoué.')
    await db.trips.update(trip.id, { archived: true })
    await rejects(() => savePlannedBudget(trip.id, { amount: 10, currency: 'EUR' }, 'null', db))

    await db.trips.update(trip.id, { archived: false, plannedBudget: withPlan.plannedBudget })
    let saves = 0
    const saveBudget: typeof savePlannedBudget = (id, value, expected) => { saves++; return savePlannedBudget(id, value, expected, db) }
    let remembered: BudgetViewState = { ...initialBudgetView }
    const sharingRepository = createExpenseSharingRepository(db)
    function Harness() {
      const [view, setView] = useState(remembered)
      return <><PlannedBudgetPanel trip={withPlan} budget={budget} saveBudget={saveBudget} /><BudgetExpenseExplorer budget={budget} view={view} onChange={(next) => { remembered = next; setView(next) }} /><ExpenseSharing trip={{ ...withPlan, participants: [{ id: 'p', name: 'Alice' }] }} activities={activities} repository={sharingRepository} chosenExpense={view.sharingExpense} onChosenExpenseChange={(sharingExpense) => { remembered = { ...view, sharingExpense }; setView(remembered) }} /><BudgetDayChart budget={budget} mode={view.mode} onModeChange={(mode) => setView({ ...view, mode })} selectedDay={view.selectedDay} onSelectedDayChange={(selectedDay) => { remembered = { ...view, selectedDay }; setView(remembered) }} /></>
    }
    flushSync(() => root.render(<Harness />))
    assert(host.textContent?.includes('Budget incomplet') && host.textContent.includes('Dépassement connu'), 'Avertissement incomplet absent.')
    const select = host.querySelector<HTMLSelectElement>('.budget-filters select')!
    flushSync(() => { select.value = 'food'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    assert(host.querySelector('.budget-explorer')?.textContent?.includes('1 dépense(s)') && remembered.category === 'food', 'Filtre UI non appliqué.')
    const sharingPicker = host.querySelector<HTMLSelectElement>('.sharing-source-picker select')!
    flushSync(() => { sharingPicker.value = 'activity:a'; sharingPicker.dispatchEvent(new Event('change', { bubbles: true })) })
    flushSync(() => host.querySelector<HTMLButtonElement>(`[data-budget-day="${trip.endDate}"]`)!.click())
    flushSync(() => root.render(null)); flushSync(() => root.render(<Harness />))
    assert(host.querySelector<HTMLSelectElement>('.budget-filters select')!.value === 'food' && host.querySelector<HTMLButtonElement>(`[data-budget-day="${trip.endDate}"]`)!.getAttribute('aria-pressed') === 'true', 'Navigation perd filtres/sélection.')
    assert(host.querySelector<HTMLSelectElement>('.sharing-source-picker select')?.value === 'activity:a', 'Navigation perd la sélection de partage.')
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); assert(host.scrollWidth <= host.clientWidth + 1, 'Budget déborde sur mobile.') }
    const wait = async (predicate: () => boolean) => { const end = performance.now() + 4000; while (!predicate() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(predicate(), 'Formulaire prévisionnel non actualisé.') }
    const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!
    const setAmount = (text: string) => flushSync(() => { const input = host.querySelector<HTMLInputElement>('dialog input[inputmode="decimal"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
    flushSync(() => button('Modifier le prévisionnel').click())
    setAmount('-1')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => Boolean(host.querySelector('dialog [role="alert"]')))
    assert(saves === 0 && host.querySelector<HTMLInputElement>('dialog input[inputmode="decimal"]')!.value === '-1', 'Montant invalide écrit ou saisie perdue.')
    setAmount('0,50')
    const failWrite = () => { throw new Error('Quota simulé') }
    db.trips.hook('updating', failWrite)
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => host.querySelector('dialog [role="alert"]')?.textContent === 'Quota simulé')
    db.trips.hook('updating').unsubscribe(failWrite)
    assert((await db.trips.get(trip.id))?.plannedBudget?.amount === 100 && host.querySelector<HTMLInputElement>('dialog input[inputmode="decimal"]')!.value === '0,50', 'Échec perd le budget/saisie.')
    flushSync(() => { const form = host.querySelector('dialog form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await wait(() => !host.querySelector('dialog[open]'))
    assert(saves === 2 && (await db.trips.get(trip.id))?.plannedBudget?.amount === 0.5, 'Double soumission ou virgule non conservée.')
    flushSync(() => button('Modifier le prévisionnel').click())
    setAmount('2')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(host.querySelector('.sharing-discard'), 'Échap abandonne sans confirmation.')
    flushSync(() => button('Abandonner').click())
    report('Suivi budget : prévisionnel absent/zéro/dépassé, conversion/inconnus, filtres/statuts, données immuables, duplication, concurrence/champs préservés, persistance/ZIP, navigation et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); second.close(); await db.delete(); await target.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
