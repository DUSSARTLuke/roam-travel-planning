import { activitiesShareParticipants, activityIncludesParticipant, validateActivityParticipants } from '../../db/activityParticipants'
import { individualConnections, connectionEndpoints, connectionKey, connectionPlacesCurrent } from '../../routing/activityConnections'
import { matchingActivityReservations } from '../../accommodations/model'
import { refreshLegacyProjection } from './projection'
import { db, type RoamDatabase } from '../../db/database'
import { createId } from '../../utils/createId'
import { entityKey, type EntityState } from '../../sync/model'
import { LocalRevisionConflict } from '../../sync/commands'
import { assertJourney, assertAccommodation, detachJourneyPlace, type Journey, type Accommodation, type Owner, type OwnedDocument } from './contracts'
import { prepareDocuments, detectDocumentMime, MAX_ACTIVITY_DOCUMENTS, type PreparedDocument } from '../../db/documentModel'

export type Revision = Pick<EntityState, 'identity' | 'revision'>
export type EntityTableName = 'journeys' | 'accommodations'
export async function requireV21Revision(database: RoamDatabase, table: EntityTableName, id: string, expected?: Revision) {
  const state = await database.syncEntities.get(entityKey(table, id))
  if (!expected || !state || state.deleted || state.revision !== expected.revision || state.identity !== expected.identity) throw new LocalRevisionConflict(entityKey(table, id), expected?.revision ?? 0, state?.revision ?? 0)
}
async function writable(database: RoamDatabase, tripId: string) {
  const trip = await database.trips.get(tripId)
  if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Voyage absent, archivé ou dans la corbeille.')
  return trip
}
export async function detachLinkedJourneys(database: RoamDatabase, tripId: string, owner: Owner) {
  for (const journey of await database.journeys.where('tripId').equals(tripId).toArray()) {
    if (!journey.stops.some(stop => stop.link?.kind === owner.kind && stop.link.id === owner.id && stop.link.state === 'linked')) continue
    await database.journeys.put({ ...detachJourneyPlace(journey, owner), updatedAt: new Date().toISOString() })
  }
  await refreshLegacyProjection(database,tripId)
}
export function createV21Repository(database: RoamDatabase = db) {
  async function list<K extends EntityTableName>(table: K, tripId: string) {
    if (!await database.trips.get(tripId)) throw new Error('Voyage absent.')
    return database.table(table).where('tripId').equals(tripId).toArray() as Promise<(K extends 'journeys' ? Journey : Accommodation)[]>
  }
  async function read(table: EntityTableName, tripId: string, id: string) {
    return database.transaction('r', database.tables, async () => {
      const entity = await database.table(table).get(id)
      if (!entity || entity.tripId !== tripId || !await database.trips.get(tripId)) throw new Error('Élément absent ou hors du voyage.')
      const revision = await database.syncEntities.get(entityKey(table, id))
      if (!revision || revision.deleted) throw new Error('Révision absente.')
      return { entity: entity as Journey | Accommodation, revision: { identity: revision.identity, revision: revision.revision } }
    })
  }
  async function save(table: EntityTableName, tripId: string, input: Journey | Accommodation, expected?: Revision) {
    if (input.tripId !== tripId) throw new Error('Voyage incohérent.')
    if (table === 'journeys') assertJourney(input as Journey); else assertAccommodation(input as Accommodation)
    return database.transaction('rw', database.tables, async () => {
      const trip=await writable(database, tripId)
      if (table === 'journeys') {
        const journey = input as Journey
        validateActivityParticipants(journey.participantIds, trip.participants ?? [])
        if (journey.purpose === 'activity-connection') {
          const endpoints = connectionEndpoints(journey)
          const pair = endpoints && individualConnections(trip, await database.activities.where('tripId').equals(tripId).toArray()).find(pair => pair.key === connectionKey(...endpoints))
          if (!pair || !connectionPlacesCurrent(journey, pair) || journey.departure?.date !== pair.from.date || journey.arrival?.date !== pair.to.date || journey.participantIds?.length === 0 || journey.participantIds?.some(id => !pair.participantIds?.includes(id)) || pair.participantIds !== undefined && journey.participantIds === undefined) throw new Error('Le programme, les lieux ou les participants ont changé. Recharge cette liaison avant de l’enregistrer.')
          for (const other of await database.journeys.where('tripId').equals(tripId).toArray()) {
            const edge = connectionEndpoints(other)
            if (other.id !== journey.id && edge && connectionKey(...edge) === pair.key && (other.participantIds === undefined || journey.participantIds === undefined || other.participantIds.some(id => journey.participantIds!.includes(id)))) throw new Error('Un déplacement existe déjà pour ces activités et ces voyageurs. Modifie-le plutôt que le dupliquer.')
          }
        }
      }
      if(table==='journeys'){const journey=input as Journey;const share=trip.expenseShares?.find(share=>share.kind==='journey'&&share.expenseId===journey.id||share.kind==='transfer'&&share.expenseId===journey.legacy?.id);if(share&&(journey.paidAmount!==share.amount||journey.currency!==share.currency))throw new Error('Ce paiement est partagé : modifie son montant ou son partage dans le Budget. Aucun changement enregistré.')}
      if(table==='accommodations'){const stay=input as Accommodation;const share=trip.expenseShares?.find(share=>share.kind==='accommodation'&&share.expenseId===stay.id);if(share&&(stay.paidAmount!==share.amount||stay.currency!==share.currency))throw new Error('Ce paiement est partagé : modifie son montant ou son partage dans le Budget. Les autres données sont conservées.');if(stay.budgetExcluded&&trip.expenseShares?.some(share=>share.kind==='accommodation'&&share.expenseId===stay.id))throw new Error('Retire le partage de cet hébergement avant de l’exclure du budget. Aucun montant n’a été modifié.');if(!stay.budgetExcluded&&matchingActivityReservations(stay,await database.activities.where('tripId').equals(tripId).toArray()).length)throw new Error('Cette référence est déjà suivie dans une activité avec des montants. Coche « Montants déjà suivis ailleurs » pour éviter un double comptage.')}
      const existing = await database.table(table).get(input.id)
      if (existing && existing.tripId !== tripId) throw new Error('Identifiant utilisé dans un autre voyage.')
      if (table === 'journeys') {
        const journey = input as Journey, endpoints = connectionEndpoints(journey)
        const previousEndpoints = existing ? connectionEndpoints(existing) : undefined
        if (endpoints && (!existing || JSON.stringify(endpoints) !== JSON.stringify(previousEndpoints) || journey.participantIds !== undefined)) {
          const from = await database.activities.get(endpoints[0]), to = await database.activities.get(endpoints[1])
          if (!from || !to || !activitiesShareParticipants(from, to) || journey.participantIds?.some(id => !activityIncludesParticipant(from, id) || !activityIncludesParticipant(to, id))) throw new Error('Ces activités ne partagent pas les voyageurs sélectionnés. Recharge le programme.')
        }
      }
      if (existing || expected) await requireV21Revision(database, table, input.id, expected)
      else if (await database.syncEntities.get(entityKey(table, input.id))) throw new Error('Identifiant déjà utilisé ou supprimé.')
      if (!existing && (input as Journey).legacy) throw new Error('La provenance de migration ne peut pas être créée manuellement.')
      if (table === 'journeys' && existing && existing.purpose !== (input as Journey).purpose) throw new Error('La nature de la liaison ne peut pas être modifiée.')
      if (existing && JSON.stringify(existing.legacy) !== JSON.stringify((input as Journey).legacy)) throw new Error('Provenance de migration immuable.')
      if (table === 'journeys') for (const stop of (input as Journey).stops) if (stop.link) {
        if (stop.link.state === 'deleted') {
          const oldStop = existing?.stops.find((item: Journey['stops'][number]) => item.id === stop.id)
          if (!oldStop || JSON.stringify(oldStop.link) !== JSON.stringify(stop.link)) throw new Error('Lien supprimé non vérifiable.')
        } else {
          const parent = await database.table(stop.link.kind === 'activity' ? 'activities' : 'accommodations').get(stop.link.id)
          if (!parent || parent.tripId !== tripId) throw new Error('Lieu lié absent ou appartenant à un autre voyage.')
        }
      }
      const row = structuredClone({ ...input, createdAt: existing?.createdAt ?? input.createdAt, updatedAt: new Date().toISOString() })
      if (existing) await database.table(table).put(row); else await database.table(table).add(row)
      if (table === 'journeys') await refreshLegacyProjection(database,tripId)
      return row
    })
  }
  async function remove(table: EntityTableName, tripId: string, id: string, expected: Revision) {
    await database.transaction('rw', database.tables, async () => {
      await writable(database, tripId)
      await requireV21Revision(database, table, id, expected)
      const entity = await database.table(table).get(id)
      if (!entity || entity.tripId !== tripId) throw new Error('Élément hors du voyage.')
      if (table === 'accommodations') await detachLinkedJourneys(database, tripId, { kind: 'accommodation', id })
      const owner = table === 'journeys' ? 'journey' : 'accommodation'
      const docs = await database.activityDocuments.where('[owner.kind+owner.id]').equals([owner, id]).primaryKeys()
      await database.activityDocumentBlobs.bulkDelete(docs)
      await database.activityDocuments.bulkDelete(docs)
      await database.table(table).delete(id)
      if (table === 'journeys') await refreshLegacyProjection(database,tripId)
      const trip = await database.trips.get(tripId)
      if (trip?.expenseShares) await database.trips.update(tripId, {expenseShares:trip.expenseShares.filter(share =>
        !(share.kind === (table === 'journeys' ? 'journey' : 'accommodation') && share.expenseId === id) &&
        !(table === 'journeys' && entity.legacy && share.kind === 'transfer' && share.expenseId === entity.legacy.id))})
    })
  }
  async function ownerAccess(tripId: string, owner: Owner, write: boolean) {
    if (!owner || !['activity','journey','accommodation'].includes(owner.kind) || typeof owner.id !== 'string' || !owner.id || owner.id.length > 512) throw new Error('Propriétaire documentaire invalide.')
    if (write) await writable(database, tripId)
    else if (!await database.trips.get(tripId)) throw new Error('Voyage absent.')
    const table = owner.kind === 'activity' ? 'activities' : owner.kind === 'journey' ? 'journeys' : 'accommodations'
    const parent = await database.table(table).get(owner.id)
    if (!parent || parent.tripId !== tripId) throw new Error('Propriétaire absent ou hors du voyage.')
  }
  async function storePrepared(tripId: string, owner: Owner, prepared: PreparedDocument[]) {
    await ownerAccess(tripId, owner, true)
    const count = await database.activityDocuments.where('[owner.kind+owner.id]').equals([owner.kind, owner.id]).count()
    if (count + prepared.length > MAX_ACTIVITY_DOCUMENTS) throw new Error('Maximum 5 documents par propriétaire.')
    const rows: OwnedDocument[] = []
    for (const file of prepared) {
      const row = { id: createId(), tripId, owner, name: file.name, mime: file.mime, size: file.size, importedAt: new Date().toISOString(), ...(owner.kind === 'activity' ? { activityId: owner.id } : {}) }
      await database.activityDocuments.add(row as import('../../db/documentModel').ActivityDocument)
      await database.activityDocumentBlobs.add({ id: row.id, blob: file.blob }); rows.push(row)
    }
    return rows
  }
  return {
    listJourneys: (tripId: string) => list('journeys', tripId), listAccommodations: (tripId: string) => list('accommodations', tripId),
    read, saveJourney: (tripId: string, input: Journey, expected?: Revision) => save('journeys', tripId, input, expected),
    saveAccommodation: (tripId: string, input: Accommodation, expected?: Revision) => save('accommodations', tripId, input, expected), remove,
    async importDocuments(tripId: string, owner: Owner, files: readonly File[]) {
      const prepared = await prepareDocuments(files)
      return database.transaction('rw', database.tables, () => storePrepared(tripId, owner, prepared))
    },
    async saveWithDocuments(table: EntityTableName, tripId: string, input: Journey | Accommodation, files: readonly File[], expected?: Revision) {
      const prepared = await prepareDocuments(files)
      return database.transaction('rw', database.tables, async () => {
        const entity = await save(table, tripId, input, expected)
        const documents = await storePrepared(tripId, {kind:table === 'journeys' ? 'journey' : 'accommodation',id:entity.id}, prepared)
        return {entity, documents}
      })
    },
    async listDocuments(tripId: string, owner: Owner) {
      return database.transaction('r', database.tables, async () => { await ownerAccess(tripId, owner, false); const rows = await database.activityDocuments.where('[owner.kind+owner.id]').equals([owner.kind, owner.id]).toArray(); if (rows.some(row => row.tripId !== tripId)) throw new Error('Document hors du voyage.'); return rows as unknown as OwnedDocument[] })
    },
    async deleteDocument(tripId: string, owner: Owner, id: string, expected: string) {
      await database.transaction('rw', database.tables, async () => {
        await ownerAccess(tripId, owner, true)
        const row = await database.activityDocuments.get(id)
        if (!row || row.tripId !== tripId || row.owner?.kind !== owner.kind || row.owner.id !== owner.id || JSON.stringify(row) !== expected) throw new Error('Document modifié, absent ou inaccessible.')
        await database.activityDocumentBlobs.delete(id); await database.activityDocuments.delete(id)
      })
    },
    async getDocument(tripId: string, owner: Owner, id: string) {
      const stored = await database.transaction('r', database.tables, async () => {
        await ownerAccess(tripId, owner, false)
        const metadata = await database.activityDocuments.get(id), payload = await database.activityDocumentBlobs.get(id)
        if (!metadata || metadata.tripId !== tripId || metadata.owner?.kind !== owner.kind || metadata.owner.id !== owner.id || !payload || !(payload.blob instanceof Blob) || payload.blob.size !== metadata.size) throw new Error('Document absent, corrompu ou inaccessible.')
        return { metadata, blob: payload.blob }
      })
      if (detectDocumentMime(new Uint8Array(await stored.blob.slice(0,32).arrayBuffer())) !== stored.metadata.mime) throw new Error('Le fichier est endommagé ou son format ne correspond pas aux métadonnées.')
      return {...stored,blob:stored.blob.slice(0,stored.blob.size,stored.metadata.mime)}
    },
  }
}
