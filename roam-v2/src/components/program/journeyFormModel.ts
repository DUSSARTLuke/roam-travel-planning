import { coordinateInput } from '../../db/activityLocation'
import type { Journey, JourneyStop, JourneySegment, Accommodation, Place } from '../../evolution/v21/contracts'
import type { ReservationStatus, TripActivity } from '../../db/activityModel'
import { createId } from '../../utils/createId'
import { tripReferenceCurrency } from '../../db/currency'
import type { Trip } from '../../db/database'
export type EndpointDraft = { id?: string; latitudeText?: string; longitudeText?: string; referenceKind?: 'activity'|'accommodation'; kind: JourneyStop['kind']; reference: string; place: Place; link?: JourneyStop['link'] }
export type JourneyDraft = {
  title: string; from: EndpointDraft; to: EndpointDraft; intermediate: EndpointDraft[]; segments: JourneySegment[]; date: string; arrivalDate: string; departureTime: string; arrivalTime: string
  mode: Journey['segments'][number]['mode']; estimated: string; paid: string; currency: string
  status: string; reference: string; provider: string; people: string; deadline: string; reservationNotes: string; notes: string
}
export function journeyDraft(trip: Trip, date: string, journey?: Journey): JourneyDraft {
  const endpoint=(stop?: JourneyStop):EndpointDraft=>({id:stop?.id??createId(),referenceKind:stop?.link?.kind??'activity',kind:stop?.kind??'free',reference:stop?.link?.state==='linked'?stop.link.id:'',place:stop?{...stop.place}:{name:''},link:stop?.link})
  const from=endpoint(journey?.stops[0]),to=endpoint(journey?.stops.at(-1))
  return {title:journey?.title??'',from,to,intermediate:journey?.stops.slice(1,-1).map(endpoint)??[],segments:journey?.segments.map(segment=>({...segment}))??[{id:createId(),fromStopId:from.id!,toStopId:to.id!,mode:'train'}],date:journey?journey.departure?.date??'':date,arrivalDate:journey?journey.arrival?.date??'':date,
    departureTime:journey?.departure?.time??'',arrivalTime:journey?.arrival?.time??'',mode:journey?.segments[0].mode??'train',estimated:journey?.estimatedCost?.toString()??'',paid:journey?.paidAmount?.toString()??'',currency:journey?journey.currency??'':tripReferenceCurrency(trip),
    status:journey?.reservation?.status??'',reference:journey?.reservation?.reference??'',provider:journey?.reservation?.provider??'',people:journey?.reservation?.people?.toString()??'',deadline:journey?.reservation?.deadline??'',reservationNotes:journey?.reservation?.notes??'',notes:journey?.notes??''}
}
export function moneyDraft(value:string):number|undefined {
  if (!value.trim()) return undefined
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) throw new Error('Saisis un montant positif ou nul avec un point ou une virgule.')
  const amount=Number(value.replace(',','.')); if (!Number.isFinite(amount)) throw new Error('Montant trop élevé.'); return amount
}
export function activityEndpoint(activity:TripActivity):EndpointDraft {
  return {referenceKind:'activity',kind:'activity',reference:activity.id,place:{name:activity.location||activity.title,...(activity.address?{address:activity.address}:{}),...(activity.latitude!==undefined?{latitude:activity.latitude,longitude:activity.longitude}:{})}}
}
export function draftJourney(tripId:string,draft:JourneyDraft,previous?:Journey):Journey {
  const now=new Date().toISOString(),id=previous?.id??createId()
  const stop=(endpoint:EndpointDraft,index:number):JourneyStop=>{
    const old=previous?.stops.find(stop=>stop.id===endpoint.id)
    return {...old,id:endpoint.id??old?.id??`${id}:s${index}`,kind:endpoint.kind,place:{...endpoint.place,...(endpoint.latitudeText!==undefined?{latitude:coordinateInput(endpoint.latitudeText,'Latitude'),longitude:coordinateInput(endpoint.longitudeText??'','Longitude')}:{}),name:endpoint.place.name.trim(),address:endpoint.place.address?.trim()||undefined},
      link:endpoint.reference?{kind:endpoint.referenceKind??'activity',id:endpoint.reference,state:'linked'}:endpoint.link}
  }
  const stops=[draft.from,...draft.intermediate,draft.to].map(stop)
  if (!draft.date && (!previous || previous.departure)) throw new Error('Renseigne la date de départ.')
  if (draft.departureTime&&!draft.date || draft.arrivalTime&&!draft.arrivalDate) throw new Error('Renseigne la date correspondant à chaque horaire.')
  // Cross-zone imported journeys keep their zones; never infer elapsed time.
  const sameZone=previous?.departure?.timeZone===previous?.arrival?.timeZone
  if (sameZone && draft.date && draft.arrivalDate && (draft.arrivalDate<draft.date || draft.arrivalDate===draft.date && draft.departureTime && draft.arrivalTime && draft.arrivalTime<draft.departureTime)) throw new Error('L’arrivée précède le départ. Pour un trajet de nuit, choisis la date d’arrivée du lendemain.')
  const people=moneyDraft(draft.people)
  if (people!==undefined && (!Number.isSafeInteger(people)||people<=0)) throw new Error('Le nombre de personnes doit être un entier strictement positif.')
  return {...previous,id,tripId,title:draft.title.trim()||`${stops[0].place.name} → ${stops.at(-1)!.place.name}`,stops,
    segments:stops.slice(0,-1).map((from,index)=>{const to=stops[index+1];const segment=draft.segments.find(s=>s.fromStopId===from.id&&s.toStopId===to.id);return {...segment,id:segment?.id??createId(),fromStopId:from.id,toStopId:to.id,mode:index===0?draft.mode:segment?.mode??'other'}}),
    departure:draft.date?{...previous?.departure,date:draft.date,time:draft.departureTime||undefined}:undefined,arrival:draft.arrivalDate?{...previous?.arrival,date:draft.arrivalDate,time:draft.arrivalTime||undefined}:undefined,
    estimatedCost:moneyDraft(draft.estimated),paidAmount:moneyDraft(draft.paid),currency:draft.currency||undefined,
    reservation:{...previous?.reservation,status:(draft.status||undefined) as ReservationStatus|undefined,
      reference:draft.reference.trim()||undefined,provider:draft.provider.trim()||undefined,people,deadline:draft.deadline||undefined,notes:draft.reservationNotes.trim()||undefined},
    notes:draft.notes.trim()||undefined,createdAt:previous?.createdAt??now,updatedAt:now}
}

export function accommodationEndpoint(stay:Accommodation):EndpointDraft {return {referenceKind:'accommodation',kind:'accommodation',reference:stay.id,place:{...stay.place}}}
export function orderedEndpoints(draft:JourneyDraft):EndpointDraft[]{return [draft.from,...draft.intermediate,draft.to]}
// Retain only unchanged directed edges: never move a duration to a different pair.
export function reconcileSegments(draft:JourneyDraft):JourneyDraft {
 const stops=orderedEndpoints(draft);const segments=stops.slice(0,-1).map((from,index)=>{const to=stops[index+1];const old=draft.segments.find(s=>s.fromStopId===from.id&&s.toStopId===to.id);return old??{id:createId(),fromStopId:from.id!,toStopId:to.id!,mode:'other' as const}});
 // Keep inactive draft edges until save: undoing a reorder restores their exact data.
 const known=new Set(draft.segments.map(segment=>segment.id))
 return {...draft,segments:[...draft.segments,...segments.filter(segment=>!known.has(segment.id))],mode:segments[0].mode}
}
