import { activityRevision, activityVersion } from '../../db/activityRevision'
import { coordinateFormValue, coordinateInput } from '../../db/activityLocation'
import type { ActivityCategory, ActivityLink, ReservationType, ReservationStatus, ActivityPeriod, ActivitySchedule, TripActivity, TripActivityInput } from '../../db/activityModel'

export type ActivityFormValues = {
  participantIds?: string[]
  title: string
  category: ActivityCategory
  date: string
  idea: boolean
  scheduleType: ActivitySchedule['scheduleType']
  startTime: string
  endTime: string
  period: ActivityPeriod
  location: string
  address: string
  latitude: string
  longitude: string
  notes: string
  reservationType: ReservationType | ''
  reservationStatus: ReservationStatus | ''
  reservationReference: string
  reservationProvider: string
  reservationPeople: string
  reservationDeadline: string
  reservationNotes: string
  estimatedCost: string
  paidAmount: string
  currency: string
  legacyUrl: string
  links: ActivityLink[]
}

export function initialActivityValues(activity: TripActivity | null, date: string | null, fallback: string, referenceCurrency = 'EUR'): ActivityFormValues {
  return {
    participantIds: activity?.participantIds?.slice(),
    title: activity?.title ?? '', category: activity?.category ?? 'visit',
    date: activity?.date ?? date ?? fallback, idea: activity ? activity.date === null : date === null,
    scheduleType: activity?.scheduleType ?? 'unscheduled', startTime: activity?.startTime ?? '',
    endTime: activity?.endTime ?? '', period: activity?.period ?? 'morning',
    address: activity?.address ?? '', latitude: coordinateFormValue(activity?.latitude),
    longitude: coordinateFormValue(activity?.longitude),
    location: activity?.location ?? '', notes: activity?.notes ?? '',
    reservationType: activity?.reservationType ?? '',
    reservationStatus: activity?.reservationStatus ?? '',
    reservationReference: activity?.reservationReference ?? '', reservationProvider: activity?.reservationProvider ?? '',
    reservationPeople: activity?.reservationPeople === undefined ? '' : String(activity.reservationPeople),
    reservationDeadline: activity?.reservationDeadline ?? '', reservationNotes: activity?.reservationNotes ?? '',
    estimatedCost: activity?.estimatedCost === undefined ? '' : String(activity.estimatedCost),
    paidAmount: activity?.paidAmount === undefined ? '' : String(activity.paidAmount),
    currency: activity ? activity.currency ?? '' : referenceCurrency, legacyUrl: activity?.url ?? '',
    links: activity?.links?.map((link) => ({ ...link })) ?? [],
  }
}

// A complete editable input built from the explicitly opened/reloaded snapshot.
// Never merge a stale draft with a newer activity automatically. Schedule fields are rebuilt so obsolete times cannot leak across modes.
export function activityFormInput(form: ActivityFormValues, existing: TripActivity | null, _initial?: ActivityFormValues): TripActivityInput {
  let schedule: ActivitySchedule
  if (form.scheduleType === 'exact') {
    schedule = { scheduleType: 'exact', startTime: form.startTime, endTime: form.endTime || undefined, period: null }
  } else if (form.scheduleType === 'period') {
    schedule = { scheduleType: 'period', period: form.period }
  } else {
    schedule = { scheduleType: 'unscheduled', period: null }
  }
  return {
    ...(activityVersion(existing) ? { [activityRevision]: activityVersion(existing) } : {}),
    participantIds: form.participantIds?.slice(),
    ...schedule, title: form.title, category: form.category, date: form.idea ? null : form.date,
    address: form.address, latitude: coordinateInput(form.latitude, 'La latitude'), longitude: coordinateInput(form.longitude, 'La longitude'),
    location: form.location, notes: form.notes, sortOrder: existing?.sortOrder ?? 0,
    estimatedCost: form.estimatedCost.trim() === '' ? undefined : Number(form.estimatedCost),
    paidAmount: form.paidAmount.trim() === '' ? undefined : Number(form.paidAmount),
    currency: form.currency || undefined, reservationType: form.reservationType || undefined, reservationStatus: form.reservationStatus || undefined,
    reservationReference: form.reservationReference || undefined, reservationProvider: form.reservationProvider || undefined,
    reservationPeople: form.reservationPeople.trim() === '' ? undefined : Number(form.reservationPeople),
    reservationDeadline: form.reservationDeadline || undefined, reservationNotes: form.reservationNotes || undefined,
    url: form.legacyUrl || undefined, links: form.links,
  }
}

