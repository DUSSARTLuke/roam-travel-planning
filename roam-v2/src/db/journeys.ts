import { db } from './database'
import { createV21Repository } from '../evolution/v21/repository'
export const programJourneyRepository=createV21Repository()
// One reactive query per trip, never one per displayed day.
export const listProgramJourneys=(tripId:string)=>db.journeys.where('tripId').equals(tripId).toArray()

export const listMapAccommodations=(tripId:string)=>db.accommodations.where('tripId').equals(tripId).toArray()
