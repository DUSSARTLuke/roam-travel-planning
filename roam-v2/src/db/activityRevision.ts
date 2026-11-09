import Dexie from 'dexie'
import type { RoamDatabase } from './database'
import type { TripActivity } from './activityModel'
import { entityKey, type EntityState } from '../sync/model'

export type ActivityRevision = { entityKey: string; identity: string; revision: number }
// Transient token: copied by object spread, ignored by JSON and IndexedDB cloning.
export const activityRevision = Symbol('roam.activity.edit-revision')
export function activityVersion(value: unknown): ActivityRevision | undefined {
  return value && typeof value === 'object' ? (value as { [activityRevision]?: ActivityRevision })[activityRevision] : undefined
}
export class ActivityEditConflict extends Error {
  constructor(message = 'Cette activité a été modifiée dans un autre onglet. Aucun changement enregistré. Ta saisie et tes fichiers sont conservés ; recharge les données récentes avant de réessayer.') { super(message); this.name = 'ActivityEditConflict' }
}
async function state(database: RoamDatabase, id: string): Promise<EntityState | undefined> {
  const transaction = Dexie.currentTransaction
  // The V5 journal adds its stores to the native transaction, including nested
  // repository transactions whose public scope intentionally excludes documents.
  if (transaction?.db === database && transaction.idbtrans.objectStoreNames.contains('syncEntities')) {
    return new Dexie.Promise((resolve, reject) => {
      const request = transaction.idbtrans.objectStore('syncEntities').get(entityKey('activities', id))
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
  }
  return database.syncEntities.get(entityKey('activities', id))
}
export async function stampActivity(database: RoamDatabase, activity: TripActivity): Promise<TripActivity> {
  const current = await state(database, activity.id)
  if (!current || current.deleted) throw new ActivityEditConflict('Cette activité a été supprimée ou n’est plus disponible. Ta saisie reste conservée.')
  Object.defineProperty(activity, activityRevision, { enumerable: true, value: Object.freeze({ entityKey: current.key, identity: current.identity, revision: current.revision }) })
  return activity
}
export async function checkActivityRevision(database: RoamDatabase, id: string, expected: ActivityRevision | undefined) {
  const current = await state(database, id)
  if (!expected || !current || current.deleted || expected.entityKey !== entityKey('activities', id) || expected.identity !== current.identity || expected.revision !== current.revision) throw new ActivityEditConflict()
}
