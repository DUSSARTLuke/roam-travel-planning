import type { RoamDatabase } from '../../db/database'
import { entityKey } from '../../sync/model'
import { projectLegacyTransfers } from './graph'
// Repair only the disposable read model on open, including pre-bridge V6 bases.
// No Journey is created, updated or deleted; no command/outbox is emitted.
export async function refreshLegacyProjection(database: RoamDatabase,tripId: string) {
  const trip=await database.trips.get(tripId)
  if (!trip) return
  const rows=await database.journeys.where('tripId').equals(trip.id).toArray()
  const versions=new Map<string,{identity:string;revision:number}>()
  for (const row of rows) {
    const state=await database.syncEntities.get(entityKey('journeys',row.id))
    if (!state || state.deleted) throw new Error('Filiation de déplacement incohérente.')
    versions.set(row.id,{identity:state.identity,revision:state.revision})
  }
  const projection=projectLegacyTransfers(trip,rows,versions)
  if (!projection.length && trip.manualTransfers===undefined) return
  if (JSON.stringify(projection)!==JSON.stringify(trip.manualTransfers)) await database.trips.update(trip.id,{manualTransfers:projection})
}
export async function refreshLegacyProjections(database: RoamDatabase) {
  await database.transaction('rw',database.tables,async () => {
    for (const trip of await database.trips.toArray()) await refreshLegacyProjection(database,trip.id)
  })
}
