import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase } from '../src/db/database'
import { createV21Repository } from '../src/evolution/v21/repository'
import { createActivityRepository } from '../src/db/activities'
import { RoutingCache, createRoutingService } from '../src/routing/routingService'
import { activityRoutingRequest, makeRoutingEstimate, ROUTING_TTL, RoutingError } from '../src/routing/estimateModel'
import { RoutingServiceContext } from '../src/components/program/routingContext'
import { TripProgram } from '../src/components/program/TripProgram'
import { connectionTrip, connectionActivity, connectionJourney } from './activityConnections.core'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { entityKey } from '../src/sync/model'
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function refused(action: () => Promise<unknown>) { try { await action() } catch { return }; throw Error('B2 invalid operation accepted') }
async function waitFor(test: () => boolean) { const end = performance.now() + 6000; while (!test() && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); assert(test(), 'B2 UI timeout') }
export async function testRouting(report: (message: string) => void) {
  const id = crypto.randomUUID(), database = new RoamDatabase(`roam-v2-test-routing-${id}`), other = new RoamDatabase(database.name), restored = new RoamDatabase(`roam-v2-test-routing-zip-${id}`)
  const cache = new RoutingCache(`roam-v2-test-routing-cache-${id}`), cacheOther = new RoutingCache(cache.name)
  const repo = createV21Repository(database), otherRepo = createV21Repository(other), activities = createActivityRepository(database)
  let clock = Date.now(), online = true, calls = 0, fail = '', release: (() => void) | undefined
  const provider = { namespace: 'mock-b2', scope: () => 'temporary-user', route: async (input: Parameters<typeof makeRoutingEstimate>[0]) => {
    calls++; if (release === undefined && fail === 'pending') await new Promise<void>(resolve => { release = resolve })
    if (fail === 'quota') throw new RoutingError('quota', 120)
    if (fail === 'no-route') throw new RoutingError('no-route')
    return makeRoutingEstimate(input, 601, 1234, clock)
  } }
  const service = createRoutingService(provider, cache, { now: () => clock, online: () => online, spacingMs: 0 })
  const a = { ...connectionActivity('b2-a'), longitude: 2, latitude: 48 }, b = { ...connectionActivity('b2-b', '10:30', '11:00'), longitude: 2.1, latitude: 48.1 }, request = activityRoutingRequest(a, b, 'walk')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const click = (text: string) => { const button = [...host.querySelectorAll<HTMLButtonElement>(text === 'Modifier' ? '[data-connection-id] button' : 'button')].find(button => button.textContent === text); assert(button && !button.disabled, `B2 button unavailable: ${text}`); flushSync(() => button.click()) }
  const setDuration = (value: string) => flushSync(() => { const input = host.querySelector<HTMLInputElement>('.connection-panel input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const submit = () => flushSync(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  try {
    // Shared provider, cache across service instances, participant-independent key, persisted offline TTL.
    const [one, two] = await Promise.all([service.calculate('same-trip', request), createRoutingService(provider, cacheOther, { now: () => clock, online: () => online, spacingMs: 0 }).calculate('same-trip', request)])
    assert(calls === 1 && one.inputKey === two.inputKey, 'B2 cross-instance duplicate provider request')
    online = false; cache.close(); await cache.open(); assert((await service.calculate('same-trip', request)).durationSeconds === 601 && calls === 1, 'B2 persisted offline hit')
    clock += ROUTING_TTL; await refused(() => service.calculate('same-trip', request)); online = true; clock = Date.now()
    fail = 'no-route'; await refused(() => service.calculate('no-route', request)); const failedCalls = calls; await refused(() => service.calculate('no-route', request)); assert(calls === failedCalls, 'B2 negative-cache storm')
    fail = ''; await service.calculate('isolated-trip', request); assert(calls === failedCalls + 1, 'B2 trip isolation')
    fail = 'quota'; await refused(() => service.calculate('quota', request)); const quotaCalls = calls; await refused(() => service.calculate('quota-2', request)); assert(calls === quotaCalls, 'B2 ignores Retry-After'); fail = ''; clock += 120_001
    let finishShared: (() => void) | undefined, interrupted = 0
    const cancellable = createRoutingService({ namespace: 'mock-cancellation', route: (input, signal) => new Promise((resolve, reject) => { const abort = () => { interrupted++; reject(new DOMException('Cancelled', 'AbortError')) }; finishShared = () => { signal.removeEventListener('abort', abort); resolve(makeRoutingEstimate(input, 60, 100, clock)) }; signal.addEventListener('abort', abort) }) }, cache, { now: () => clock, online: () => true, spacingMs: 0 })
    const callerA = new AbortController(), callerB = new AbortController()
    const sharedA = cancellable.calculate('shared', request, callerA.signal), sharedB = cancellable.calculate('shared', request, callerB.signal)
    await waitFor(() => !!finishShared); callerA.abort(); await refused(() => sharedA); assert(interrupted === 0, 'B2 partial cancellation interrupts remaining caller'); finishShared!(); await sharedB
    finishShared = undefined
    const cancelled = new AbortController(), cancelledWork = cancellable.calculate('cancel-all', request, cancelled.signal)
    await waitFor(() => !!finishShared); cancelled.abort(); await refused(() => cancelledWork); await waitFor(() => interrupted === 1)
    await cache.entries.bulkPut(Array.from({ length: 1001 }, (_, i) => ({ key: `lru-${i}`, used: i, noRouteUntil: 1 })))
    await service.calculate('lru-trigger', request); assert(await cache.entries.count() === 1000 && !await cache.entries.get('lru-0'), 'B2 LRU bound missing')
    await cache.entries.clear(); await cache.gates.clear(); clock = Date.now()
    await database.trips.put(connectionTrip); await database.activities.bulkPut([a, b]); await other.open()
    const saved = await repo.saveJourney(connectionTrip.id, connectionJourney(a, b, ['alice', 'bob'], 'b2-manual'))
    const readActivities = () => activities.listActivities(connectionTrip.id), readJourneys = () => repo.listJourneys(connectionTrip.id)
    flushSync(() => root.render(<RoutingServiceContext value={service}><TripProgram trip={connectionTrip} readActivities={readActivities} readJourneys={readJourneys} readAccommodations={async () => []} journeyRepository={repo} /></RoutingServiceContext>))
    await waitFor(() => [...host.querySelectorAll<HTMLButtonElement>('[data-connection-id] button')].some(button => button.textContent === 'Modifier' && !button.disabled)); click('Modifier'); await waitFor(() => !!host.querySelector('.connection-panel'))
    const revisionBefore = (await repo.read('journeys', connectionTrip.id, saved.id)).revision
    fail = 'pending'; click('Estimer le trajet'); await waitFor(() => !!release)
    const latest = await otherRepo.read('journeys', connectionTrip.id, saved.id)
    await otherRepo.saveJourney(connectionTrip.id, { ...saved, segments: [{ ...saved.segments[0], durationMinutes: 77 }] }, latest.revision)
    release!(); fail = ''; await waitFor(() => host.textContent!.includes('Conserver l’estimation à côté de ma durée'))
    assert(host.querySelector<HTMLInputElement>('.connection-panel input')?.value === '15', 'B2 network overwrites manual draft')
    assert((await database.journeys.get(saved.id))?.segments[0].durationMinutes === 77, 'B2 network overwrites concurrent manual duration')
    click('Conserver l’estimation à côté de ma durée'); submit(); await waitFor(() => !!host.querySelector('[role="alert"]'))
    assert((await repo.read('journeys', connectionTrip.id, saved.id)).revision.revision === revisionBefore.revision + 1 && (await database.journeys.get(saved.id))?.segments[0].durationMinutes === 77, 'B2 stale final save wins CAS')
    click('Fermer'); await waitFor(() => host.textContent!.includes('Abandonner les modifications')); click('Abandonner'); await waitFor(() => !host.querySelector('.connection-panel'))
    click('Modifier'); await waitFor(() => !!host.querySelector('.connection-panel')); click('Estimer le trajet'); await waitFor(() => host.textContent!.includes('Conserver l’estimation à côté de ma durée')); click('Conserver l’estimation à côté de ma durée'); submit(); await waitFor(() => !host.querySelector('.connection-panel'))
    const manual = (await database.journeys.get(saved.id))!
    assert(manual.segments[0].durationMinutes === 77 && manual.segments[0].durationSource === 'manual' && manual.segments[0].routingEstimate?.durationSeconds === 601 && manual.segments[0].safetyMarginMinutes === 5, 'B2 manual/estimate coexistence')
    assert((await database.syncOutbox.toArray()).some(operation => JSON.stringify(operation).includes('routingEstimate')), 'B2 estimate missing journal')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: connectionTrip.id }, database)), prepared = await prepareRestore(archive.blob)
    await restoreBackup(prepared, await previewRestore(prepared, restored), restored); restored.close(); await restored.open()
    assert(JSON.stringify((await restored.journeys.get(saved.id))?.segments) === JSON.stringify(manual.segments), 'B2 ZIP2/reopen loses estimate or manual duration')
    assert(!restored.tables.some(table => table.name === 'entries'), 'B2 cache exported into business DB')
    click('Modifier'); await waitFor(() => !!host.querySelector('.connection-panel')); setDuration(''); click('Estimer le trajet'); await waitFor(() => host.textContent!.includes('Utiliser cette estimation')); click('Utiliser cette estimation'); submit(); await waitFor(() => !host.querySelector('.connection-panel'))
    assert((await database.journeys.get(saved.id))?.segments[0].durationSource === 'automatic' && (await database.journeys.get(saved.id))?.segments[0].durationMinutes === 11, 'B2 explicit automatic acceptance')
    click('Modifier'); await waitFor(() => !!host.querySelector('.connection-panel')); setDuration('19'); submit(); await waitFor(() => !host.querySelector('.connection-panel'))
    assert((await database.journeys.get(saved.id))?.segments[0].durationSource === 'manual', 'B2 correction does not take priority')
    assert((await database.syncEntities.get(entityKey('journeys', saved.id)))!.revision > revisionBefore.revision, 'B2 revision tracking missing')
    // Stale coordinate response cannot be applied.
    await cache.entries.clear(); release = undefined; fail = 'pending'; click('Modifier'); await waitFor(() => !!host.querySelector('.connection-panel')); click('Estimer le trajet'); await waitFor(() => !!release)
    await database.activities.update(b.id, { longitude: 4 }); await new Promise(resolve => setTimeout(resolve, 100)); release!(); fail = ''; await new Promise(resolve => setTimeout(resolve, 100))
    assert(!host.textContent!.includes('Conserver l’estimation à côté de ma durée'), 'B2 obsolete GPS response applicable')
    assert(host.querySelector<HTMLInputElement>('.connection-panel input')?.value === '19', 'B2 stale result changes manual draft')
    assert(host.querySelector('.connection-panel')!.getBoundingClientRect().width <= innerWidth && document.documentElement.scrollWidth <= innerWidth + 1, 'B2 mobile overflow')
    report('B2 mock : mutualisation inter-instance, cache persistant hors ligne/TTL/isolation/échec/429 ; UI et CAS concurrent préservent la durée manuelle, acceptation explicite, correction, GPS obsolète ignoré, journal et ZIP2/rechargement ; largeur courante sans débordement.')
  } finally { flushSync(() => root.unmount()); host.remove(); other.close(); cacheOther.close(); for (const store of [database, restored, cache]) { store.close(); await store.delete() } }
}
