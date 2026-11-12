import type { Journey, Accommodation } from '../evolution/v21/contracts'
import { activityMapPoint } from './mapPoint'
import { MERCATOR_LIMIT, type TripMapPoint } from './tripMapModel'
import { transferGeometry, type MapLink } from './tripMapTransfers'
export const journeyPointId=(journeyId:string,stopId:string)=>JSON.stringify(['journey',journeyId,stopId])
export const journeyLinkId=(journeyId:string,segmentId:string)=>JSON.stringify(['segment',journeyId,segmentId])
export function journeyMap(journeys:readonly Journey[],tripId:string,date?:string){
 const rows=journeys.filter(row=>row.tripId===tripId&&row.purpose!=='activity-connection'&&(!date||row.departure?.date===date))
 const points:TripMapPoint[]=[],links:MapLink[]=[],owners=new Map<string,Journey>()
 for(const row of rows){const byId=new Map<string,TripMapPoint>();for(const stop of row.stops){const gps=activityMapPoint({...stop.place,location:stop.place.name});if(!gps)continue;const point={...gps,id:journeyPointId(row.id,stop.id),title:`${row.title} · ${stop.place.name}`,kind:stop.kind};points.push(point);byId.set(stop.id,point);owners.set(point.id,row)}
 for(let i=0;i<row.segments.length;i++){const segment=row.segments[i],from=byId.get(segment.fromStopId),to=byId.get(segment.toStopId);if(segment.fromStopId!==row.stops[i]?.id||segment.toStopId!==row.stops[i+1]?.id||!from||!to||Math.abs(from.latitude)>MERCATOR_LIMIT||Math.abs(to.latitude)>MERCATOR_LIMIT)continue;const id=journeyLinkId(row.id,segment.id);links.push({transfer:{id,mode:segment.mode},geometry:transferGeometry(from,to)});owners.set(id,row)}}
 const coverage=new Map(rows.map(row=>{const displayed=points.filter(point=>owners.get(point.id)?.id===row.id&&Math.abs(point.latitude)<=MERCATOR_LIMIT).length;const connections=links.filter(link=>owners.get(link.transfer.id)?.id===row.id).length;return [row.id,{displayed,total:row.stops.length,connections}] as const}))
 return {rows,points,links,owners,coverage}
}
export function accommodationsForMap(stays:readonly Accommodation[],tripId:string,date?:string){return stays.filter(stay=>stay.tripId===tripId&&(!date||date>=stay.arrivalDate&&date<=stay.departureDate))}
export function accommodationMap(stays:readonly Accommodation[],tripId:string,date?:string):TripMapPoint[]{return accommodationsForMap(stays,tripId,date).flatMap(stay=>{const gps=activityMapPoint({...stay.place,location:stay.place.name});return gps?[{...gps,id:JSON.stringify(['stay',stay.id]),title:`Hébergement · ${stay.place.name}`,kind:'accommodation' as const}]:[]})}
