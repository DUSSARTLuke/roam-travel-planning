
import Dexie, { type EntityTable } from 'dexie'

export type Trip = {
  id: string
  destination: string
  country: string
  startDate: string
  endDate: string
  travelers: number
  image: string
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
  destination: 'Londres',
  country: 'Royaume-Uni',
  startDate: '2026-12-28',
  endDate: '2027-01-03',
  travelers: 2,
  image:
    'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&auto=format&fit=crop',
}

class RoamDatabase extends Dexie {
  trips!: EntityTable<Trip, 'id'>
  metadata!: EntityTable<DatabaseMetadata, 'key'>

  constructor() {
    super('roam-v2-db')

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
