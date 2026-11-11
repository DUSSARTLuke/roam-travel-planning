const noStays=async()=>[]
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TripBudget } from '../src/components/budget/TripBudget'
import { buildTripBudget, budgetDayDistribution } from '../src/money/tripBudget'
import { getTripDays } from '../src/components/program/dates'
import { RoamDatabase, type Trip } from '../src/db/database'
import type { ManualTransfer } from '../src/db/transferModel'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testBudgetDays(report: (message: string) => void) {
  const trip: Trip = { id: 'budget-days-trip', destination: 'Journées test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '',
    manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.01, updatedAt: stamp }] }
  const a = { ...timedFixture('a', '09:00', '10:00'), tripId: trip.id, currency: 'EUR', estimatedCost: 100, paidAmount: 40 }
  const b = { ...timedFixture('b', '11:00', '12:00'), tripId: trip.id, currency: 'JPY', estimatedCost: 1000, paidAmount: 500 }
  const zero = { ...a, id: 'zero', date: '2027-01-01', estimatedCost: 0, paidAmount: 0 }
  const idea = { ...a, id: 'idea', date: null, estimatedCost: 7, paidAmount: undefined }
  const outside = { ...a, id: 'outside', date: '2027-01-03', estimatedCost: 9, paidAmount: 1 }
  const transfer: ManualTransfer = { id: a.id, fromActivityId: a.id, toActivityId: b.id, mode: 'bus', currency: 'EUR', estimatedCost: 20, createdAt: stamp, updatedAt: stamp }
  const sourceTrip = { ...trip, manualTransfers: [transfer, { ...transfer }] }
  const population = [a, b, zero, idea, outside, { ...a }, { ...a, tripId: 'foreign' }]
  const before = JSON.stringify([sourceTrip, population])
  const budget = buildTripBudget(sourceTrip, population)
  const estimated = budgetDayDistribution(budget, 'estimated'), paid = budgetDayDistribution(budget, 'paid')
  assert(estimated.rows.map((day) => day.date).join() === '2026-12-31,2027-01-01,2027-01-02', 'Dates inclusives/décembre–janvier incorrectes.')
  assert(estimated.rows[0].value?.amount === 130 && paid.rows[0].value?.amount === 45 && paid.rows[0].value.absentCount === 1, 'Total journalier/divise/transfert sans doublon incorrect ou paiement inventé.')
  assert(estimated.rows[1].value?.amount === 0 && estimated.rows[2].value?.amount === null && estimated.rows[2].entries.length === 0, 'Journée vide confondue avec zéro.')
  assert(estimated.rows[0].highest && estimated.rows[0].height === 100 && !estimated.rows[1].highest, 'Journée la plus élevée connue mal identifiée.')
  assert(budget.undated.entries.length === 1 && budget.outside.entries.length === 1 && budget.undated.entries[0].date === null && budget.outside.entries[0].date === '2027-01-03', 'Dates absentes/hors séjour réaffectées arbitrairement.')
  assert(budget.totals.status === 'calculated' && budget.totals.estimated.amount === 146 && budget.undated.totals.status === 'calculated' && budget.undated.totals.estimated.amount === 7 && budget.outside.totals.status === 'calculated' && budget.outside.totals.estimated.amount === 9, 'Réconciliation jours/sans date/hors séjour avec le budget impossible.')
  assert(budget.entryTotals.get(`transfer:${transfer.id}`)?.status === 'calculated' && JSON.stringify([sourceTrip, population]) === before, 'Détails absents ou données originales modifiées.')
  const drift = buildTripBudget(sourceTrip, [a, { ...b, date: '2027-01-01' }, zero, idea, outside])
  assert(drift.undated.entries.some((entry) => entry.kind === 'transfer') && !drift.dailyTotals.some((day) => day.entries.some((entry) => entry.kind === 'transfer')), 'Transfert entre deux jours affecté au départ ou à l’arrivée.')
  assert(drift.totals.status === 'calculated' && drift.totals.estimated.amount === 146, 'Dépense de transfert perdue lors du changement de date.')
  const noDates = buildTripBudget(sourceTrip, [{ ...a, date: null }, { ...b, date: null }])
  assert(noDates.undated.entries.length === 3 && noDates.dailyTotals.every((day) => day.entries.length === 0), 'Dates du voyage utilisées comme dates de dépenses non planifiées.')
  const invalid = buildTripBudget(trip, [{ ...a, date: '2026-02-30' }])
  assert(invalid.undated.entries[0].dateIssue && invalid.undated.entries[0].date === null, 'Date invalide normalisée silencieusement.')
  const missingRate = budgetDayDistribution(buildTripBudget({ ...sourceTrip, manualExchangeRates: [] }, [a, b]), 'estimated')
  assert(missingRate.rows[0].value?.amount === 120 && missingRate.rows[0].value.excluded.length === 1, 'Montants non convertibles intégrés à une barre.')
  const unknown = budgetDayDistribution(buildTripBudget(trip, [{ ...a, estimatedCost: undefined, paidAmount: undefined }]), 'estimated')
  assert(unknown.rows[0].value?.amount === null && unknown.rows[0].value.absentCount === 1, 'Montant absent transformé en zéro journalier.')
  const ties = budgetDayDistribution(buildTripBudget(trip, [{ ...a, estimatedCost: 10 }, { ...zero, estimatedCost: 10 }]), 'estimated')
  assert(ties.rows.filter((day) => day.highest).length === 2, 'Ex æquo des journées les plus élevées perdu.')
  const zeros = budgetDayDistribution(buildTripBudget(trip, [zero]), 'estimated')
  assert(zeros.maximum === 0 && zeros.rows.every((day) => !day.highest && day.height === 0), 'Pic ou division par zéro inventés.')
  const longTrip = { ...trip, startDate: '2026-12-01', endDate: '2027-05-31' }
  assert(buildTripBudget(longTrip, [a]).dailyTotals.length === getTripDays(longTrip.startDate, longTrip.endDate).length && getTripDays(longTrip.startDate, longTrip.endDate).length > 180, 'Séjour long tronqué.')
  const fraction = buildTripBudget(trip, [{ ...a, estimatedCost: 0.004 }, { ...b, currency: 'EUR', estimatedCost: 0.004 }])
  assert(fraction.dailyTotals[0].totals.status === 'calculated' && fraction.dailyTotals[0].totals.estimated.amount === 0.008, 'Arrondi intermédiaire dans la ventilation par jour.')
  report('Budget quotidien pur : dates inclusives, transferts/date commune sans doublons, estimé/payé, conversions, inconnus/zéro/jours vides, sans date/hors séjour, ex æquo, séjours longs, réconciliation et immutabilité.')

  const database = new RoamDatabase(`roam-v2-test-budget-days-${crypto.randomUUID()}`)
  const activities = createActivityRepository(database), transfers = createTransferRepository(database)
  const host = document.createElement('div'); host.style.width = '320px'; host.style.maxWidth = '100%'; document.body.append(host)
  const root = createRoot(host)
  const offlineBefore = connection.getSnapshot().offline
  let reads = 0
  const read = (id: string) => { reads++; return activities.listActivities(id) }
  function Harness() {
    const current = useLiveQuery(() => database.trips.get(trip.id), [])
    return current ? <TripBudget readAccommodations={noStays} readJourneys={async()=>[]} trip={current} readActivities={read} /> : null
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Graphique quotidien non actualisé.') }
  const dayButton = (date: string) => host.querySelector<HTMLButtonElement>(`[data-budget-day="${date}"]`)!
  const toggle = (label: string, daily = true) => [...host.querySelectorAll<HTMLButtonElement>(daily ? '.budget-day-toggle button' : '.budget-category-toggle:not(.budget-day-toggle) button')].find((button) => button.textContent === label)!
  const click = (button: HTMLButtonElement) => flushSync(() => button.click())
  try {
    window.dispatchEvent(new Event('offline'))
    await database.trips.add(trip)
    const storedA = await activities.createActivity(trip.id, a)
    let storedB = await activities.createActivity(trip.id, b)
    await activities.createActivity(trip.id, zero)
    await activities.createActivity(trip.id, idea)
    await activities.createActivity(trip.id, outside)
    let storedTransfer = await transfers.saveTransfer(trip.id, { ...transfer, fromActivityId: storedA.id, toActivityId: storedB.id })
    flushSync(() => root.render(<Harness />))
    await wait(() => Boolean(dayButton(trip.startDate)))
    assert(dayButton(trip.startDate).textContent?.includes('130') && dayButton('2027-01-01').textContent?.includes('0,00') && dayButton('2027-01-02').textContent?.includes('Aucune dépense'), 'Montants exacts/date/zéro/vide non distingués dans les barres.')
    assert(dayButton(trip.startDate).classList.contains('is-highest') && dayButton(trip.startDate).getAttribute('aria-label')?.includes('2026'), 'Pic connu/date complète non accessibles.')
    assert(host.querySelectorAll('[data-budget-unassigned]').length === 2, 'Dépenses sans date/hors séjour masquées.')
    const beforeToggleReads = reads
    click(toggle('Montants payés'))
    assert(dayButton(trip.startDate).textContent?.includes('45') && toggle('Montants payés', false).getAttribute('aria-pressed') === 'true' && reads === beforeToggleReads, 'Bascule quotidienne désynchronise l’anneau ou relit la base.')
    click(toggle('Montants estimés', false))
    assert(toggle('Montants estimés').getAttribute('aria-pressed') === 'true', 'Bascule de l’anneau non partagée.')
    dayButton('2027-01-02').focus(); click(dayButton('2027-01-02'))
    assert(dayButton('2027-01-02').getAttribute('aria-pressed') === 'true' && host.querySelector('.budget-day-detail')?.textContent?.includes('Aucune dépense renseignée'), 'Sélection/détail journée vide incorrects.')
    const picker = host.querySelector<HTMLSelectElement>('.budget-day-picker select')!
    flushSync(() => { picker.value = trip.startDate; picker.dispatchEvent(new Event('change', { bubbles: true })) })
    assert(host.querySelectorAll('.budget-day-detail .budget-day-expenses li').length === 3 && host.querySelector('.budget-day-detail')?.textContent?.includes('Déplacement'), 'Détail du jour ne contient pas activités et transfert uniques.')
    click(host.querySelector<HTMLButtonElement>('.budget-day-detail-link')!)
    assert(document.activeElement === host.querySelector('.budget-day-detail'), 'Détail non accessible au clavier.')
    storedB = await activities.updateActivity(trip.id, storedB.id, { ...storedB, date: '2027-01-01' })
    await wait(() => dayButton(trip.startDate).textContent?.includes('100') === true)
    assert(host.querySelector('[data-budget-unassigned="undated"]')?.textContent?.includes('Déplacement') && host.querySelectorAll('.budget-day-detail .budget-day-expenses li').length === 1, 'Transfert déplacé mal attribué ou détail obsolète.')
    assert(host.querySelector('[data-budget-unassigned="undated"] summary')?.textContent?.includes('27'), 'Coût du transfert non daté perdu.')
    // Existing repository rules require repairing the shared date before editing
    // the transfer itself; do not weaken that rule to simplify this test.
    storedB = await activities.updateActivity(trip.id, storedB.id, { ...storedB, date: trip.startDate })
    await wait(() => dayButton(trip.startDate).textContent?.includes('130') === true)
    storedTransfer = await transfers.saveTransfer(trip.id, { ...storedTransfer, estimatedCost: 30 }, storedTransfer.id, JSON.stringify(storedTransfer))
    await wait(() => dayButton(trip.startDate).textContent?.includes('140') === true)
    await database.trips.update(trip.id, { manualExchangeRates: [] })
    await wait(() => dayButton(trip.startDate).textContent?.includes('130') === true && dayButton(trip.startDate).textContent?.includes('Incomplet') === true)
    assert(host.querySelector('.budget-day-detail')?.textContent?.includes('Taux de change manquant'), 'Détail ne signale pas les exclusions de conversion.')
    await database.trips.update(trip.id, { startDate: '2026-12-01', endDate: '2027-05-31' })
    await wait(() => host.querySelectorAll('[data-budget-day]').length > 180)
    const scroll = host.querySelector<HTMLElement>('.budget-day-scroll')!
    const firstColumn = host.querySelector<HTMLElement>('.budget-day-bars li')!
    for (const width of [320, 375, 1100]) {
      host.style.width = `${width}px`; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      scroll.scrollLeft = 0
      assert(host.scrollWidth <= host.clientWidth + 1 && scroll.scrollWidth > scroll.clientWidth && Math.abs(firstColumn.getBoundingClientRect().left - scroll.getBoundingClientRect().left) <= 14, `Défilement/position initiale/largeur des barres incorrects à ${width}px.`)
      scroll.scrollLeft = 250; assert(scroll.scrollLeft > 0, 'Défilement horizontal bloqué.')
    }
    assert(picker.labels?.length === 1 && picker.getBoundingClientRect().height >= 44 && dayButton(trip.startDate).getBoundingClientRect().height >= 44, 'Sélection mobile/clavier non labellisée ou non tactile.')
    const before = JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray())))
    click(toggle('Montants payés')); click(dayButton('2027-01-01'))
    assert(JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray()))) === before, 'Consultation quotidienne écrit dans les données.')
    report('Budget quotidien UI : barres/dates/montants, bascule partagée avec l’anneau sans lecture, sélection/détail accessible, transfert déplacé non daté, taux et dépenses réactifs, séjour >180 jours sans rognage ni débordement 320/375/desktop, offline et aucune écriture.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(offlineBefore ? 'offline' : 'online')) }
}
