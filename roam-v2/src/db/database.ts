
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

class RoamDatabase extends Dexie {
  trips!: EntityTable<Trip, 'id'>

  constructor() {
    super('roam-v2-db')

    this.version(1).stores({
      trips: 'id, destination, startDate, endDate',
    })
  }
}

export const db = new RoamDatabase()

export async function initializeDatabase() {
  const existingTrips = await db.trips.count()

  if (existingTrips === 0) {
    await db.trips.add({
      id: 'london-2026',
      destination: 'Londres',
      country: 'Royaume-Uni',
      startDate: '2026-12-28',
      endDate: '2027-01-03',
      travelers: 2,
      image:
        'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&auto=format&fit=crop',
    })
  }
}
