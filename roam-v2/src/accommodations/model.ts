import type { Accommodation } from '../evolution/v21/contracts'
import type { TripActivity } from '../db/activityModel'
import { parseDate } from '../components/program/dates'
export function stayNights(stay:Pick<Accommodation,'arrivalDate'|'departureDate'>):number|null{const from=parseDate(stay.arrivalDate),to=parseDate(stay.departureDate);return from&&to&&to>=from?(to.getTime()-from.getTime())/86400000:null}
export function stayPhase(stay:Accommodation,date:string):string|null{if(date<stay.arrivalDate||date>stay.departureDate)return null;return date===stay.arrivalDate&&date===stay.departureDate?'Arrivée et départ (0 nuit)':date===stay.arrivalDate?'Arrivée':date===stay.departureDate?'Départ':'Nuit sur place'}
export function staysOverlap(a:Accommodation,b:Accommodation):boolean{return a.id!==b.id&&a.arrivalDate<b.departureDate&&b.arrivalDate<a.departureDate}
export function matchingActivityReservations(stay:Accommodation,activities:readonly TripActivity[]){if(stay.estimatedCost===undefined&&stay.paidAmount===undefined)return [];const reference=stay.reservation?.reference?.trim().toLocaleUpperCase();return reference?activities.filter(a=>a.tripId===stay.tripId&&a.reservationReference?.trim().toLocaleUpperCase()===reference&&(a.estimatedCost!==undefined||a.paidAmount!==undefined)):[]}
