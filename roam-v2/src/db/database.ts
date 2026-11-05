import type { TripParticipant, ExpenseShare } from '../money/expenseSharing'
import type { ManualTransfer } from './transferModel'

import Dexie, { type EntityTable } from 'dexie'
import type { ActivityDocument, ActivityDocumentBlob } from './documentModel'
import type { AutomaticRateCache } from '../money/automaticRates'
import type { ManualExchangeRate } from '../money/manualRates'
import type { TripActivity } from './activityModel'

export type Trip = {
  id: string
  destination: string
  country: string
  startDate: string
  endDate: string
  travelers: number
  image: string
  participants?: TripParticipant[]
  expenseShares?: ExpenseShare[]
  // Missing on legacy records: EUR logically, without rewriting stored data.
  referenceCurrency?: string
  manualTransfers?: ManualTransfer[]
  manualExchangeRates?: ManualExchangeRate[]
  automaticExchangeRates?: AutomaticRateCache
  // Missing on legacy records: treated as false without rewriting user data.
  archived?: boolean
  deletedAt?: string
}

type DatabaseMetadata = {
  key: string
  initialized: boolean
}

const initializationMarker: DatabaseMetadata = {
  key: 'initialization',
  initialized: true,
}

const exampleTrip: Trip = {
  id: 'london-2026',
  archived: false,
  destination: 'Londres',
  country: 'Royaume-Uni',
  startDate: '2026-12-28',
  endDate: '2027-01-03',
  travelers: 2,
  image:
    'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&auto=format&fit=crop',
}

export class RoamDatabase extends Dexie {
  trips!: EntityTable<Trip, 'id'>
  metadata!: EntityTable<DatabaseMetadata, 'key'>
  activities!: EntityTable<TripActivity, 'id'>
  activityDocuments!: EntityTable<ActivityDocument, 'id'>
  activityDocumentBlobs!: EntityTable<ActivityDocumentBlob, 'id'>

  constructor(name = 'roam-v2-db') {
    super(name)

    this.version(1).stores({
      trips: 'id, destination, startDate, endDate',
    })

    this.version(2)
      .stores({
        trips: 'id, destination, startDate, endDate',
        metadata: 'key',
      })
      .upgrade(async (transaction) => {
        // An existing database is already initialized, even if trips is empty.
        // Never seed or modify its trips during migration.
        await transaction.table('metadata').put(initializationMarker)
      })

    // Adding a store preserves existing trips and initialization metadata.
    // Null dates are not indexable in IndexedDB; ideas use the tripId index.
    this.version(3).stores({
      trips: 'id, destination, startDate, endDate',
      metadata: 'key',
      activities: 'id, tripId, [tripId+date]',
    })

    // Separate payloads keep metadata queries free of Blob reads.
    this.version(4).stores({
      trips: 'id, destination, startDate, endDate',
      metadata: 'key',
      activities: 'id, tripId, [tripId+date]',
      activityDocuments: 'id, activityId',
      activityDocumentBlobs: 'id',
    })

    // populate runs only for a brand-new database, in its exclusive creation
    // transaction. Both writes commit together or are rolled back together.
    this.on('populate', async (transaction) => {
      await transaction.table('trips').add(exampleTrip)
      await transaction.table('metadata').add(initializationMarker)
    })
  }
}

export const db = new RoamDatabase()

export async function initializeDatabase(): Promise<void> {
  // Dexie shares concurrent opens of this instance; IndexedDB serializes
  // creation/upgrades across tabs. Awaiting open also awaits populate/migration.
  // Reopening an initialized database never runs populate again.
  await db.open()
}

// Recheck state and write in one transaction, including across browser tabs.
export async function updateTripTrash(
  id: string,
  action: 'trash' | 'restore' | 'delete',
  confirmedDeletedAt?: string,
  database: RoamDatabase = db,
): Promise<void> {
  await database.transaction('rw', [database.trips, database.activities, database.activityDocuments, database.activityDocumentBlobs], async () => {
    const trip = await database.trips.get(id)
    if (!trip) throw new Error('Ce voyage est introuvable. Actualise la liste.')

    if (action === 'delete') {
      if (trip.deletedAt === undefined || trip.deletedAt !== confirmedDeletedAt) {
        throw new Error('Le voyage a changé ou a été restauré. Aucune suppression effectuée.')
      }
      const activityIds = await database.activities.where('tripId').equals(id).primaryKeys()
      const documentIds = await database.activityDocuments.where('activityId').anyOf(activityIds).primaryKeys()
      await database.activityDocumentBlobs.bulkDelete(documentIds)
      await database.activityDocuments.bulkDelete(documentIds)
      await database.activities.where('tripId').equals(id).delete()
      await database.trips.delete(id)
    } else if (action === 'restore') {
      if (trip.deletedAt === undefined) return
      delete trip.deletedAt
      await database.trips.put(trip)
    } else {
      if (trip.deletedAt !== undefined) return
      await database.trips.update(id, { deletedAt: new Date().toISOString() })
    }
  })
}
