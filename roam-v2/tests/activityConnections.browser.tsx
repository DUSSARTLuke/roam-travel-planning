import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createTransferRepository } from '../src/db/transfers'
import { createExpenseSharingRepository } from '../src/db/expenseSharing'
import { createV21Repository } from '../src/evolution/v21/repository'
import { entityKey } from '../src/sync/model'
import { assertJourney } from '../src/evolution/v21/contracts'
import { buildTripBudget } from '../src/money/tripBudget'
import { journeyMap } from '../src/maps/journeyMap'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { buildConnectionPlan } from '../src/routing/activityConnections'
import { TripProgram } from '../src/components/program/TripProgram'
import { activityVersion } from '../src/db/activityRevision'
import { schedulingKey } from '../src/db/activityOrganization'
import { connectionTrip, connectionActivity, connectionJourney, testActivityConnectionsCore } from './activityConnections.core'
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
async function refused(action: () => unknown | Promise<unknown>) { let failed = false; try { await action() } catch { failed = true } assert(failed, 'Invalid connection accepted') }
async function waitFor(test: () => boolean) { const end = performance.now() + 6000; while (!test() && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); assert(test(), 'Connection UI timeout') }
export async function testActivityConnections(report: (message: string) => void) {
  testActivityConnectionsCore(report)
  const database = new RoamDatabase(`roam-v2-test-connections-${crypto.randomUUID()}`), copies: RoamDatabase[] = []
  const host = document.createElement('div'); host.style.maxWidth = '100%'; document.body.append(host); const root = createRoot(host)
  const repo = createV21Repository(database), activities = createActivityRepository(database), sharing = createExpenseSharingRepository(database)
  const originalFetch = window.fetch; let networkCalls = 0
  const a = { ...connectionActivity('Départ'), address: 'Adresse fictive A' }, b = { ...connectionActivity('Arrivée', '10:30', '11:00'), address: 'Adresse fictive B' }
  try {
    await database.trips.put(connectionTrip); await database.activities.bulkPut([a, b])
    const legacy = await createTransferRepository(database).saveTransfer(connectionTrip.id, { fromActivityId: a.id, toActivityId: b.id, durationMinutes: 8, mode: 'walk', currency: 'EUR', estimatedCost: 3 })
    const snapshot = await readExportSnapshot({ mode: 'trip', tripId: connectionTrip.id }, database)
    const zip1 = await buildExportArchive({ ...snapshot, databaseVersion: 5, journeys: [], accommodations: [], sync: snapshot.sync.filter(state => state.table !== 'journeys') })
    const prepared1 = await prepareRestore(zip1.blob), historic = new RoamDatabase(`roam-v2-test-b1-zip1-${crypto.randomUUID()}`); copies.push(historic)
    await restoreBackup(prepared1, await previewRestore(prepared1, historic), historic)
    assert((await historic.journeys.toArray())[0].segments[0].durationMinutes === 8, 'ZIP1 migration loses legacy manual duration')
    let trip = (await database.trips.get(connectionTrip.id))!
    const readActivities = () => activities.listActivities(trip.id), readJourneys = () => repo.listJourneys(trip.id)
    const render = () => flushSync(() => root.render(<TripProgram trip={trip} readActivities={readActivities} readJourneys={readJourneys} readAccommodations={async () => []} journeyRepository={repo} />))
    window.fetch = async () => { networkCalls++; throw Error('No API in B1') }
    render(); await waitFor(() => host.querySelectorAll('[data-connection-id]').length === 1)
    assert(host.querySelectorAll('.program-transfer').length === 0 && host.querySelectorAll('.journey-card').length === 0, 'Existing journey duplicated visually')
    assert(host.textContent?.includes('8 min') && host.querySelector('a[href*="google.com/maps/dir/"]'), 'Legacy duration or external link absent')
    const legacyJourney = (await repo.listJourneys(trip.id))[0]
    const legacyCard = host.querySelector<HTMLElement>('[data-connection-id]')!
    flushSync(() => Array.from(legacyCard.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Fiche complète')!.click())
    await waitFor(() => !!host.querySelector('.journey-panel'))
    assert(host.querySelector('.journey-panel')?.textContent?.includes('Budget du déplacement'), 'Existing full transport detail inaccessible')
    flushSync(() => host.querySelector<HTMLButtonElement>('.journey-panel header button')!.click())
    flushSync(() => legacyCard.querySelector<HTMLButtonElement>('button')!.click())
    await waitFor(() => !!host.querySelector('.connection-panel'))
    const set = (index: number, value: string) => { const input = host.querySelectorAll<HTMLInputElement>('.connection-panel input:not([type="checkbox"])')[index]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
    const submit = () => flushSync(() => host.querySelector<HTMLFormElement>('.connection-panel form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    flushSync(() => { set(0, '12,5'); set(1, '4'); set(2, '1,2') }); submit()
    await waitFor(() => !host.querySelector('.connection-panel'))
    assert(await database.journeys.count() === 1, 'Editing legacy creates duplicate transport')
    const updated = await database.journeys.get(legacyJourney.id)
    assert(updated?.segments[0].durationMinutes === 12.5 && updated.estimatedCost === 3 && updated.legacy?.id === legacy.id, 'Legacy native fields or manual duration lost')
    await repo.remove('journeys', trip.id, legacyJourney.id, (await repo.read('journeys', trip.id, legacyJourney.id)).revision)
    trip = (await database.trips.get(trip.id))!; render()
    await waitFor(() => !!host.querySelector('.connection-suggestion button'))
    flushSync(() => host.querySelector<HTMLButtonElement>('.connection-suggestion button')!.click())
    await waitFor(() => !!host.querySelector('.connection-panel'))
    flushSync(() => { set(0, '20'); set(1, '5'); set(2, '2') }); submit()
    await waitFor(() => !host.querySelector('.connection-panel') && host.querySelectorAll('[data-connection-id]').length === 1)
    const first = (await repo.listJourneys(trip.id))[0]
    assert(first.purpose === 'activity-connection' && first.participantIds?.length === 2 && first.segments[0].durationSource === 'manual', 'New connection fields missing')
    const without = buildTripBudget(trip, [a, b], []), withConnection = buildTripBudget(trip, [a, b], [first])
    assert(JSON.stringify(without) === JSON.stringify(withConnection), 'New connection added to budget')
    assert(!first.reservation && journeyMap([first], trip.id).rows.length === 0, 'B1 added reservation or map visualization')
    assert((await database.syncOutbox.toArray()).some(operation => operation.entityKey === entityKey('journeys', first.id)), 'Connection bypasses sync journal')
    assert(networkCalls === 0, 'Connection uses network')
    assert(host.scrollWidth <= host.clientWidth + 1, 'Program overflow at current viewport')
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-connection-id] button')!.click()); await waitFor(() => !!host.querySelector('.connection-panel'))
    const checkboxes = host.querySelectorAll<HTMLInputElement>('.connection-participants input'); assert(checkboxes.length === 2, 'Participant choices absent')
    flushSync(() => checkboxes[1].click()); submit(); await waitFor(() => !host.querySelector('.connection-panel'))
    await waitFor(() => !!host.querySelector('.connection-suggestion button'))
    flushSync(() => host.querySelector<HTMLButtonElement>('.connection-suggestion button')!.click()); await waitFor(() => !!host.querySelector('.connection-panel'))
    flushSync(() => set(0, '30')); submit(); await waitFor(() => !host.querySelector('.connection-panel') && host.querySelectorAll('[data-connection-id]').length === 2)
    const filter = host.querySelector<HTMLSelectElement>('.program-participant-filter select')!; filter.value = 'bob'; filter.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => host.querySelectorAll('[data-connection-id]').length === 1)
    assert(host.querySelector('[data-connection-id]')?.textContent?.includes('30 min'), 'Traveler filter displays other duration')
    const bobRoute = (await repo.listJourneys(trip.id)).find(row => row.participantIds?.includes('bob'))!
    await refused(() => repo.saveJourney(trip.id, connectionJourney(a, b, ['bob'], 'duplicate')))
    for (const invalid of [{ distanceMeters: -1 }, { safetyMarginMinutes: NaN }, { durationSource: 'invalid' }]) await refused(() => assertJourney({ ...first, segments: [{ ...first.segments[0], ...invalid }] } as never))
    const version = (await repo.read('journeys', trip.id, bobRoute.id)).revision
    const beforeRollback = await database.syncOutbox.count()
    await refused(() => database.transaction('rw', database.tables, async () => {
      await repo.saveJourney(trip.id, { ...bobRoute, segments: [{ ...bobRoute.segments[0], durationMinutes: 300 }] }, version)
      throw Error('Interruption fictive')
    }))
    assert((await database.journeys.get(bobRoute.id))?.segments[0].durationMinutes === 30 && await database.syncOutbox.count() === beforeRollback, 'Connection transaction rollback loses duration or leaves journal')
    await repo.saveJourney(trip.id, { ...bobRoute, segments: [{ ...bobRoute.segments[0], durationMinutes: 31 }] }, version)
    await refused(() => repo.saveJourney(trip.id, bobRoute, version))
    const zip2 = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared2 = await prepareRestore(zip2.blob), restored = new RoamDatabase(`roam-v2-test-b1-zip2-${crypto.randomUUID()}`); copies.push(restored)
    await restoreBackup(prepared2, await previewRestore(prepared2, restored), restored)
    restored.close(); await restored.open()
    assert((await restored.journeys.get(bobRoute.id))?.segments[0].durationMinutes === 31 && (await restored.journeys.get(first.id))?.segments[0].distanceMeters === 2000, 'ZIP2/reopen loses duration/distance')
    const restoredActivities = createActivityRepository(restored)
    for (const [index, id] of [a.id, b.id].entries()) {
      const current = await restoredActivities.getActivity(trip.id, id)
      await restoredActivities.organizeActivity(trip.id, id, { unscheduled: true }, schedulingKey(current))
      await restored.activities.update(id, { sortOrder: index })
    }
    await restoredActivities.reorderActivity(trip.id, b.id, 'up')
    assert(buildConnectionPlan(trip, await restoredActivities.listActivities(trip.id), await restored.journeys.toArray()).saved.every(item => item.stale), 'Persisted reorder not recognized')
    assert((await restored.journeys.get(first.id))?.segments[0].durationMinutes === 20, 'Reorder loses manual duration')
    report('B1 stockage/ZIP : Journey canonique réutilisé, budget/réservation/carte inchangés, journal et CAS, profils manuels distincts, ZIP1→V6/ZIP2/réouverture, zéro appel API.')
    // Open an editor, then change its source activity: reject stale intent, retain draft.
    await waitFor(() => host.querySelectorAll('[data-connection-id]').length === 1)
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-connection-id] button')!.click()); await waitFor(() => !!host.querySelector('.connection-panel'))
    const currentB = await activities.getActivity(trip.id, b.id)
    await activities.updateActivity(trip.id, b.id, { ...currentB, participantIds: ['alice'] }, activityVersion(currentB))
    flushSync(() => set(0, '99')); submit(); await waitFor(() => !!host.querySelector('.connection-panel [role="alert"]'))
    assert(host.querySelector<HTMLInputElement>('.connection-panel input')?.value === '99' && (await database.journeys.get(bobRoute.id))?.segments[0].durationMinutes === 31, 'Stale save erased draft or duration')
    // Abandon the draft explicitly; restore participation then test activity/people lifecycle.
    flushSync(() => host.querySelector<HTMLButtonElement>('.connection-panel header button')!.click())
    flushSync(() => Array.from(host.querySelectorAll<HTMLButtonElement>('.activity-discard button')).find(button => button.textContent === 'Abandonner')!.click())
    await sharing.saveParticipant(trip.id, 'Robert', 'bob', 'Bob'); trip = (await database.trips.get(trip.id))!; render()
    assert(buildConnectionPlan(trip, [a, { ...b, participantIds: ['alice'] }], await repo.listJourneys(trip.id)).saved.some(item => item.stale), 'Participant modification not retained for review')
    const beforeDeleteRollback = await database.syncOutbox.count()
    const failTripUpdate = () => { throw Error('Interruption fictive de suppression voyageur') }
    database.trips.hook('updating', failTripUpdate)
    try { await refused(() => sharing.deleteParticipant(trip.id, 'bob', 'Robert')) } finally { database.trips.hook('updating').unsubscribe(failTripUpdate) }
    assert((await database.journeys.get(bobRoute.id))?.participantIds?.includes('bob') && await database.syncOutbox.count() === beforeDeleteRollback, 'Participant deletion rollback leaves partial journey or sync state')
    await sharing.deleteParticipant(trip.id, 'bob', 'Robert')
    assert((await database.journeys.get(bobRoute.id))?.participantIds?.length === 0, 'Traveler deletion does not clean journeys')
    const latestA = await activities.getActivity(trip.id, a.id)
    await activities.organizeActivity(trip.id, a.id, { date: '2028-03-01' }, schedulingKey(latestA))
    assert(buildConnectionPlan((await database.trips.get(trip.id))!, await activities.listActivities(trip.id), await repo.listJourneys(trip.id)).saved.every(item => item.stale), 'Date change creates cross-day route')
    await activities.deleteActivity(trip.id, b.id)
    assert((await database.journeys.get(first.id))?.stops[1].link?.state === 'deleted', 'Activity deletion loses detached snapshot')
    assert((await database.journeys.get(first.id))?.segments[0].durationMinutes === 20, 'Activity deletion loses manual duration')
    trip = (await database.trips.get(trip.id))!; render(); await waitFor(() => !!host.querySelector('.connection-corrections'))
    const staleCard = Array.from(host.querySelectorAll<HTMLElement>('.connection-corrections [data-connection-id]')).find(card => card.dataset.connectionId === first.id)!
    flushSync(() => Array.from(staleCard.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Supprimer')!.click()); await waitFor(() => !!host.querySelector('.connection-panel'))
    submit(); await waitFor(() => !host.querySelector('.connection-panel'))
    assert(!await database.journeys.get(first.id) && (await database.syncEntities.get(entityKey('journeys', first.id)))?.deleted, 'Deletion misses tombstone')
    assert(networkCalls === 0, 'Offline lifecycle uses network')
    report('B1 UI offline : création/édition/suppression confirmée, mutualisation et filtres, lien externe sans requête, marge/distance, saisie concurrente conservée, voyageurs renommés/supprimés et activité déplacée/supprimée, tombstone ; largeur courante sans débordement.')
  } finally {
    window.fetch = originalFetch; flushSync(() => root.unmount()); host.remove(); database.close(); await database.delete(); for (const copy of copies) { copy.close(); await copy.delete() }
  }
}
