import Dexie from 'dexie'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createRef } from 'react'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { ActivityDetailPanel } from '../src/components/program/ActivityDetailPanel'
import { entityKey } from '../src/sync/model'
import { timedFixture } from './dayPlanning.core'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>) { try { await action() } catch { return }; throw new Error('Suppression invalide acceptée.') }
export async function testActivityDeletion(report: (message: string) => void) {
  const name = `roam-v2-test-activity-delete-${crypto.randomUUID()}`, legacy = new Dexie(name)
  legacy.version(4).stores({ trips: 'id', metadata: 'key', activities: 'id,tripId,[tripId+date]', activityDocuments: 'id,activityId', activityDocumentBlobs: 'id' })
  const stamp = '2026-11-09T12:00:00.000Z'
  const transfer = { id: 'ab', fromActivityId: 'a', toActivityId: 'b', mode: 'walk' as const, currency: 'EUR', createdAt: stamp, updatedAt: stamp }
  const share = { payerId: 'p', shares: [{ participantId: 'p', weight: 1 }], amount: 0, currency: 'EUR', updatedAt: stamp }
  const trip: Trip = { id: 'deletion-trip', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '', participants: [{ id: 'p', name: 'Test' }], manualTransfers: [transfer, { ...transfer, id: 'bc', fromActivityId: 'b', toActivityId: 'c' }], expenseShares: [{ ...share, kind: 'activity', expenseId: 'a' }, { ...share, kind: 'transfer', expenseId: 'ab' }, { ...share, kind: 'activity', expenseId: 'b' }, { ...share, kind: 'transfer', expenseId: 'bc' }] }
  const activity = { ...timedFixture('a', '10:00', '11:00'), tripId: trip.id, reservationStatus: 'confirmed' as const, reservationReference: 'REF-TEST', paidAmount: 0, currency: 'EUR' }
  const other = { ...activity, id: 'b', title: 'À conserver' }, third = { ...activity, id: 'c' }
  const blob = new Blob(['%PDF-1.7\nTest'], { type: 'application/pdf' })
  const docMetadata = { id: 'da', activityId: 'a', name: 'Test.pdf', mime: 'application/pdf', size: blob.size, importedAt: stamp }
  await legacy.table('trips').add(trip); await legacy.table('metadata').add({ key: 'initialization', initialized: true })
  await legacy.table('activities').bulkAdd([activity, other, third]); await legacy.table('activityDocuments').bulkAdd([docMetadata, { ...docMetadata, id: 'db', activityId: 'b' }]); await legacy.table('activityDocumentBlobs').bulkAdd([{ id: 'da', blob }, { id: 'db', blob }]); legacy.close()
  const database = new RoamDatabase(name), repo = createActivityRepository(database)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const origin = createRef<HTMLButtonElement>(), fallback = createRef<HTMLButtonElement>()
  let closed = 0, calls = 0, release: (() => void) | undefined, fail = true
  const remove: typeof repo.deleteActivity = async (...args) => { calls++; if (fail) throw new Error('Échec simulé : données conservées.'); await new Promise<void>((resolve) => { release = resolve }); await repo.deleteActivity(...args) }
  const wait = async (predicate: () => boolean) => { const end = performance.now() + 6000; while (!predicate() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(predicate(), 'Suppression UI non actualisée.') }
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === text)!
  const render = () => flushSync(() => root.render(<><button ref={fallback}>Programme</button><ActivityDetailPanel trip={trip} activity={activity} returnFocusRef={origin} fallbackFocusRef={fallback} onClose={() => { closed++ }} onEdit={() => {}} removeActivity={remove} /></>))
  try {
    await database.open(); assert(database.verno === 6, 'Migration V4→V5 absente.')
    const before = await database.syncOutbox.count()
    await rejects(() => repo.deleteActivity('other-trip', 'a'))
    await database.trips.update(trip.id, { archived: true }); await rejects(() => repo.deleteActivity(trip.id, 'a')); await database.trips.update(trip.id, { archived: false })
    await rejects(() => repo.deleteActivity(trip.id, 'a', JSON.stringify({ ...activity, title: 'Version ancienne' })))
    assert(await database.activities.count() === 3 && await database.activityDocuments.count() === 2, 'Refus de suppression a modifié les données.')
    render(); flushSync(() => button('Supprimer l’activité').click())
    assert(host.textContent?.includes(`Supprimer « ${activity.title} »`) && host.textContent.includes('déplacements') && document.activeElement === button('Annuler la suppression'), 'Confirmation, cascade ou focus absents.')
    flushSync(() => button('Annuler la suppression').click())
    assert(calls === 0 && host.querySelector('dialog[open]'), 'Annulation appelle le repository ou ferme la fiche.')
    flushSync(() => button('Supprimer l’activité').click()); host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); await wait(() => Boolean(button('Supprimer l’activité')))
    assert(calls === 0, 'Échap supprime une activité.')
    flushSync(() => button('Supprimer l’activité').click()); flushSync(() => button('Supprimer définitivement l’activité').click())
    await wait(() => host.textContent?.includes('Échec simulé') === true)
    assert(closed === 0 && await database.activities.get('a'), 'Erreur ferme la fiche ou perd les données.')
    fail = false
    const confirm = button('Supprimer définitivement l’activité')
    flushSync(() => { confirm.click(); confirm.click() })
    await wait(() => Boolean(release)); assert(calls === 2 && button('Suppression…').disabled && button('Annuler la suppression').disabled, 'Double suppression possible.')
    release!(); await wait(() => closed === 1)
    assert(!await database.activities.get('a') && !await database.activityDocuments.get('da') && !await database.activityDocumentBlobs.get('da'), 'Cascade activité/document/Blob incomplète.')
    assert(JSON.stringify(await database.activities.get('b')) === JSON.stringify(other) && JSON.stringify(await database.activities.get('c')) === JSON.stringify(third) && (await database.activityDocumentBlobs.get('db'))!.blob.size === blob.size, 'Autre activité ou fichier altéré.')
    const latest = (await database.trips.get(trip.id))!
    assert(latest.manualTransfers?.length === 1 && latest.manualTransfers[0].id === 'bc' && latest.expenseShares?.length === 3 && latest.expenseShares.every((item) => ['b','ab','bc'].includes(item.expenseId)) && (await database.journeys.toArray()).some(j => j.legacy?.id === 'ab' && j.stops.some(s => s.link?.state === 'deleted')) && latest.participants?.[0].id === 'p', 'Référence incohérente ou relation non concernée supprimée.')
    const deletes = (await database.syncOutbox.toArray()).filter((op) => op.kind === 'delete')
    assert(deletes.length === 3 && new Set(deletes.map((op) => op.groupId)).size === 1 && await database.syncOutbox.count() > before, 'Suppressions non journalisées atomiquement.')
    for (const [table, id] of [['activities','a'],['activityDocuments','da'],['activityDocumentBlobs','da']] as const) {
      assert((await database.syncEntities.get(entityKey(table, id)))!.deleted, 'Tombstone absent.')
      assert((await database.syncOutbox.where('entityKey').equals(entityKey(table, id)).toArray()).every((op) => op.payload === undefined), 'Données supprimées retenues dans la file.')
    }
    // Inject a journal collision during a second cascade; no business partial commit.
    const installation = (await database.syncMeta.get('installation'))!, sample = (await database.syncOutbox.toArray())[0]
    await database.syncOutbox.add({ ...sample, id: `${installation.installationId}:${installation.sequence! + 1}` })
    await rejects(() => repo.deleteActivity(trip.id, 'b', JSON.stringify(other)))
    assert(await database.activities.get('b') && await database.activityDocuments.get('db') && await database.activityDocumentBlobs.get('db') && JSON.stringify(await database.trips.get(trip.id)) === JSON.stringify(latest), 'Échec du journal laisse une suppression partielle.')
    report('Suppression activité : action fiche/confirmation/annulation/Échap, erreurs/double clic, migration V4→V5, réservations/documents/transferts/partages, isolation, tombstones/groupes et rollback si journal en erreur.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete() }
}
