import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { TripBudget } from '../src/components/budget/TripBudget'
import { buildTripBudget } from '../src/money/tripBudget'
import type { FinancialTotals } from '../src/money/conversion'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import type { ManualTransfer } from '../src/db/transferModel'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function calculated(value: FinancialTotals) { assert(value.status === 'calculated', 'Calcul budget refusé.'); return value }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testTripBudget(report: (message: string) => void) {
  const trip: Trip = { id: 'budget-trip', destination: 'Budget test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 2, image: '', referenceCurrency: 'EUR',
    manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.01, updatedAt: stamp }],
    automaticExchangeRates: { rates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.005, provider: 'frankfurter-v2', rateDate: '2026-11-04', fetchedAt: stamp }], checks: [] } }
  const a = { ...timedFixture('same-id', '09:00', '10:00'), tripId: trip.id, currency: 'EUR', estimatedCost: 100, paidAmount: 40, reservationStatus: 'confirmed' as const }
  const b = { ...timedFixture('b', '11:00', '12:00'), tripId: trip.id, currency: 'JPY', estimatedCost: 1000, paidAmount: 500 }
  const transfer: ManualTransfer = { id: a.id, fromActivityId: a.id, toActivityId: b.id, mode: 'train', currency: 'EUR', estimatedCost: 20, createdAt: stamp, updatedAt: stamp }
  const mixedTrip = { ...trip, manualTransfers: [transfer] }
  const before = JSON.stringify([mixedTrip, a, b])
  const mixed = buildTripBudget(mixedTrip, [a, b])
  assert(calculated(mixed.totals).estimated.amount === 130 && calculated(mixed.totals).paid.amount === 45, 'Total activités/transfert ou priorité manuelle incorrects.')
  assert(calculated(mixed.remaining).estimated.amount === 65 && mixed.unknownRemaining.length === 1, 'Paiement du transfert supposé nul ou reste global soustrait sur des périmètres différents.')
  assert(mixed.entries.length === 3 && calculated(mixed.transferTotals).estimated.amount === 20 && calculated(mixed.activityTotals).estimated.amount === 110, 'Collision d’identifiants activité/transfert ou double comptage.')
  assert(mixed.usedRates.length === 1 && mixed.usedRates[0].source === 'manual' && mixed.usedRates[0].asOf === stamp, 'Provenance/date/résolution de paire perdue.')
  assert(JSON.stringify([mixedTrip, a, b]) === before, 'Calcul budget modifie les données originales.')
  const duplicate = buildTripBudget({ ...mixedTrip, manualTransfers: [transfer, { ...transfer }] }, [a, { ...a }, b])
  assert(calculated(duplicate.totals).estimated.amount === 130, 'Enregistrement répété compté plusieurs fois.')
  const conflict = buildTripBudget(trip, [a, { ...a, estimatedCost: 999 }])
  assert(conflict.issues.length === 1 && !conflict.entries.length, 'Choix arbitraire entre doublons contradictoires.')
  const foreign = buildTripBudget(trip, [a, { ...b, tripId: 'foreign' }])
  assert(calculated(foreign.totals).estimated.amount === 100, 'Montant d’un autre voyage intégré.')
  const automatic = buildTripBudget({ ...trip, manualExchangeRates: [] }, [b])
  assert(calculated(automatic.totals).estimated.amount === 5 && calculated(automatic.totals).paid.amount === 2.5 && automatic.usedRates[0].source === 'automatic', 'Cache automatique non utilisé.')
  const missingRate = buildTripBudget({ ...trip, manualExchangeRates: [], automaticExchangeRates: undefined }, [a, b])
  assert(calculated(missingRate.totals).estimated.amount === 100 && calculated(missingRate.totals).estimated.status === 'partial' && calculated(missingRate.totals).estimated.excluded[0].result.reason === 'missing-rate', 'Montant sans taux compté ou exclusion perdue.')
  const inverseOnly = buildTripBudget({ ...trip, automaticExchangeRates: undefined, manualExchangeRates: [{ sourceCurrency: 'EUR', targetCurrency: 'JPY', rate: 100, updatedAt: stamp }] }, [b])
  assert(calculated(inverseOnly.totals).estimated.amount === null, 'Taux inverse implicitement utilisé par le Budget.')
  const zeroWithoutRate = buildTripBudget({ ...trip, manualExchangeRates: [], automaticExchangeRates: undefined }, [{ ...b, estimatedCost: 0, paidAmount: 0 }])
  assert(calculated(zeroWithoutRate.totals).estimated.amount === null && calculated(zeroWithoutRate.remaining).estimated.amount === null, 'Zéro converti sans taux connu.')
  const legacy = buildTripBudget(trip, [{ ...a, currency: undefined, paidAmount: undefined }])
  assert(calculated(legacy.totals).estimated.amount === null && calculated(legacy.totals).paid.status === 'absent' && legacy.unknownRemaining[0].reason === 'missing-paid', 'Devise historique/absence de paiement transformées en zéro.')
  const invalidLegacy = buildTripBudget(trip, [{ ...a, currency: 'ZZZ', paidAmount: undefined }])
  assert(calculated(invalidLegacy.totals).paid.status === 'absent' && calculated(invalidLegacy.totals).paid.excluded.length === 0, 'Devise invalide invente un paiement exclu absent.')
  const zero = buildTripBudget(trip, [{ ...a, estimatedCost: 0, paidAmount: 0 }])
  assert(zero.hasAmounts && calculated(zero.totals).estimated.amount === 0 && calculated(zero.totals).paid.amount === 0 && calculated(zero.remaining).estimated.amount === 0, 'Montants zéro absents.')
  const empty = buildTripBudget({ ...trip, referenceCurrency: undefined }, [{ ...a, estimatedCost: undefined, paidAmount: undefined }])
  assert(!empty.hasAmounts && calculated(empty.totals).estimated.amount === null && calculated(empty.totals).currency === 'EUR', 'Voyage historique/vide incohérent.')
  const paidOnly = buildTripBudget(trip, [{ ...a, estimatedCost: undefined, paidAmount: 20 }])
  assert(calculated(paidOnly.totals).paid.amount === 20 && calculated(paidOnly.remaining).estimated.amount === null, 'Estimation absente inventée depuis le paiement.')
  for (const status of ['confirmed', 'cancelled', 'to_book'] as const) {
    const reservation = buildTripBudget(trip, [{ ...a, reservationStatus: status, paidAmount: undefined }])
    assert(calculated(reservation.totals).estimated.amount === 100 && calculated(reservation.totals).paid.amount === null, 'Statut de réservation interprété comme paiement/suppression de coût.')
  }
  const overpaid = buildTripBudget(trip, [{ ...a, paidAmount: 150 }, { ...a, id: 'unpaid', estimatedCost: 40, paidAmount: 0 }])
  assert(calculated(overpaid.remaining).estimated.amount === 40 && overpaid.overpaidCount === 1, 'Dépassement compense silencieusement une autre dette.')
  const drift = buildTripBudget(mixedTrip, [a, { ...b, date: '2027-01-01' }])
  assert(calculated(drift.transferTotals).estimated.amount === 20, 'Changement de date/GPS efface une dépense de transfert.')
  const orphan = buildTripBudget({ ...trip, manualTransfers: [{ ...transfer, toActivityId: 'missing' }] }, [a])
  assert(orphan.issues.length === 1 && calculated(orphan.totals).estimated.amount === 100, 'Transfert orphelin intégré.')
  const fractional = buildTripBudget(trip, [{ ...a, estimatedCost: 0.004, paidAmount: 0.001 }, { ...a, id: 'fraction', estimatedCost: 0.004, paidAmount: 0.001 }])
  assert(calculated(fractional.totals).estimated.amount === 0.008 && calculated(fractional.remaining).estimated.amount === 0.006, 'Arrondi intermédiaire introduit.')
  const overflow = buildTripBudget(trip, [{ ...a, estimatedCost: Number.MAX_VALUE }, { ...b, currency: 'EUR', estimatedCost: Number.MAX_VALUE }])
  assert(calculated(overflow.totals).estimated.status === 'invalid' && calculated(overflow.totals).estimated.amount === null, 'Débordement numérique affiché comme un total.')
  assert(buildTripBudget({ ...trip, referenceCurrency: 'ZZZ' }, [a]).totals.status === 'invalid', 'Cible invalide acceptée.')
  report('Budget pur : activités/transferts sans double comptage, priorité manuelle/cache, absences/zéro/devises historiques, exclusions, paiements partiels, reste par élément, réservations, dépassements, isolation, précision et immutabilité.')

  const database = new RoamDatabase(`roam-v2-test-budget-${crypto.randomUUID()}`)
  const activities = createActivityRepository(database), transfers = createTransferRepository(database)
  const host = document.createElement('div'); host.style.width = '320px'; host.style.maxWidth = '100%'; document.body.append(host)
  const root = createRoot(host)
  const wasOffline = connection.getSnapshot().offline
  let reads = 0, failRead = false
  const read = (id: string) => { reads++; return failRead ? Promise.reject(new Error('Lecture simulée indisponible')) : activities.listActivities(id) }
  function Harness({ id = trip.id }: { id?: string }) {
    const current = useLiveQuery(() => database.trips.get(id), [id])
    return current ? <TripBudget key={current.id} trip={current} readActivities={read} /> : null
  }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Budget réactif non actualisé.') }
  const amount = (title: string) => host.querySelector(`[aria-label="${title}"] .budget-amount`)?.textContent ?? ''
  try {
    window.dispatchEvent(new Event('offline'))
    await database.trips.bulkAdd([trip, { ...trip, id: 'budget-other', destination: 'Autre budget' }])
    flushSync(() => root.render(<Harness />))
    await wait(() => host.textContent?.includes('Aucune dépense renseignée') === true)
    assert(!host.querySelector('.budget-summary-grid') && reads === 1, 'État vide affiché comme un budget zéro.')
    let storedA = await activities.createActivity(trip.id, a)
    const storedB = await activities.createActivity(trip.id, b)
    let storedTransfer = await transfers.saveTransfer(trip.id, { ...transfer, fromActivityId: storedA.id, toActivityId: storedB.id })
    await wait(() => amount('Total estimé').includes('130') && amount('Total payé').includes('45'))
    assert(amount('Reste à payer connu').includes('65') && host.textContent?.includes('sans montant payé'), 'Reste ou limites du modèle transferts non affichés.')
    assert(host.scrollWidth <= host.clientWidth + 1, 'Budget déborde à 320 px.')
    storedA = await activities.updateActivity(trip.id, storedA.id, { ...storedA, paidAmount: 70 })
    await wait(() => amount('Total payé').includes('75') && amount('Reste à payer connu').includes('35'))
    storedTransfer = await transfers.saveTransfer(trip.id, { ...storedTransfer, estimatedCost: 40 }, storedTransfer.id, JSON.stringify(storedTransfer))
    await wait(() => amount('Total estimé').includes('150'))
    await database.trips.update(trip.id, { manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.02, updatedAt: stamp }] })
    await wait(() => amount('Total estimé').includes('160') && amount('Total payé').includes('80'))
    await database.trips.update(trip.id, { manualExchangeRates: [], automaticExchangeRates: undefined })
    await wait(() => Boolean(host.querySelector('.budget-exclusions')))
    assert(amount('Total estimé').includes('140') && host.querySelector('.budget-exclusions')?.textContent?.includes('JPY') && host.querySelector('.budget-exclusions')?.textContent?.includes('Taux de change manquant'), 'Exclusions/conservation du montant d’origine absentes.')
    await database.trips.update(trip.id, { referenceCurrency: 'JPY', manualExchangeRates: [{ sourceCurrency: 'EUR', targetCurrency: 'JPY', rate: 100, updatedAt: stamp }] })
    await wait(() => amount('Total estimé').includes('JPY') && !host.querySelector('.budget-exclusions'))
    assert(amount('Total estimé').includes('15') && host.querySelector('time[datetime]'), 'Changement de devise/taux non réactif ou date du taux absente.')
    const beforeSnapshot = JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray())))
    for (const width of [320, 375, 1100]) {
      host.style.width = `${width}px`; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      assert(host.scrollWidth <= host.clientWidth + 1, `Budget déborde à ${width}px.`)
    }
    const summary = host.querySelector<HTMLElement>('.budget-rates summary')!
    summary.focus(); assert(document.activeElement === summary && summary.getBoundingClientRect().height >= 44, 'Informations de taux non accessibles au clavier/tactile.')
    flushSync(() => summary.click())
    assert(JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray()))) === beforeSnapshot, 'Affichage du Budget écrit dans IndexedDB.')
    await activities.createActivity('budget-other', { ...a, estimatedCost: 99999, paidAmount: 0 })
    assert(!amount('Total estimé').includes('99'), 'Budget inclut un autre voyage.')
    flushSync(() => root.render(<Harness id="budget-other" />))
    await wait(() => host.textContent?.includes('Autre budget') === true)
    assert(!host.textContent?.includes('Budget test'), 'Changement de voyage conserve les anciens chiffres.')
    failRead = true
    flushSync(() => root.render(<TripBudget key="error" trip={trip} readActivities={read} />))
    await wait(() => Boolean(host.querySelector('[role="alert"]')))
    assert(!host.querySelector('.budget-amount'), 'Erreur de lecture affiche des chiffres trompeurs.')
    failRead = false
    flushSync(() => host.querySelector<HTMLButtonElement>('button')!.click())
    await wait(() => Boolean(host.querySelector('.budget-summary-grid')))
    assert(host.querySelector('#trip-budget-title'), 'Réessai de lecture échoue.')
    report('Budget UI : base isolée, état vide, réactivité activités/transferts/devise/taux, exclusions et montants originaux, offline, isolation voyage, erreur/réessai, clavier, 320/375/desktop et aucune écriture au rendu.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete(); window.dispatchEvent(new Event(wasOffline ? 'offline' : 'online')) }
}
