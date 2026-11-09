import type { RoamDatabase } from '../db/database'
import { createId } from '../utils/createId'
import type { EntityState, Installation } from './model'

// Called only after preview/conflict checks, inside the restore transaction.
// Imported lineage is provenance, never a trusted remote acknowledgement.
export async function restoreLineage(database: RoamDatabase, states: readonly EntityState[]) {
  const deleted = states.filter((state) => state.deleted)
  let installation = await database.syncMeta.get('installation')
  const now = new Date().toISOString()
  if (deleted.length && !installation) {
    installation = { key: 'installation', installationId: createId(), createdAt: now, protocolVersion: 1 } satisfies Installation
    await database.syncMeta.add(installation)
  }
  const groupId = deleted.length ? createId() : ''
  for (const state of states) {
    const revision = state.deleted ? state.revision + 1 : state.revision
    if (!Number.isSafeInteger(revision)) throw new Error('Révision de synchronisation épuisée.')
    await database.syncEntities.add({ ...state, revision, sourceRevision: state.revision, serverRevision: null })
    if (state.deleted && installation) {
      installation = { ...installation, sequence: (installation.sequence ?? 0) + 1 }
      await database.syncMeta.put(installation)
      await database.syncOutbox.add({ id: `${installation.installationId}:${installation.sequence}`, groupId, installationId: installation.installationId,
        entityKey: state.key, identity: state.identity, revision, previousRevision: state.revision, kind: 'delete', createdAt: now, status: 'pending' })
    }
  }
}
