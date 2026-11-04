import { RoamDatabase, type Trip } from '../src/db/database'
import { createAutomaticRateService, requiredAutomaticPairs } from '../src/db/automaticRates'
import { AUTOMATIC_PROVIDER, createTripRateResolver, parseFrankfurterRate, validateAutomaticCache, type AutomaticRateCache } from '../src/money/automaticRates'
import { calculateFinancialTotals } from '../src/money/conversion'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Réponse automatique invalide acceptée.')
}
const timestamp = '2026-11-04T12:00:00.000Z'
const row = { date: '2026-11-03', base: 'JPY', quote: 'EUR', rate: 0.0061 }
export async function testAutomaticRatesPure(report: (message: string) => void) {
  const observed = { date: '2026-11-05', base: 'JPY', quote: 'EUR', rate: 0.0056294 }
  // 00:30 Paris on November 5 = 23:30 UTC on November 4.
  for (const fetchedAt of ['2026-11-04T23:30:00.000Z', '2026-11-05T00:00:00.000Z', timestamp]) {
    const result = parseFrankfurterRate(observed, 'JPY', 'EUR', fetchedAt)
    assert(result.rate === observed.rate && result.rateDate === observed.date && result.fetchedAt === fetchedAt, 'Réponse réelle rejetée au changement de jour UTC/Paris.')
    validateAutomaticCache({ rates: [result], checks: [] })
  }
  await rejects(() => parseFrankfurterRate(observed, 'JPY', 'EUR', '2026-11-03T23:30:00.000Z'))
  const parsed = parseFrankfurterRate(row, 'JPY', 'EUR', timestamp)
  assert(parsed.provider === AUTOMATIC_PROVIDER && parsed.rateDate === row.date && parsed.fetchedAt === timestamp, 'Métadonnées perdues.')
  for (const bad of [null, [], {}, { rates: { EUR: 1 } }, { ...row, base: 'EUR' }, { ...row, quote: 'USD' }, { ...row, rate: '0.1' },
    { ...row, rate: 0 }, { ...row, rate: -1 }, { ...row, rate: NaN }, { ...row, rate: Infinity },
    { ...row, date: '2026-02-30' }, { ...row, date: '2026-11-06' }]) await rejects(() => parseFrankfurterRate(bad, 'JPY', 'EUR', timestamp))
  const cache: AutomaticRateCache = { rates: [parsed], checks: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', checkedAt: timestamp, status: 'ok' }] }
  assert(validateAutomaticCache(undefined).rates.length === 0, 'Ancien voyage refusé.')
  for (const bad of [null, {}, { ...cache, rates: [parsed, parsed] }, { ...cache, rates: [{ ...parsed, provider: 'v1' }] },
    { ...cache, rates: [{ ...parsed, fetchedAt: 'bad' }] }, { ...cache, checks: [{ ...cache.checks[0], checkedAt: 'bad' }] },
    { ...cache, refresh: { id: '', startedAt: timestamp } }]) await rejects(() => validateAutomaticCache(bad))
  const automatic = createTripRateResolver({ automaticExchangeRates: cache })
  const resolved = automatic('JPY', 'EUR')
  assert(resolved.status === 'available' && resolved.source === 'automatic' && resolved.asOf === row.date, 'Résolution automatique incorrecte.')
  assert(automatic('EUR', 'JPY').status === 'unavailable', 'Inverse automatique inventé.')
  const manual = createTripRateResolver({ automaticExchangeRates: cache, manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.007, updatedAt: timestamp }] })
  const priority = manual('JPY', 'EUR')
  assert(priority.status === 'available' && priority.rate === 0.007 && priority.source === 'manual', 'Priorité manuelle perdue.')
  const totals = calculateFinancialTotals([{ id: 'test', currency: 'JPY', estimatedCost: 1000 }], 'EUR', automatic)
  assert(totals.status === 'calculated' && totals.estimated.amount === 1000 * row.rate, 'Cache non utilisable par le moteur.')
  cache.rates[0].rate = 99
  const snapshot = automatic('JPY', 'EUR')
  assert(snapshot.status === 'available' && snapshot.rate === row.rate, 'Instantané du résolveur mutable.')
  report('Taux automatiques purs : V2 uniquement, validation stricte, dates, métadonnées, ancien voyage, instantané, moteur et priorité manuelle.')
}
export async function testAutomaticRatesPersistence(report: (message: string) => void) {
  const name = `roam-v2-test-auto-rates-${crypto.randomUUID()}`
  const database = new RoamDatabase(name)
  const other = new RoamDatabase(name)
  const restored = new RoamDatabase(`roam-v2-test-auto-rates-restored-${crypto.randomUUID()}`)
  let currentTime = timestamp
  let online = true
  let publishedDate = '2026-11-03'
  let unavailableStatus = 404
  let mode: 'valid' | 'http' | 'malformed' | 'network' | 'observed' | 'future' = 'valid'
  let pending: Promise<void> | null = null
  let entered: (() => void) | null = null
  const urls: string[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    urls.push(url)
    assert(url.startsWith('https://api.frankfurter.dev/v2/rate/') && init?.credentials === 'omit', 'Endpoint ou confidentialité incorrect.')
    entered?.(); if (pending) await pending
    if (mode === 'network') throw new TypeError('Panne simulée')
    if (mode === 'http') return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
    if (mode === 'malformed') return new Response('{"rates":{"EUR":1}}', { headers: { 'content-type': 'application/json' } })
    const [source, target] = new URL(url).pathname.split('/').slice(-2)
    if (source === 'CHF') return new Response('{}', { status: unavailableStatus })
    return new Response(JSON.stringify({ date: mode === 'observed' ? '2026-11-05' : mode === 'future' ? '2026-12-31' : publishedDate, base: source, quote: target, rate: mode === 'observed' ? 0.0056294 : row.rate }), { headers: { 'content-type': 'application/json' } })
  }
  const service = createAutomaticRateService(database, { fetcher, now: () => currentTime, online: () => online })
  const second = createAutomaticRateService(other, { fetcher, now: () => currentTime, online: () => online })
  try {
    await database.open(); await other.open(); await restored.open()
    const trip: Trip = { id: 'auto-a', destination: 'Test auto', country: 'Test', image: '', startDate: '2028-01-01', endDate: '2028-01-02', travelers: 1,
      manualExchangeRates: [{ sourceCurrency: 'USD', targetCurrency: 'EUR', rate: 0.8, updatedAt: timestamp }] }
    await database.trips.bulkAdd([trip, { ...trip, id: 'auto-b' }])
    for (const [index, currency] of ['JPY', 'USD', 'CHF', 'EUR', undefined, 'ZZZ', 'JPY'].entries()) {
      await database.activities.add({ id: `auto-${index}`, tripId: trip.id, title: 'Test', category: 'visit', date: null, scheduleType: 'unscheduled', period: null,
        sortOrder: index, estimatedCost: index === 2 ? 0 : 100, paidAmount: 0, currency, createdAt: timestamp, updatedAt: timestamp })
    }
    const activities = await database.activities.toArray()
    const before = JSON.stringify(activities)
    assert(requiredAutomaticPairs(trip, activities).map((pair) => pair.sourceCurrency).join() === 'CHF,JPY', 'Paires inutiles ou doublons téléchargés.')
    const first = await service.refresh(trip.id)
    assert(first.fetched === 1 && first.unavailable === 1 && urls.length === 2, 'Import initial incorrect.')
    let saved = (await database.trips.get(trip.id))!
    assert(saved.automaticExchangeRates?.rates[0].rate === row.rate && !saved.referenceCurrency, 'Cache ou ancien voyage modifié.')
    assert((await service.refresh(trip.id)).status === 'cached' && urls.length === 2, 'Actualisation répétée le même jour.')
    unavailableStatus = 422
    const explicit = await service.refresh(trip.id, true)
    assert(explicit.unavailable === 1, 'Paire 422 non signalée.')
    assert(Number(urls.length) === 4, 'Actualisation manuelle ignorée.')
    mode = 'observed'
    const reproduced = await service.refresh(trip.id, true)
    const observedCache = (await database.trips.get(trip.id))!.automaticExchangeRates!
    assert(reproduced.fetched === 1 && observedCache.rates[0].rate === 0.0056294 && observedCache.rates[0].rateDate === '2026-11-05', 'Réponse réelle non persistée.')
    assert(observedCache.checks.some((check) => check.sourceCurrency === 'JPY' && check.status === 'ok'), 'Réception valide absente de l’état réactif.')
    publishedDate = '2026-11-05'
    mode = 'future'
    const rejectedFuture = await service.refresh(trip.id, true)
    const futureCheck = (await database.trips.get(trip.id))!.automaticExchangeRates!.checks.find((check) => check.sourceCurrency === 'JPY')!
    assert(rejectedFuture.errors === 1 && futureCheck.diagnostic?.includes('trop future'), 'Diagnostic de date future perdu.')
    const valid = JSON.stringify((await database.trips.get(trip.id))!.automaticExchangeRates!.rates)
    for (const failure of ['http', 'malformed', 'network'] as const) {
      mode = failure
      const failed = await service.refresh(trip.id, true)
      assert(failed.errors === 2, 'Erreur non signalée.')
      const diagnostic = (await database.trips.get(trip.id))!.automaticExchangeRates!.checks.find((check) => check.sourceCurrency === 'JPY')?.diagnostic
      assert(diagnostic?.includes(failure === 'http' ? 'HTTP 503' : failure === 'malformed' ? 'validation du taux' : 'réseau'), 'Étape de l’erreur masquée.')
      assert(JSON.stringify((await database.trips.get(trip.id))!.automaticExchangeRates!.rates) === valid, 'Erreur a écrasé un taux valide.')
      const requests = urls.length
      await service.refresh(trip.id)
      assert(urls.length === requests, 'Erreur provoque une boucle automatique.')
    }
    online = false
    const count = urls.length
    assert((await service.refresh(trip.id, true)).status === 'offline' && urls.length === count, 'Réseau appelé hors connexion.')
    assert(createTripRateResolver((await database.trips.get(trip.id))!)('JPY', 'EUR').status === 'available', 'Cache hors ligne perdu.')
    online = true; mode = 'valid'; currentTime = '2026-11-05T12:00:00.000Z'
    await service.refresh(trip.id)
    assert((await database.trips.get(trip.id))!.automaticExchangeRates!.rates[0].fetchedAt === currentTime, 'Actualisation quotidienne incorrecte.')
    let release!: () => void
    pending = new Promise<void>((resolve) => { release = resolve })
    const begun = new Promise<void>((resolve) => { entered = resolve })
    const writing = service.refresh(trip.id, true)
    await begun
    assert((await second.refresh(trip.id, true)).status === 'busy', 'Concurrence inter-onglets non bloquée.')
    await other.trips.update(trip.id, { destination: 'Autre onglet', manualExchangeRates: [{ sourceCurrency: 'USD', targetCurrency: 'EUR', rate: 0.7, updatedAt: currentTime }] })
    release(); await writing; pending = null; entered = null
    saved = (await database.trips.get(trip.id))!
    assert(saved.destination === 'Autre onglet' && saved.manualExchangeRates?.[0].rate === 0.7, 'Champs concurrents écrasés.')
    pending = new Promise<void>((resolve) => { release = resolve })
    const begunAgain = new Promise<void>((resolve) => { entered = resolve })
    const changing = service.refresh(trip.id, true)
    await begunAgain
    await other.trips.update(trip.id, { referenceCurrency: 'GBP' })
    const unchangedRates = JSON.stringify((await database.trips.get(trip.id))!.automaticExchangeRates!.rates)
    release()
    assert((await changing).status === 'obsolete', 'Réponse obsolète appliquée après changement de référence.')
    pending = null; entered = null
    assert(JSON.stringify((await database.trips.get(trip.id))!.automaticExchangeRates!.rates) === unchangedRates, 'Taux obsolètes écrits.')
    assert((await database.trips.get('auto-b'))?.automaticExchangeRates === undefined, 'Cache d’un autre voyage modifié.')
    assert(JSON.stringify(await database.activities.toArray()) === before, 'Montants/activités modifiés.')
    database.close(); await database.open()
    assert((await database.trips.get(trip.id))?.automaticExchangeRates?.rates.length === 1, 'Cache non persistant.')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'full' }, database))
    const prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, restored), restored)
    assert((await restored.trips.get('auto-b'))?.automaticExchangeRates === undefined, 'Ancienne sauvegarde enrichie artificiellement.')
    assert(JSON.stringify((await restored.trips.get(trip.id))?.automaticExchangeRates) === JSON.stringify((await database.trips.get(trip.id))?.automaticExchangeRates), 'Cache perdu dans le ZIP.')
    const invalid = await readExportSnapshot({ mode: 'full' }, database)
    invalid.trips.find((item) => item.id === trip.id)!.automaticExchangeRates!.rates[0].rate = 0
    await rejects(async () => prepareRestore((await buildExportArchive(invalid)).blob))
    report('Taux automatiques persistés : requêtes minimales, quotidien/manuel, pannes simulées, cache offline, deux connexions, référence concurrente, isolation, données intactes et ZIP.')
  } finally {
    database.close(); other.close(); restored.close()
    await database.delete(); await restored.delete()
  }
}
