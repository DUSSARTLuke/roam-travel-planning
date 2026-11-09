export const trackedTables = ['trips', 'activities', 'activityDocuments', 'activityDocumentBlobs'] as const
export type SyncTable = typeof trackedTables[number]
export const syncStores = ['syncMeta', 'syncEntities', 'syncOutbox', 'syncCommands', 'syncConflicts'] as const
export type Installation = { key: 'installation'; installationId: string; createdAt: string; protocolVersion: 1; sequence?: number }
export type EntityState = {
  key: string; table: SyncTable; entityId: string; identity: string; revision: number
  serverRevision: null; deleted: boolean; updatedAt: string; tripId?: string; activityId?: string
  sourceRevision?: number
}
export type LocalOperation = {
  id: string; groupId: string; installationId: string; entityKey: string; identity: string
  revision: number; previousRevision: number; kind: 'create' | 'update' | 'delete'
  createdAt: string; status: 'pending' | 'superseded'; payload?: unknown
}
export type LocalCommand = { id: string; fingerprint: string; completedAt: string }
export type SyncConflict = { id: string; entityKey: string; expectedRevision: number; actualRevision: number; createdAt: string; status: 'unresolved' }
export const entityKey = (table: SyncTable, id: string) => JSON.stringify([table, id])
export function isSyncTable(value: string): value is SyncTable { return (trackedTables as readonly string[]).includes(value) }
