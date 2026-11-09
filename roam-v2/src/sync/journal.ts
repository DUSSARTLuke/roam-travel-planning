import Dexie, { type DBCore, type DBCoreTransaction } from 'dexie'
import { createId } from '../utils/createId'
import { entityKey, isSyncTable, syncStores, trackedTables, type EntityState, type Installation, type LocalOperation, type SyncTable } from './model'

// This boundary covers repositories AND direct writes, including bulk/range deletes.
// Only IDB promises are awaited here; no network, file reads, hashes or timers.
export function installLocalJournal(database: Dexie) {
  database.use({ stack: 'dbcore', name: 'roam-local-sync-journal', level: -2, create(core: DBCore) {
    if (!core.schema.tables.some((table) => table.name === 'syncEntities')) return core
    const groups = new WeakMap<DBCoreTransaction, { id: string; tail: Promise<unknown> }>()
    return { ...core,
      transaction(stores, mode, options) {
        return core.transaction(mode === 'readwrite' && stores.some(isSyncTable) ? [...new Set([...stores, ...trackedTables, ...syncStores])] : stores, mode, options)
      },
      table(name) {
        const table = core.table(name)
        if (!isSyncTable(name)) return table
        return { ...table, mutate(request) {
          let group = groups.get(request.trans)
          if (!group) { group = { id: '', tail: Dexie.Promise.resolve() }; groups.set(request.trans, group) }
          const current = group
          const task = current.tail.then(async () => {
            const trans = request.trans
            const keys = request.type === 'deleteRange' ? undefined : request.type === 'delete' ? request.keys : request.keys ?? request.values.map((value) => table.schema.primaryKey.extractKey!(value))
            const before = keys ? await table.getMany({ trans, keys }) : (await table.query({ trans, values: true, query: { index: table.schema.primaryKey, range: request.type === 'deleteRange' ? request.range : { type: 3, lower: undefined, upper: undefined } } })).result
            const result = await table.mutate(request)
            const ids = keys ?? before.map((value) => value.id)
            const after = request.type === 'delete' || request.type === 'deleteRange' ? ids.map(() => undefined) : await table.getMany({ trans, keys: ids })
            for (let index = 0; index < ids.length; index++) {
              if (result.failures[index]) continue
              const old = before[index], value = after[index]
              if (old === undefined && value === undefined) continue
              if (name !== 'activityDocumentBlobs' && JSON.stringify(old) === JSON.stringify(value)) continue
              const row = value ?? old
              await record(core, trans, name, String(ids[index]), row, value, current, old !== undefined)
            }
            return result
          }).catch((error) => { try { request.trans.abort() } catch { /* Preserve the original failure if already aborted. */ } throw error })
          current.tail = task
          return task
        } }
      },
    }
  } })
}
async function record(core: DBCore, trans: DBCoreTransaction, table: SyncTable, id: string, row: Record<string, unknown>, value: unknown, group: { id: string }, existed: boolean) {
  const meta = core.table('syncMeta'), states = core.table('syncEntities'), outbox = core.table('syncOutbox')
  let installation: Installation | undefined = await meta.get({ trans, key: 'installation' })
  const now = new Date().toISOString()
  if (!installation) {
    installation = { key: 'installation', installationId: createId(), createdAt: now, protocolVersion: 1 }
    await checked(meta.mutate({ type: 'add', trans, values: [installation] }))
  }
  const sequence = (installation.sequence ?? 0) + 1
  if (!Number.isSafeInteger(sequence)) throw new Error('Compteur de synchronisation locale épuisé.')
  await checked(meta.mutate({ type: 'put', trans, values: [{ ...installation, sequence }] }))
  const operationId = `${installation.installationId}:${sequence}`
  if (!group.id) group.id = operationId
  const key = entityKey(table, id), previous: EntityState | undefined = await states.get({ trans, key })
  // Reusing a physically deleted ID is an explicit new local creation, never adoption.
  const identity = previous && !(previous.deleted && value !== undefined) ? previous.identity : createId()
  const revision = previous?.identity === identity ? previous.revision + 1 : 1
  const document = table === 'activityDocumentBlobs' ? await core.table('activityDocuments').get({ trans, key: id }) : undefined
  const activityId = table === 'activityDocuments' ? String(row.activityId) : document?.activityId ?? previous?.activityId
  const parent = activityId ? await core.table('activities').get({ trans, key: activityId }) : undefined
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Révision locale épuisée. Aucun changement enregistré.')
  const tripId = table === 'trips' ? id : table === 'activities' ? String(row.tripId) : parent?.tripId ?? previous?.tripId
  const state: EntityState = { key, table, entityId: id, identity, revision, serverRevision: null, deleted: value === undefined, updatedAt: now,
    ...(tripId ? { tripId } : {}), ...(activityId ? { activityId } : {}),
    ...(previous?.sourceRevision !== undefined ? { sourceRevision: previous.sourceRevision } : {}) }
  const operation: LocalOperation = { id: operationId, groupId: group.id, installationId: installation.installationId, entityKey: key, identity, revision,
    previousRevision: revision - 1, kind: value === undefined ? 'delete' : existed ? 'update' : 'create', status: 'pending', createdAt: now,
    ...(value === undefined ? {} : { payload: value }) }
  if (value === undefined) {
    // Permanent deletion removes historical payloads too (especially PDF/image Blob).
    // Keep receipts/revisions, but never offer a superseded upsert for future sending.
    const previousOperations: LocalOperation[] = (await outbox.query({ trans, values: true, query: { index: outbox.schema.getIndexByKeyPath('entityKey')!, range: { type: 1, lower: key, upper: key } } })).result
    const redacted = previousOperations.filter((item) => item.payload !== undefined).map((item) => { const { payload: _payload, ...rest } = item; return { ...rest, status: 'superseded' } })
    if (redacted.length) await checked(outbox.mutate({ type: 'put', trans, values: redacted }))
  }
  await checked(states.mutate({ type: 'put', trans, values: [state] }))
  await checked(outbox.mutate({ type: 'add', trans, values: [operation] }))
}
async function checked(result: Promise<{ numFailures: number; failures: Record<number, Error> }>) {
  const response = await result
  if (response.numFailures) throw Object.values(response.failures)[0]
}
// Existing records are baseline creations, queued once without touching business rows.
export async function seedLocalJournal(transaction: import('dexie').Transaction) {
  for (const name of trackedTables) {
    const rows = await transaction.table(name).toArray()
    for (const row of rows) {
      const key = entityKey(name, row.id)
      if (await transaction.table('syncEntities').get(key)) continue
      const now = new Date().toISOString()
      const meta = transaction.table('syncMeta')
      let installation: Installation | undefined = await meta.get('installation')
      if (!installation) { installation = { key: 'installation', installationId: createId(), createdAt: now, protocolVersion: 1 }; await meta.add(installation) }
      const document = name === 'activityDocumentBlobs' ? await transaction.table('activityDocuments').get(row.id) : undefined
      const activityId = name === 'activityDocuments' ? row.activityId : document?.activityId
      const parent = activityId ? await transaction.table('activities').get(activityId) : undefined
      const state: EntityState = { key, table: name, entityId: row.id, identity: createId(), revision: 1, serverRevision: null, deleted: false, updatedAt: now,
        ...(name === 'trips' ? { tripId: row.id } : name === 'activities' ? { tripId: row.tripId } : activityId ? { activityId, ...(parent ? { tripId: parent.tripId } : {}) } : {}) }
      await transaction.table('syncEntities').add(state)
      await transaction.table('syncOutbox').add({ id: createId(), groupId: createId(), installationId: installation.installationId, entityKey: key, identity: state.identity, revision: 1, previousRevision: 0, kind: 'create', createdAt: now, status: 'pending', payload: row } satisfies LocalOperation)
    }
  }
  if (!await transaction.table('syncMeta').get('installation')) await transaction.table('syncMeta').add({ key: 'installation', installationId: createId(), createdAt: new Date().toISOString(), protocolVersion: 1 } satisfies Installation)
}
