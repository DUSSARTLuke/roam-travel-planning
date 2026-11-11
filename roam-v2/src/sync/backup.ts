import { entityKey, isSyncTable, type EntityState } from './model'

export type SyncLineage = { version: 1; entities: EntityState[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
// Lineage is portable. Installation IDs, queues, credentials and replay receipts are not.
export function validateSyncLineage(value: unknown, records: { trips: { id: string }[]; activities: { id: string; tripId: string }[]; documents: { id: string; activityId?: string; tripId?: string }[]; journeys?: {id: string; tripId: string}[]; accommodations?: {id: string; tripId: string}[] }, scope: { mode: string; tripId?: unknown }): SyncLineage | undefined {
  if (value === undefined) return undefined
  const raw = value as SyncLineage
  if (!raw || Object.keys(raw).some((key) => !['version', 'entities'].includes(key)) || raw.version !== 1 || !Array.isArray(raw.entities) || raw.entities.length > 300000) throw new Error('Métadonnées de synchronisation invalides ou excessives.')
  const ids = new Set<string>(), identities = new Set<string>()
  const trips = new Map(records.trips.map((row) => [row.id, row])), activities = new Map(records.activities.map((row) => [row.id, row])), docs = new Map(records.documents.map((row) => [row.id, row]))
  for (const state of raw.entities) {
    if (!state || !isSyncTable(state.table) || !text(state.entityId) || state.key !== entityKey(state.table, state.entityId) || !uuid.test(state.identity) || ids.has(state.key) || identities.has(state.identity) || !Number.isSafeInteger(state.revision) || state.revision < 1 || state.serverRevision !== null || typeof state.deleted !== 'boolean' || typeof state.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.updatedAt) || !Number.isFinite(Date.parse(state.updatedAt)) || new Date(state.updatedAt).toISOString() !== state.updatedAt || (state.sourceRevision !== undefined && (!Number.isSafeInteger(state.sourceRevision) || state.sourceRevision < 1)) || (state.tripId !== undefined && !text(state.tripId)) || (state.activityId !== undefined && !text(state.activityId))) throw new Error('Identité ou révision de synchronisation invalide.')
    if (Object.keys(state).some((key) => !['key','table','entityId','identity','revision','serverRevision','deleted','updatedAt','tripId','activityId','sourceRevision'].includes(key))) throw new Error('Champ technique inattendu dans la filiation de sauvegarde.')
    ids.add(state.key); identities.add(state.identity)
    const row = state.table === 'trips' ? trips.get(state.entityId) : state.table === 'activities' ? activities.get(state.entityId) : state.table === 'journeys' ? records.journeys?.find(r => r.id === state.entityId) : state.table === 'accommodations' ? records.accommodations?.find(r => r.id === state.entityId) : docs.get(state.entityId)
    if (state.deleted ? row !== undefined : row === undefined) throw new Error('Tombstone ou relation de synchronisation incohérent.')
    if (!state.deleted) {
      const expectedActivity = state.table === 'activityDocuments' || state.table === 'activityDocumentBlobs' ? docs.get(state.entityId)!.activityId : undefined
      const expectedTrip = state.table === 'trips' ? state.entityId : state.table === 'activities' ? activities.get(state.entityId)!.tripId : state.table === 'journeys' ? records.journeys!.find(r => r.id === state.entityId)!.tripId : state.table === 'accommodations' ? records.accommodations!.find(r => r.id === state.entityId)!.tripId : docs.get(state.entityId)!.tripId ?? activities.get(expectedActivity!)!.tripId
      if (state.tripId !== expectedTrip || state.activityId !== expectedActivity) throw new Error('Parent de synchronisation incohérent.')
    }
    if (scope.mode === 'trip' && state.tripId !== scope.tripId) throw new Error('Filiation de synchronisation hors périmètre.')
  }
  // V5 archives carry a complete live inventory; omitted identities must not silently regenerate.
  for (const [table, list] of [['trips', records.trips], ['activities', records.activities], ['activityDocuments', records.documents], ['activityDocumentBlobs', records.documents], ['journeys', records.journeys ?? []], ['accommodations', records.accommodations ?? []]] as const) for (const row of list) if (!ids.has(entityKey(table, row.id))) throw new Error('Inventaire de synchronisation incomplet.')
  return raw
}
