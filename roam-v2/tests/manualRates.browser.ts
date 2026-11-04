import { RoamDatabase, type Trip } from '../src/db/database'
import { saveTripWithRates, type TripEditableFields } from '../src/db/tripRates'
import { createManualRateResolver, manualRateDrafts, mergeManualRates, parseManualRate, prepareManualRates, validateManualRates, type ManualExchangeRate } from '../src/money/manualRates'
import { calculateFinancialTotals } from '../src/money/conversion'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Opération invalide acceptée.')
}
const date = '2026-11-04T12:00:00.000Z'
const rate: ManualExchangeRate = { sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.0061, updatedAt: date }

export async function testManualRatesPure(report: (message: string) => void) {
  for (const text of ['0,0061', '0.0061', ' 0,0061 ', '6.1e-3']) assert(parseManualRate(text) === 0.0061, 'Lecture décimale incorrecte.')
  for (const text of ['', '0', '-1', 'NaN', 'Infinity', '1,2.3', '1 234', '1foo', '1e999', '1e-999']) await rejects(() => parseManualRate(text))
  assert(validateManualRates(undefined).length === 0, 'Anciennes données refusées.')
  for (const value of [null, {}, [null], [{ ...rate, rate: 0 }], [{ ...rate, rate: -1 }], [{ ...rate, rate: NaN }], [{ ...rate, rate: Infinity }], [{ ...rate, rate: '1' }], [{ ...rate, sourceCurrency: 'ZZZ' }], [{ ...rate, targetCurrency: 'JPY' }], [rate, rate], [{ ...rate, updatedAt: '2026-02-30T12:00:00.000Z' }]]) await rejects(() => validateManualRates(value))
  const original = Object.freeze({ ...rate })
  const draft = manualRateDrafts([original])
  const unchanged = prepareManualRates(draft, [original], '2026-11-05T12:00:00.000Z')
  assert(unchanged[0].updatedAt === date && original.rate === 0.0061, 'Taux inchangé réécrit.')
  const changed = prepareManualRates([{ ...draft[0], value: '0,007123456789' }], [original], '2026-11-05T12:00:00.000Z')
  assert(changed[0].rate === 0.007123456789 && changed[0].updatedAt !== date, 'Précision/date perdue.')
  const resolve = createManualRateResolver([original], () => ({ status: 'available', rate: 99, source: 'automatic' }))
  const resolved = resolve('JPY', 'EUR')
  assert(resolved.status === 'available' && resolved.rate === rate.rate && resolved.source === 'manual', 'Priorité manuelle perdue.')
  assert(createManualRateResolver([original])('EUR', 'JPY').status === 'unavailable', 'Taux inverse inventé.')
  assert(createManualRateResolver()('JPY', 'EUR').status === 'unavailable', 'Taux sans voyage inventé.')
  assert(createManualRateResolver([rate, rate])('JPY', 'EUR').status === 'invalid', 'Données invalides ignorées.')
  const totals = calculateFinancialTotals([{ id: 'a', currency: 'JPY', estimatedCost: 1000, paidAmount: 500 }], 'EUR', createManualRateResolver([original]))
  assert(totals.status === 'calculated' && totals.estimated.amount === 1000 * rate.rate && totals.paid.amount === 500 * rate.rate, 'Adaptateur moteur incorrect.')
  const additional = { ...rate, sourceCurrency: 'USD', rate: 0.9 }
  const merged = mergeManualRates([rate], changed, [rate, additional])
  assert(merged.length === 2 && merged.find((item) => item.sourceCurrency === 'USD')?.rate === 0.9, 'Ajout concurrent écrasé.')
  await rejects(() => mergeManualRates([rate], changed, [{ ...rate, rate: 0.8 }]))
  await rejects(() => mergeManualRates([rate], [], changed))
  assert(mergeManualRates([rate], [], [rate, additional]).length === 1, 'Suppression a touché une autre paire.')
  report('Taux manuels purs : décimales, valeurs invalides, dates, doublons, identité, direction, priorité, précision et fusion par paire.')
}

export async function testManualRatesPersistence(report: (message: string) => void) {
  const name = `roam-v2-test-manual-rates-${crypto.randomUUID()}`
  const database = new RoamDatabase(name)
  const otherTab = new RoamDatabase(name)
  const restored = new RoamDatabase(`roam-v2-test-manual-rates-restore-${crypto.randomUUID()}`)
  try {
    await database.open(); await otherTab.open(); await restored.open()
    const fields: TripEditableFields = { destination: 'Test taux', country: 'Test', startDate: '2028-01-01', endDate: '2028-01-02', travelers: 1, image: '', referenceCurrency: 'EUR' }
    const trip: Trip = { ...fields, id: 'rate-a' }
    await database.trips.bulkAdd([trip, { ...trip, id: 'rate-b', manualExchangeRates: [{ ...rate, rate: 0.005 }] }])
    await database.activities.add({ id: 'rate-activity', tripId: trip.id, title: 'Test', category: 'visit', date: null, scheduleType: 'unscheduled', period: null,
      sortOrder: 0, estimatedCost: 100, paidAmount: 0, currency: 'JPY', createdAt: date, updatedAt: date })
    const activity = JSON.stringify(await database.activities.get('rate-activity'))
    await saveTripWithRates(trip.id, fields, [], [rate], database, fields)
    await saveTripWithRates(trip.id, { ...fields, referenceCurrency: 'GBP' }, [rate], [rate], database, fields)
    assert((await database.trips.get(trip.id))?.manualExchangeRates?.[0].targetCurrency === 'EUR', 'Devise référence a réinterprété la paire.')
    const gbpFields = { ...fields, referenceCurrency: 'GBP' }
    const usd = { ...rate, sourceCurrency: 'USD', rate: 0.9 }
    const cad = { ...rate, sourceCurrency: 'CAD', rate: 0.65 }
    await Promise.all([
      saveTripWithRates(trip.id, gbpFields, [rate], [rate, usd], database, gbpFields),
      saveTripWithRates(trip.id, gbpFields, [rate], [rate, cad], otherTab, gbpFields),
    ])
    const current = (await database.trips.get(trip.id))!
    assert(current.manualExchangeRates?.length === 3, 'Paires concurrentes perdues.')
    const modified = { ...rate, rate: 0.007, updatedAt: '2026-11-05T12:00:00.000Z' }
    await saveTripWithRates(trip.id, gbpFields, [rate], [modified], database, gbpFields)
    const beforeConflict = JSON.stringify(await database.trips.get(trip.id))
    await rejects(() => saveTripWithRates(trip.id, { ...gbpFields, country: 'Ne pas écrire' }, [rate], [], otherTab, gbpFields))
    assert(JSON.stringify(await database.trips.get(trip.id)) === beforeConflict, 'Conflit a écrit partiellement.')
    await database.trips.update(trip.id, { destination: 'Modification autre onglet' })
    await saveTripWithRates(trip.id, gbpFields, [modified], [modified], otherTab, gbpFields)
    assert((await database.trips.get(trip.id))?.destination === 'Modification autre onglet', 'Champ concurrent inchangé dans le formulaire écrasé.')
    await rejects(() => saveTripWithRates(trip.id, { ...gbpFields, destination: 'Conflit' }, [modified], [modified], otherTab, gbpFields))
    assert((await database.trips.get('rate-b'))?.manualExchangeRates?.[0].rate === 0.005, 'Voyage voisin modifié.')
    database.close(); await database.open()
    assert((await database.trips.get(trip.id))?.manualExchangeRates?.length === 3, 'Taux perdus au rechargement.')
    assert(JSON.stringify(await database.activities.get('rate-activity')) === activity, 'Activité ou montants modifiés.')
    const snapshot = await readExportSnapshot({ mode: 'full' }, database)
    const archive = await buildExportArchive(snapshot)
    const prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, restored), restored)
    assert(JSON.stringify((await restored.trips.get(trip.id))?.manualExchangeRates) === JSON.stringify((await database.trips.get(trip.id))?.manualExchangeRates), 'Taux ZIP perdus.')
    assert((await restored.trips.get('london-2026'))?.manualExchangeRates === undefined, 'Ancien voyage modifié.')
    const invalid = await readExportSnapshot({ mode: 'full' }, database)
    invalid.trips.find((item) => item.id === trip.id)!.manualExchangeRates = [rate, rate]
    await rejects(async () => prepareRestore((await buildExportArchive(invalid)).blob))
    const rates = (await database.trips.get(trip.id))!.manualExchangeRates!
    await saveTripWithRates(trip.id, gbpFields, rates, rates.filter((item) => item.sourceCurrency !== 'JPY'), database, gbpFields)
    assert((await database.trips.get(trip.id))?.manualExchangeRates?.length === 2, 'Suppression incorrecte.')
    report('Persistance des taux : V4, deux connexions concurrentes, conflits atomiques, champs préservés, isolation, référence, rechargement et ZIP format 1.')
  } finally {
    database.close(); otherTab.close(); restored.close()
    await database.delete(); await restored.delete()
  }
}
