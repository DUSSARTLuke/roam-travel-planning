import type { ActivityCategory, ActivityPeriod, ActivitySchedule, TripActivity, TripActivityInput } from '../../db/activityModel'

export type ActivityFormValues = {
  title: string
  category: ActivityCategory
  date: string
  idea: boolean
  scheduleType: ActivitySchedule['scheduleType']
  startTime: string
  endTime: string
  period: ActivityPeriod
  location: string
  notes: string
}

export function initialActivityValues(activity: TripActivity | null, date: string | null, fallback: string): ActivityFormValues {
  return {
    title: activity?.title ?? '', category: activity?.category ?? 'visit',
    date: activity?.date ?? date ?? fallback, idea: activity ? activity.date === null : date === null,
    scheduleType: activity?.scheduleType ?? 'unscheduled', startTime: activity?.startTime ?? '',
    endTime: activity?.endTime ?? '', period: activity?.period ?? 'morning',
    location: activity?.location ?? '', notes: activity?.notes ?? '',
  }
}

// A complete editable input, with hidden fields taken from the latest stored
// activity. Schedule fields are rebuilt so obsolete times cannot leak across modes.
export function activityFormInput(form: ActivityFormValues, existing: TripActivity | null): TripActivityInput {
  let schedule: ActivitySchedule
  if (form.scheduleType === 'exact') {
    schedule = { scheduleType: 'exact', startTime: form.startTime, endTime: form.endTime || undefined, period: null }
  } else if (form.scheduleType === 'period') {
    schedule = { scheduleType: 'period', period: form.period }
  } else {
    schedule = { scheduleType: 'unscheduled', period: null }
  }
  return {
    ...schedule, title: form.title, category: form.category, date: form.idea ? null : form.date,
    location: form.location, notes: form.notes, sortOrder: existing?.sortOrder ?? 0,
    estimatedCost: existing?.estimatedCost, currency: existing?.currency,
    reservationStatus: existing?.reservationStatus, url: existing?.url,
  }
}

