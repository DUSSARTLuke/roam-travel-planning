import { activitiesShareParticipants } from './activityParticipants'
import { connectionEndpoints, connectionKey } from '../routing/activityConnections'
import { refreshLegacyProjection } from '../evolution/v21/projection'
import { createId } from '../utils/createId'
import { db, type RoamDatabase } from './database'
import { transferKey, validateTransferInput, type TransferInput, type ManualTransfer } from './transferModel'
import { projectLegacyTransfers } from '../evolution/v21/graph'
import { planV6 } from '../evolution/v21/migrationPlan'
import { createV21Repository } from '../evolution/v21/repository'
import { entityKey } from '../sync/model'

// Canonical read; never use the persisted Trip projection to decide a write.
export async function readLegacyTransfers(database: RoamDatabase, tripId: string) {
  const rows = await database.journeys.where('tripId').equals(tripId).toArray()
  const versions = new Map<string, {identity: string; revision: number}>()
  for (const row of rows) {
    const state = await database.syncEntities.get(entityKey('journeys',row.id))
    if (!state || state.deleted) throw new Error('Révision de déplacement absente.')
    versions.set(row.id,{identity:state.identity,revision:state.revision})
  }
  return {rows, projection:projectLegacyTransfers({id:tripId} as import('./database').Trip,rows,versions)}
}
export function createTransferRepository(database: RoamDatabase = db) {
  async function parent(tripId: string) {
    const trip = await database.trips.get(tripId)
    if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Voyage inaccessible. Restaure-le avant de modifier ses déplacements.')
    return trip
  }
  return {
    async saveTransfer(tripId: string, input: TransferInput, id?: string, expected?: string): Promise<ManualTransfer> {
      const fields = validateTransferInput(input)
      return database.transaction('rw',database.tables,async () => {
        const trip=await parent(tripId), {rows,projection}=await readLegacyTransfers(database,tripId)
        const existing=id===undefined?undefined:projection.find(t=>t.id===id)
        if (id!==undefined && (!existing || transferKey(existing)!==expected)) throw new Error('Ce déplacement a changé ou a été supprimé. Ferme puis rouvre le formulaire.')
        if (!existing && rows.length>=10000) throw new Error('Limite de déplacements atteinte.')
        const from=await database.activities.get(fields.fromActivityId), to=await database.activities.get(fields.toActivityId)
        if (!from || !to || from.tripId!==tripId || to.tripId!==tripId || from.date===null || from.date!==to.date) throw new Error('Choisis deux activités de la même journée dans ce voyage.')
        if (!existing && !activitiesShareParticipants(from, to)) throw new Error('Ces activités n’ont aucun participant commun.')
        if (!existing && rows.some(row => { const endpoints = connectionEndpoints(row); return row.purpose === 'activity-connection' && endpoints && connectionKey(...endpoints) === connectionKey(from.id, to.id) })) throw new Error('Une liaison existe déjà dans le Programme. Modifie-la directement.')
        const before=id===undefined?undefined:rows.find(row=>row.legacy?.id===id)
        const now=new Date().toISOString()
        const transfer={...fields,...(!Object.hasOwn(input,'paidAmount') && existing?.paidAmount!==undefined?{paidAmount:existing.paidAmount}:{}),id:existing?.id??createId(),createdAt:existing?.createdAt??now,updatedAt:now}
        const proposed=planV6({databaseVersion:5,trips:[{...trip,manualTransfers:[transfer],expenseShares:undefined}],activities:[from,to],documents:[],blobIds:[]},()=>before?.id??createId()).journeys[0]
        const sameLinks=before?.stops[0].link?.id===from.id && before?.stops[1].link?.id===to.id
        // Patch only fields exposed by V2. Reservations, title and other native fields survive.
        const row=before?{...before,estimatedCost:proposed.estimatedCost,paidAmount:proposed.paidAmount,currency:proposed.currency,notes:proposed.notes,updatedAt:now,
          stops:sameLinks?before.stops:proposed.stops.map((stop,i)=>({...before.stops[i],...stop,id:before.stops[i].id})),segments:[{...before.segments[0],mode:proposed.segments[0].mode,durationMinutes:proposed.segments[0].durationMinutes,...(before.segments[0].durationSource !== undefined ? {durationSource:proposed.segments[0].durationMinutes === undefined ? undefined : 'manual' as const} : {}),fromStopId:before.stops[0].id,toStopId:before.stops[1].id}],
          ...(sameLinks?{}:{departure:proposed.departure,arrival:proposed.arrival})}:proposed
        if (before) await database.journeys.put(row); else await database.journeys.add(row)
        await refreshLegacyProjection(database,tripId)
        return (await readLegacyTransfers(database,tripId)).projection.find(t=>t.id===transfer.id)!
      })
    },
    async deleteTransfer(tripId: string,id: string,expected: string): Promise<void> {
      await database.transaction('rw',database.tables,async () => {
        await parent(tripId)
        const {rows,projection}=await readLegacyTransfers(database,tripId), existing=projection.find(t=>t.id===id)
        if (!existing || transferKey(existing)!==expected) throw new Error('Ce déplacement a changé ou a été supprimé. Actualise la fiche.')
        const row=rows.find(item=>item.legacy?.id===id)!, version=existing._journeyVersion!
        await createV21Repository(database).remove('journeys',tripId,row.id,version)
      })
    },
  }
}
export const { saveTransfer,deleteTransfer }=createTransferRepository()
