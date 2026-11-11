const noStays=async()=>[]
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TripBudget } from '../src/components/budget/TripBudget'
import { buildTripBudget, budgetCategoryDistribution } from '../src/money/tripBudget'
import { activityBudgetCategory } from '../src/money/budgetCategories'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey, type ManualTransfer } from '../src/db/transferModel'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testBudgetCategories(report: (message: string) => void) {
  const trip: Trip = { id: 'categories-trip', destination: 'Catégories test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 1, image: '',
    manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.01, updatedAt: stamp }],
    automaticExchangeRates: { rates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.005, rateDate: '2026-11-04', fetchedAt: stamp, provider: 'frankfurter-v2' }], checks: [] } }
  const a = { ...timedFixture('food', '09:00', '10:00'), tripId: trip.id, category: 'meal' as const, currency: 'JPY', estimatedCost: 1000, paidAmount: 500 }
  const b = { ...timedFixture('visit', '11:00', '12:00'), tripId: trip.id, category: 'visit' as const, currency: 'EUR', estimatedCost: 30, paidAmount: 10 }
  const extra = [
    { ...b, id: 'outing', category: 'outing' as const, estimatedCost: 10, paidAmount: 0 },
    { ...b, id: 'transport', category: 'transport' as const, estimatedCost: 20, paidAmount: 10 },
    { ...b, id: 'rest', category: 'rest' as const, title: 'Hôtel ne doit pas être deviné', estimatedCost: 5, paidAmount: undefined },
    { ...b, id: 'other', category: 'other' as const, estimatedCost: 0, paidAmount: 0 },
  ]
  const transfer: ManualTransfer = { id: a.id, fromActivityId: a.id, toActivityId: b.id, currency: 'EUR', mode: 'bus', estimatedCost: 5, createdAt: stamp, updatedAt: stamp }
  const sourceTrip = { ...trip, manualTransfers: [transfer, { ...transfer }] }
  const population = [a, b, ...extra, { ...a }, { ...b, tripId: 'foreign', estimatedCost: 10000 }]
  const before = JSON.stringify([sourceTrip, population])
  const budget = buildTripBudget(sourceTrip, population)
  const estimated = budgetCategoryDistribution(budget, 'estimated'), paid = budgetCategoryDistribution(budget, 'paid')
  const category = (id: string) => estimated.rows.find((row) => row.id === id)!
  assert(estimated.total?.amount === 80 && paid.total?.amount === 25, 'Le graphique diverge des totaux du Budget.')
  assert(category('food').value?.amount === 10 && category('activities').value?.amount === 40 && category('transport').value?.amount === 25 && category('other').value?.amount === 5, 'Regroupement des catégories/transferts/priorité manuelle incorrect.')
  assert(category('accommodation').value?.amount === null && !category('accommodation').supported && category('accommodation').percentage === null, 'Hébergement inventé à partir d’un lieu ou d’un repos.')
  assert(category('food').percentage === 12.5 && category('activities').percentage === 50 && category('transport').percentage === 31.25, 'Pourcentages non calculés sur le total connu convertible.')
  assert(Math.abs(estimated.segments.reduce((sum, segment) => sum + segment.size, 0) - 100) < 1e-10 && estimated.segments.every((segment) => segment.size >= 0 && segment.offset >= 0), 'Anneau incomplet/invalide.')
  assert(paid.rows.find((row) => row.id === 'transport')?.value?.amount === 10 && paid.total.absentCount === 2, 'Paiement des transferts déduit de l’estimation ou absence effacée.')
  assert(JSON.stringify([sourceTrip, population]) === before, 'Catégorisation modifie les données originales.')
  for (const [input, output] of [['visit', 'activities'], ['outing', 'activities'], ['transport', 'transport'], ['meal', 'food'], ['rest', 'other'], ['other', 'other']] as const) assert(activityBudgetCategory(input) === output, 'Catégorie réelle mal affectée.')
  const missing = buildTripBudget({ ...trip, manualExchangeRates: [], automaticExchangeRates: undefined }, [a, b, { ...b, id: 'unknown', estimatedCost: undefined, paidAmount: undefined }])
  const unavailable = budgetCategoryDistribution(missing, 'estimated')
  assert(unavailable.total?.amount === 30 && unavailable.total.excluded.length === 1 && unavailable.total.absentCount === 1 && unavailable.rows.find((row) => row.id === 'activities')?.percentage === 100, 'Inconnus/non convertibles entrent dans le dénominateur.')
  assert(unavailable.rows.find((row) => row.id === 'food')?.value?.amount === null && unavailable.rows.find((row) => row.id === 'food')?.percentage === null, 'Montant non convertible affiché comme zéro.')
  const auto = budgetCategoryDistribution(buildTripBudget({ ...trip, manualExchangeRates: [] }, [a]), 'estimated')
  assert(auto.total?.amount === 5 && auto.rows.find((row) => row.id === 'food')?.percentage === 100, 'Cache automatique non réutilisé par la répartition.')
  const zeros = budgetCategoryDistribution(buildTripBudget(trip, [{ ...b, estimatedCost: 0, paidAmount: 0 }]), 'estimated')
  assert(zeros.total?.amount === 0 && !zeros.drawable && !zeros.segments.length && zeros.rows.every((row) => row.percentage === null), 'Répartition inventée sur un dénominateur nul.')
  const mixedZero = budgetCategoryDistribution(buildTripBudget(trip, [b, { ...a, estimatedCost: 0 }]), 'estimated')
  assert(mixedZero.rows.find((row) => row.id === 'food')?.percentage === 0 && mixedZero.segments.length === 1, 'Vrai zéro mal distingué d’un inconnu.')
  const allUnknown = budgetCategoryDistribution(buildTripBudget(trip, [{ ...b, estimatedCost: undefined, paidAmount: undefined }]), 'paid')
  assert(allUnknown.total?.amount === null && !allUnknown.drawable && !allUnknown.segments.length, 'Données absentes représentées comme zéro.')
  const thirds = budgetCategoryDistribution(buildTripBudget(trip, [{ ...b, estimatedCost: 1 }, { ...a, currency: 'EUR', estimatedCost: 1 }, { ...extra[2], estimatedCost: 1 }]), 'estimated')
  assert(thirds.rows.filter((row) => row.percentage !== null).every((row) => Math.abs(row.percentage! - 100 / 3) < 1e-12), 'Pourcentages arrondis avant affichage.')
  const overflow = budgetCategoryDistribution(buildTripBudget(trip, [{ ...b, estimatedCost: Number.MAX_VALUE }, { ...a, currency: 'EUR', estimatedCost: Number.MAX_VALUE }]), 'estimated')
  assert(!overflow.drawable && !overflow.segments.length && overflow.rows.every((row) => row.percentage === null), 'Anneau affiché avec un total infini.')
  report('Répartition pure : six catégories réelles regroupées, hébergement non inventé, transferts sans doublon, estimé/payé, devises/taux, exclusions/absences/zéro, pourcentages non arrondis, géométrie et immutabilité.')

  const database = new RoamDatabase(`roam-v2-test-budget-categories-${crypto.randomUUID()}`)
  const activities = createActivityRepository(database), transfers = createTransferRepository(database)
  const host = document.createElement('div'); host.style.width = '320px'; host.style.maxWidth = '100%'; document.body.append(host)
  const root = createRoot(host)
  const wasOffline = connection.getSnapshot().offline
  let reads = 0
  const read = (id: string) => { reads++; return activities.listActivities(id) }
  function Harness() {
    const liveTrip = useLiveQuery(() => database.trips.get(trip.id), [])
    return liveTrip ? <TripBudget readAccommodations={noStays} readJourneys={async()=>[]} trip={liveTrip} readActivities={read} /> : null
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Répartition réactive non actualisée.') }
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-category-row="${id}"]`)!
  const mode = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.budget-category-toggle button')].find((button) => button.textContent === label)!
  try {
    window.dispatchEvent(new Event('offline'))
    await database.trips.add(trip)
    let storedA = await activities.createActivity(trip.id, a)
    let storedB = await activities.createActivity(trip.id, b)
    let storedTransfer = await transfers.saveTransfer(trip.id, { ...transfer, fromActivityId: storedA.id, toActivityId: storedB.id })
    flushSync(() => root.render(<Harness />))
    await wait(() => Boolean(host.querySelector('.budget-donut-stage svg')))
    const image = host.querySelector<SVGElement>('.budget-donut-stage svg')!
    assert(image.getAttribute('role') === 'img' && image.querySelector('title') && image.querySelector('desc') && image.getAttribute('aria-labelledby'), 'Anneau sans alternative accessible.')
    assert(host.querySelectorAll('.budget-category-legend dt').length === 5 && row('accommodation').textContent?.includes('Non distingué'), 'Légende/catégorie non disponible absentes.')
    assert(row('food').textContent?.includes('22,2 %') && row('transport').textContent?.includes('11,1 %'), 'Pourcentages estimés incohérents avec le tableau de bord.')
    const readCount = reads
    mode('Montants payés').focus()
    assert(document.activeElement === mode('Montants payés') && mode('Montants payés').getBoundingClientRect().height >= 44, 'Bascule non accessible/tactile.')
    flushSync(() => mode('Montants payés').click())
    assert(mode('Montants payés').getAttribute('aria-pressed') === 'true' && row('transport').textContent?.includes('Non renseigné') && row('transport').textContent?.includes('non renseigné'), 'Paiement absent du transfert inventé.')
    assert(reads === readCount && row('food').textContent?.includes('33,3 %'), 'Bascule relit IndexedDB ou calcule les pourcentages estimés.')
    storedA = await activities.updateActivity(trip.id, storedA.id, { ...storedA, category: 'other', paidAmount: 1000 })
    await wait(() => row('other').textContent?.includes('50 %') === true)
    assert(mode('Montants payés').getAttribute('aria-pressed') === 'true' && row('food').textContent?.includes('Non renseigné'), 'Modification de catégorie remet le mode à zéro ou laisse l’ancien montant.')
    await database.trips.update(trip.id, { manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.02, updatedAt: stamp }] })
    await wait(() => row('other').textContent?.includes('66,7 %') === true)
    flushSync(() => mode('Montants estimés').click())
    storedTransfer = await transfers.saveTransfer(trip.id, { ...storedTransfer, estimatedCost: 10 }, storedTransfer.id, transferKey(storedTransfer))
    await wait(() => row('transport').textContent?.includes('16,7 %') === true)
    await database.trips.update(trip.id, { manualExchangeRates: [], automaticExchangeRates: undefined })
    await wait(() => row('other').textContent?.includes('Non convertible') === true)
    assert(row('transport').textContent?.includes('25 %') && host.querySelector('.budget-category-section')?.textContent?.includes('non intégré'), 'Exclusion sans taux ou dénominateur incomplet non signalés.')
    const beforeToggle = JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray())))
    for (const width of [320, 375, 1100]) {
      host.style.width = `${width}px`; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      assert(host.scrollWidth <= host.clientWidth + 1, `Anneau/légende débordent à ${width}px.`)
    }
    flushSync(() => mode('Montants payés').click())
    assert(JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray()))) === beforeToggle, 'Bascule du graphique écrit dans les données.')
    storedB = await activities.updateActivity(trip.id, storedB.id, { ...storedB, estimatedCost: 0, paidAmount: 0 })
    await wait(() => host.querySelector('.budget-donut-empty')?.textContent?.includes('à zéro') === true)
    assert(!host.querySelector('.budget-donut-stage svg') && row('activities').textContent?.includes('0,00'), 'État zéro vide invente un anneau ou perd le vrai zéro.')
    storedB = await activities.updateActivity(trip.id, storedB.id, { ...storedB, estimatedCost: 0, paidAmount: undefined })
    await wait(() => host.querySelector('.budget-donut-empty')?.textContent?.includes('Aucun montant convertible') === true)
    assert(host.querySelector('.budget-category-section')?.textContent?.includes('sans être considérés comme zéro'), 'Absences non signalées dans la vue payée.')
    report('Répartition UI : SVG nommé et légende textuelle, bascule clavier sans lecture/écriture, réactivité catégories/paiements/taux/transferts, exclusions et états zéro/absence, mode préservé, offline et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(wasOffline ? 'offline' : 'online')) }
}
