import { projectLegacyTransfers } from './graph'
import type { Transaction } from 'dexie'
import { planV6 } from './migrationPlan'
import type { Journey } from './contracts'
import { createId } from '../../utils/createId'
import { entityKey, trackedTables } from '../../sync/model'
import { seedLocalJournal } from '../../sync/journal'

// Upgrade only: IDB requests exclusively, no Blob reads, hashing or network.
export async function migrateV6(tx: Transaction) {
  const trips = await tx.table('trips').toArray()
  const plan = planV6({ databaseVersion: 5, trips, activities: await tx.table('activities').toArray(),
    documents: await tx.table('activityDocuments').toArray(), blobIds: await tx.table('activityDocumentBlobs').toCollection().primaryKeys() as string[] }, () => createId())
  // Bounded IDs are allocated within this atomic upgrade; provenance keeps the exact old ID.
  for (const journey of plan.journeys) await tx.table('journeys').add(journey satisfies Journey)
  for (const document of plan.documents) {
    // Keep the activityId index as a compatibility projection for existing UI.
    await tx.table('activityDocuments').update(document.id, { tripId: document.tripId, owner: document.owner })
  }
  // V5 receipts survive, but pending old payloads must never be replayed.
  // Freeze all V5 operations, not just trips: owner semantics changed as well.
  await tx.table('syncOutbox').toCollection().modify((operation) => { operation.status = 'superseded' })
  const installation = await tx.table('syncMeta').get('installation')
  if (installation) await tx.table('syncMeta').put({ ...installation, protocolVersion: 2 })
  await seedLocalJournal(tx)
  // Rebaseline current states; retain original identity and monotonically advance revisions.
  const now = new Date().toISOString(), groupId = createId()
  for (const table of trackedTables) {
    for (const row of await tx.table(table).toArray()) {
      const key = entityKey(table, row.id), state = await tx.table('syncEntities').get(key)
      if (!state) throw new Error('Filiation V6 absente ; migration annulée.')
      const revision = state.revision + 1
      if (!Number.isSafeInteger(revision)) throw new Error('Révision épuisée ; migration annulée.')
      const document = table === 'activityDocumentBlobs' ? await tx.table('activityDocuments').get(row.id) : table === 'activityDocuments' ? row : undefined
      const tripId = table === 'trips' ? row.id : row.tripId ?? document?.tripId ?? state.tripId
      const activityId = document?.activityId ?? state.activityId
      await tx.table('syncEntities').put({ ...state, revision, updatedAt: now, ...(tripId ? { tripId } : {}), ...(activityId ? { activityId } : {}) })
      const { manualTransfers: _projection, ...tripPayload } = row
      await tx.table('syncOutbox').add({ id: createId(), groupId, installationId: installation?.installationId ?? (await tx.table('syncMeta').get('installation')).installationId,
        entityKey: key, identity: state.identity, revision, previousRevision: state.revision, kind: 'update', status: 'pending', createdAt: now, payload: table === 'trips' ? tripPayload : row, protocolVersion: 2 })
    }
  }
  for (const state of await tx.table('syncEntities').filter(state => state.deleted).toArray()) {
    const revision = state.revision + 1
    if (!Number.isSafeInteger(revision)) throw new Error('Révision de suppression épuisée.')
    await tx.table('syncEntities').put({...state, revision, updatedAt: now})
    await tx.table('syncOutbox').add({id:createId(),groupId,installationId:(await tx.table('syncMeta').get('installation')).installationId,entityKey:state.key,identity:state.identity,revision,previousRevision:state.revision,kind:'delete',status:'pending',createdAt:now,protocolVersion:2})
  }
  // Refresh version tokens after the rebaseline, using the canonical inventory.
  for (const trip of trips) {
    const projection = projectLegacyTransfers(trip, await tx.table('journeys').where('tripId').equals(trip.id).toArray())
    if (projection.length || trip.manualTransfers !== undefined) await tx.table('trips').update(trip.id,{manualTransfers:projection})
  }
  // seed may have queued baseline entries: only the final V6 group is replayable.
  await tx.table('syncOutbox').toCollection().modify(operation => { if (operation.groupId !== groupId) operation.status = 'superseded' })
}
