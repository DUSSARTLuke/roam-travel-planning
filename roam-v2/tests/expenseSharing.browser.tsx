import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ExpenseSharing } from '../src/components/budget/ExpenseSharing'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey } from '../src/db/transferModel'
import { createExpenseSharingRepository } from '../src/db/expenseSharing'
import { calculateExpenseSharing, sharingMinorUnits, allocateSharingUnits, validateParticipants, validateExpenseShares, validateTripSharing, sharingVersion, parseSharingAmount, formatSharingMinorUnits, type ExpenseShare } from '../src/money/expenseSharing'
import { buildTripBudget } from '../src/money/tripBudget'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { validateRestoreArchive } from '../src/backup/validateRestore'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { readBackupZip } from '../src/backup/readZip'
import { createStoredZip } from '../src/backup/zip'
import { sha256 } from '../src/backup/sha256'
import { connection } from '../src/pwa/connection'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Une opération de partage invalide a réussi.') }
function calculated(value: ReturnType<typeof calculateExpenseSharing>) { assert(value.status === 'calculated', 'Partage non calculable.'); return value }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testExpenseSharing(report: (message: string) => void) {
  const participants = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }, { id: 'c', name: 'Chloé' }]
  const trip: Trip = { id: 'sharing-trip', destination: 'Test partage', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 2, image: '', participants }
  const activity = { ...timedFixture('shared', '09:00', '10:00'), tripId: trip.id, currency: 'EUR', estimatedCost: 100, paidAmount: 40 }
  const share: ExpenseShare = { kind: 'activity', expenseId: activity.id, payerId: 'a', shares: [{ participantId: 'a', weight: 1 }, { participantId: 'b', weight: 1 }], amount: 40, currency: 'EUR', updatedAt: stamp }
  const source = { ...trip, expenseShares: [share] }
  const before = JSON.stringify([source, activity])
  const couple = calculated(calculateExpenseSharing(source, [activity]))
  assert(couple.rows[0].paidMinor === 4000 && couple.rows[0].owedMinor === 2000 && couple.rows[0].balanceMinor === 2000 && couple.reimbursements[0].from === 'b' && couple.reimbursements[0].to === 'a' && couple.reimbursements[0].minor === 2000, 'Couple/paiement partiel : estimation partagée ou soldes incorrects.')
  assert(couple.rows.reduce((sum, row) => sum + row.balanceMinor, 0) === 0 && JSON.stringify([source, activity]) === before, 'Soldes déséquilibrés ou données mutées.')
  const legacy = calculated(calculateExpenseSharing({ ...trip, participants: undefined }, [activity]))
  assert(legacy.included === 0 && !legacy.rows.length && legacy.unshared === 1, 'Anciennes dépenses activées ou participants inventés.')
  const solo = calculated(calculateExpenseSharing({ ...trip, expenseShares: [{ ...share, shares: [{ participantId: 'a', weight: 1 }] }] }, [activity]))
  assert(solo.rows.every((row) => row.balanceMinor === 0) && !solo.reimbursements.length, 'Voyage solo crée une dette.')
  const tiny = allocateSharingUnits(1, participants.map((participant) => ({ participantId: participant.id, weight: 1 })))
  assert(tiny.get('a') === 1n && tiny.get('b') === 0n && [...tiny.values()].reduce((sum, value) => sum + value, 0n) === 1n, 'Centime perdu/inventé au partage égal.')
  const weighted = allocateSharingUnits(101, [{ participantId: 'a', weight: 1 }, { participantId: 'b', weight: 2 }, { participantId: 'c', weight: 1 }])
  assert(weighted.get('a') === 25n && weighted.get('b') === 51n && weighted.get('c') === 25n, 'Parts pondérées/plus forts restes incorrects.')
  assert(formatSharingMinorUnits(Number.MAX_SAFE_INTEGER, 'EUR').includes(',91'), 'Formatage des unités perd des centimes par division flottante.')
  assert(sharingMinorUnits(1.005, 2) === 101 && sharingMinorUnits(1.001, 3) === 1001 && sharingMinorUnits(101, 0) === 101, 'Arrondi EUR/KWD/JPY incorrect.')
  for (const invalid of ['', '-1', 'NaN', 'Infinity', '1,2,3']) await rejects(() => parseSharingAmount(invalid))
  assert(parseSharingAmount('40,50') === 40.5, 'Virgule française refusée.')
  await rejects(() => allocateSharingUnits(1, [{ participantId: 'a', weight: 0 }]))
  await rejects(() => validateParticipants([{ id: 'a', name: '' }]))
  for (const invalid of [{ ...share, payerId: 'foreign' }, { ...share, shares: [] }, { ...share, shares: [{ participantId: 'b', weight: -1 }] }, { ...share, currency: 'ZZZ' }, { ...share, amount: NaN }, { ...share, shares: [share.shares[0], share.shares[0]] }]) await rejects(() => validateExpenseShares([invalid], participants))
  await rejects(() => validateExpenseShares([share, share], participants))
  const missing = calculated(calculateExpenseSharing(source, [{ ...activity, paidAmount: undefined }]))
  assert(missing.included === 0 && missing.issues.length === 1 && !missing.reimbursements.length, 'Paiement inconnu interprété comme payé.')
  const changed = calculated(calculateExpenseSharing(source, [{ ...activity, paidAmount: 50 }]))
  assert(changed.included === 0 && changed.issues[0].reason.includes('revalide'), 'Nouveau montant partagé sans confirmation.')
  const zero = calculated(calculateExpenseSharing({ ...trip, expenseShares: [{ ...share, amount: 0 }] }, [{ ...activity, paidAmount: 0 }]))
  assert(zero.included === 1 && zero.rows.every((row) => row.balanceMinor === 0), 'Vrai zéro perdu.')
  const fxShare = { ...share, amount: 500, currency: 'JPY' }, fxActivity = { ...activity, paidAmount: 500, currency: 'JPY' }
  const fxTrip = { ...trip, expenseShares: [fxShare], manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.01, updatedAt: stamp }], automaticExchangeRates: { rates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.005, rateDate: '2026-11-04', fetchedAt: stamp, provider: 'frankfurter-v2' as const }], checks: [] } }
  assert(calculated(calculateExpenseSharing(fxTrip, [fxActivity])).rows[0].paidMinor === 500, 'Priorité du taux manuel perdue.')
  assert(calculated(calculateExpenseSharing({ ...fxTrip, manualExchangeRates: [] }, [fxActivity])).rows[0].paidMinor === 250, 'Cache automatique non utilisé.')
  const noRate = calculated(calculateExpenseSharing({ ...fxTrip, manualExchangeRates: [], automaticExchangeRates: undefined }, [fxActivity]))
  assert(noRate.included === 0 && noRate.issues[0].reason.includes('Conversion'), 'Taux manquant remplacé ou montant non convertible ignoré silencieusement.')
  for (const [currency, amount, units] of [['JPY', 101, 101], ['KWD', 1.001, 1001]] as const) {
    const value = calculated(calculateExpenseSharing({ ...trip, referenceCurrency: currency, expenseShares: [{ ...share, currency, amount }] }, [{ ...activity, currency, paidAmount: amount }]))
    assert(value.rows.reduce((sum, row) => sum + row.owedMinor, 0) === units, 'Décimales monétaires non respectées.')
  }
  const changedReference = calculated(calculateExpenseSharing({ ...source, referenceCurrency: 'JPY', manualExchangeRates: [{ sourceCurrency: 'EUR', targetCurrency: 'JPY', rate: 100, updatedAt: stamp }] }, [activity]))
  assert(changedReference.currency === 'JPY' && changedReference.rows[0].paidMinor === 4000 && changedReference.rows[0].owedMinor === 2000, 'Changement de référence réinterprète ou supprime le partage.')
  await rejects(() => validateTripSharing(source, new Map([[activity.id, { ...activity, tripId: 'foreign' }]])))
  assert(JSON.stringify(buildTripBudget(source, [activity]).totals) === JSON.stringify(buildTripBudget(trip, [activity]).totals), 'Métadonnées de partage changent le Budget existant.')
  report('Partages purs : solo/couple/groupe, legacy non activé, paiement partiel/inconnu/zéro, poids, centimes exacts/JPY/KWD, remboursements équilibrés, priorité manuelle/cache, exclusions et immutabilité.')

  const database = new RoamDatabase(`roam-v2-test-sharing-${crypto.randomUUID()}`), second = new RoamDatabase(database.name), target = new RoamDatabase(`roam-v2-test-sharing-restore-${crypto.randomUUID()}`)
  const repo = createExpenseSharingRepository(database), other = createExpenseSharingRepository(second), activities = createActivityRepository(database), transfers = createTransferRepository(database)
  const host = document.createElement('div'); host.style.width = '320px'; host.style.maxWidth = '100%'; document.body.append(host)
  const root = createRoot(host)
  const offline = connection.getSnapshot().offline
  async function fingerprint() { return JSON.stringify(await Promise.all(database.tables.map((table) => table.toArray()))) }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((ready) => setTimeout(ready, 20)); assert(condition(), 'Interface de partage non actualisée.') }
  try {
    await database.trips.add({ ...trip, participants: undefined })
    await second.open()
    const alice = await repo.saveParticipant(trip.id, 'Alice'), bob = await repo.saveParticipant(trip.id, 'Bob'), unused = await repo.saveParticipant(trip.id, 'À supprimer')
    await repo.deleteParticipant(trip.id, unused.id, unused.name)
    const storedA = await activities.createActivity(trip.id, { ...activity, paidAmount: undefined }), storedB = await activities.createActivity(trip.id, { ...activity, title: 'Arrivée', estimatedCost: undefined, paidAmount: undefined })
    const reference = { kind: 'activity' as const, expenseId: storedA.id }
    const input = { amount: 40, payerId: alice.id, shares: [{ participantId: alice.id, weight: 1 }, { participantId: bob.id, weight: 1 }] }
    const originalVersion = sharingVersion(storedA, undefined)
    let saved = await repo.saveShare(trip.id, reference, input, originalVersion)
    assert((await database.activities.get(storedA.id))?.paidAmount === 40 && (await database.activities.get(storedA.id))?.estimatedCost === 100, 'Paiement explicite non écrit atomiquement ou estimation modifiée.')
    await rejects(() => other.saveShare(trip.id, reference, { ...input, amount: 99 }, originalVersion))
    await rejects(() => other.deleteParticipant(trip.id, alice.id, alice.name))
    await Promise.all([other.saveParticipant(trip.id, 'Ben', bob.id, bob.name), repo.saveShare(trip.id, reference, input, sharingVersion((await database.activities.get(storedA.id))!, saved))])
    let liveTrip = (await database.trips.get(trip.id))!
    assert(liveTrip.participants?.find((item) => item.id === bob.id)?.name === 'Ben' && liveTrip.expenseShares?.length === 1, 'Écrasement de champs concurrents du voyage.')
    saved = liveTrip.expenseShares![0]
    const beforeRollback = await fingerprint()
    const fail = () => { throw new Error('Écriture de voyage refusée (test)') }
    database.trips.hook('updating', fail)
    try { await rejects(async () => repo.saveShare(trip.id, reference, { ...input, amount: 60 }, sharingVersion((await database.activities.get(storedA.id))!, saved))) }
    finally { database.trips.hook('updating').unsubscribe(fail) }
    assert(await fingerprint() === beforeRollback, 'Paiement ou partage partiellement enregistré après erreur.')
    const transfer = await transfers.saveTransfer(trip.id, { fromActivityId: storedA.id, toActivityId: storedB.id, mode: 'bus', currency: 'EUR', estimatedCost: 10 })
    await repo.saveShare(trip.id, { kind: 'transfer', expenseId: transfer.id }, { ...input, amount: 10, payerId: bob.id }, sharingVersion(transfer, undefined))
    let latestTransfer = (await database.trips.get(trip.id))!.manualTransfers![0]
    const { paidAmount: _paid, ...quickFields } = latestTransfer
    latestTransfer = await transfers.saveTransfer(trip.id, { ...quickFields, notes: 'Modification rapide' }, transfer.id, transferKey(latestTransfer))
    assert(latestTransfer.paidAmount === 10, 'Modification du transfert perd son paiement avancé.')
    liveTrip = (await database.trips.get(trip.id))!
    const oldBudget = buildTripBudget(liveTrip, await activities.listActivities(trip.id))
    assert(oldBudget.totals.status === 'calculated' && oldBudget.totals.paid.amount === 40, 'Périmètre 2.8a changé par le paiement du transfert.')
    assert(calculated(calculateExpenseSharing(liveTrip, await activities.listActivities(trip.id))).included === 2, 'Transfert partagé non calculé.')
    const raceParticipant = await repo.saveParticipant(trip.id, 'Course')
    const raceSource = (await database.activities.get(storedA.id))!, raceShare = (await database.trips.get(trip.id))!.expenseShares!.find((item) => item.kind === 'activity')!
    const race = await Promise.allSettled([
      other.deleteParticipant(trip.id, raceParticipant.id, raceParticipant.name),
      repo.saveShare(trip.id, reference, { ...input, shares: [...input.shares, { participantId: raceParticipant.id, weight: 1 }] }, sharingVersion(raceSource, raceShare)),
    ])
    assert(race.some((item) => item.status === 'rejected'), 'Suppression et attribution concurrentes ont toutes deux réussi.')
    liveTrip = (await database.trips.get(trip.id))!
    validateTripSharing(liveTrip, new Map((await activities.listActivities(trip.id)).map((item) => [item.id, item])))
    // Restore the two-person allocation deliberately, with the latest version.
    saved = liveTrip.expenseShares!.find((item) => item.kind === 'activity')!
    await repo.saveShare(trip.id, reference, input, sharingVersion((await database.activities.get(storedA.id))!, saved))
    if (liveTrip.participants!.some((item) => item.id === raceParticipant.id)) await repo.deleteParticipant(trip.id, raceParticipant.id, raceParticipant.name)
    liveTrip = (await database.trips.get(trip.id))!
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const validated = await validateRestoreArchive(archive.blob)
    assert(validated.trips[0].expenseShares?.length === 2 && validated.trips[0].manualTransfers?.[0].paidAmount === 10 && archive.manifest.formatVersion === 1 && database.verno === 5, 'ZIP perd participants/parts/paiement ou migration inutile.')
    const prepared = await prepareRestore(archive.blob), preview = await previewRestore(prepared, target)
    await restoreBackup(prepared, preview, target)
    const restored = (await target.trips.get(trip.id))!
    assert(JSON.stringify(calculateExpenseSharing(restored, await target.activities.where('tripId').equals(trip.id).toArray())) === JSON.stringify(calculateExpenseSharing(liveTrip, await activities.listActivities(trip.id))), 'Soldes changés après restauration.')
    const files = await readBackupZip(archive.blob), tripsJson = JSON.parse(await files.get('data/trips.json')!.text())
    tripsJson[0].expenseShares[0].payerId = 'intrus'
    const modified = new Blob([JSON.stringify(tripsJson)]), manifest = JSON.parse(await files.get('manifest.json')!.text())
    files.set('data/trips.json', modified)
    const inventory = manifest.inventory.find((entry: { path: string }) => entry.path === 'data/trips.json'); inventory.size = modified.size; inventory.sha256 = await sha256(modified)
    files.set('manifest.json', new Blob([JSON.stringify(manifest)]))
    const malformed = await createStoredZip([...files].map(([path, blob]) => ({ path, blob })))
    await rejects(() => validateRestoreArchive(malformed))
    await activities.updateActivity(trip.id, storedA.id, { ...(await activities.getActivity(trip.id, storedA.id)), paidAmount: 50 })
    assert(calculated(calculateExpenseSharing((await database.trips.get(trip.id))!, await activities.listActivities(trip.id))).issues.length === 1, 'Paiement modifié partagé sans revalidation.')
    await transfers.deleteTransfer(trip.id, transfer.id, transferKey(latestTransfer))
    assert(!(await database.trips.get(trip.id))!.expenseShares!.some((item) => item.kind === 'transfer'), 'Partage orphelin après suppression de transfert.')
    await activities.deleteActivity(trip.id, storedA.id)
    assert((await database.trips.get(trip.id))!.expenseShares!.length === 0, 'Partage orphelin après suppression d’activité.')
    await repo.deleteParticipant(trip.id, alice.id, alice.name)
    await repo.saveParticipant(trip.id, 'Benoît', bob.id, 'Ben')
    await rejects(() => other.saveParticipant(trip.id, 'Écrasement', bob.id, 'Ben'))
    await database.trips.update(trip.id, { archived: true })
    await rejects(() => repo.saveParticipant(trip.id, 'Refusé'))
    await database.trips.update(trip.id, { archived: false })
    await updateTripTrash(trip.id, 'trash', undefined, database)
    await rejects(() => repo.saveParticipant(trip.id, 'Refusé'))
    await updateTripTrash(trip.id, 'restore', undefined, database)
    database.close(); await database.open()
    assert((await database.trips.get(trip.id))!.participants![0].name === 'Benoît', 'Participant perdu après réouverture.')
    report('Partages stockage/ZIP : CRUD, concurrence par champs, participant référencé protégé, paiement atomique/rollback, transfert préservé à l’édition, V4/format1 et validation des références, round-trip, cascades et archive/corbeille.')

    // UI uses only the temporary database/repository, with real writes.
    const uiTrip = { ...trip, id: 'sharing-ui', participants: undefined }
    await database.trips.add(uiTrip)
    const uiAlice = await repo.saveParticipant(uiTrip.id, 'Alice UI'), uiBob = await repo.saveParticipant(uiTrip.id, 'Bob UI')
    const uiActivity = await activities.createActivity(uiTrip.id, { ...activity, paidAmount: undefined })
    function Harness() {
      const current = useLiveQuery(() => database.trips.get(uiTrip.id), []), rows = useLiveQuery(() => activities.listActivities(uiTrip.id), [])
      return current && rows ? <ExpenseSharing trip={current} activities={rows} repository={repo} /> : null
    }
    window.dispatchEvent(new Event('offline'))
    flushSync(() => root.render(<Harness />))
    await wait(() => host.textContent?.includes('Alice UI') === true)
    const setValue = (input: HTMLInputElement, value: string) => flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)!
    flushSync(() => button('Ajouter un participant').click())
    await wait(() => Boolean(host.querySelector('dialog[open]')))
    setValue(host.querySelector('dialog input')!, 'Chloé UI')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Chloé UI') === true)
    const picker = host.querySelector<HTMLSelectElement>('.sharing-source-picker select')!
    flushSync(() => { picker.value = `activity:${uiActivity.id}`; picker.dispatchEvent(new Event('change', { bubbles: true })) })
    flushSync(() => button('Configurer le partage').click())
    await wait(() => Boolean(host.querySelector('dialog[open] form')))
    assert(host.querySelector<HTMLInputElement>('dialog input[inputmode="decimal"]')!.value === '' && [...host.querySelectorAll<HTMLInputElement>('dialog input[type="checkbox"]')].every((input) => input.checked), 'Estimation copiée en paiement ou partage égal non proposé.')
    setValue(host.querySelector('dialog input[inputmode="decimal"]')!, '0,01')
    flushSync(() => { const form = host.querySelector('dialog form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await wait(() => !host.querySelector('dialog[open]'))
    const uiSaved = (await database.trips.get(uiTrip.id))!
    assert(uiSaved.expenseShares?.length === 1 && uiSaved.expenseShares[0].shares.length === 3 && (await database.activities.get(uiActivity.id))!.paidAmount === 0.01, 'Double soumission ou valeurs de partage perdues.')
    flushSync(() => button('Modifier le partage').click())
    setValue(host.querySelector('dialog input[inputmode="decimal"]')!, 'test')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    assert(host.querySelector('dialog [role="alert"]') && host.querySelector<HTMLInputElement>('dialog input[inputmode="decimal"]')!.value === 'test', 'Validation ferme le panneau ou perd la saisie.')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(host.querySelector('.sharing-discard'), 'Échap perd des modifications sans confirmation.')
    flushSync(() => button('Continuer la saisie').click())
    setValue(host.querySelector('dialog input[inputmode="decimal"]')!, '40')
    const weights = host.querySelectorAll<HTMLInputElement>('dialog .sharing-weight input[inputmode="numeric"]')
    setValue(weights[1], '3')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]'))
    assert((await database.trips.get(uiTrip.id))!.expenseShares![0].shares.some((item) => item.participantId === uiBob.id && item.weight === 3), 'Parts personnalisées perdues.')
    flushSync(() => button('Supprimer Alice UI').click())
    flushSync(() => button('Confirmer').click())
    await wait(() => Boolean(host.querySelector('dialog [role="alert"]')))
    assert((await database.trips.get(uiTrip.id))!.participants!.some((item) => item.id === uiAlice.id), 'Participant utilisé supprimé.')
    flushSync(() => button('Annuler').click())
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((ready) => requestAnimationFrame(() => requestAnimationFrame(ready))); assert(host.scrollWidth <= host.clientWidth + 1, 'Partage déborde sur mobile.') }
    flushSync(() => button('Retirer le partage').click())
    flushSync(() => button('Confirmer').click())
    await wait(() => (host.textContent?.includes('Aucun partage calculable') ?? false))
    assert((await database.activities.get(uiActivity.id))!.paidAmount === 40 && (await database.trips.get(uiTrip.id))!.expenseShares!.length === 0, 'Retirer un partage efface le paiement.')
    report('Partages UI offline : participants, défaut égal explicite, paiement inconnu non inventé, virgule, parts personnalisées, doubles soumissions, validation/saisies, Échap/abandon protégé, suppression référencée refusée, retrait sans perte et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); second.close(); await database.delete(); await target.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
