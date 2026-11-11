import { useMemo } from 'react'
import type { Journey, Accommodation } from '../evolution/v21/contracts'
import { journeyMap, accommodationMap } from './journeyMap'
import { drawablePoints, type TripMapPoint } from './tripMapModel'
import type { MapTransfer } from './tripMapTransfers'
// One memoized presentation snapshot per reactive read/filter, independent of camera/UI state.
export function useJourneyMapData(journeys:Journey[]|undefined,accommodations:Accommodation[]|undefined,tripId:string,date:string|undefined,show:boolean,points:TripMapPoint[],transfers:MapTransfer[]){
 return useMemo(()=>{const nativeMap=journeyMap(show?journeys??[]:[],tripId,date),stays=accommodationMap(accommodations??[],tripId,date);const allPoints=[...points,...nativeMap.points,...stays];const legacyLinks=show?transfers.filter(link=>!(journeys??[]).some(row=>row.legacy?.id===link.transfer.id)):[];const allLinks=[...legacyLinks,...nativeMap.links];return {nativeMap,stays,allPoints,visible:drawablePoints(allPoints),allLinks,legacyLinks}},[journeys,accommodations,tripId,date,show,points,transfers])
}
