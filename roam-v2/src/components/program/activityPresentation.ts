import type { ActivityCategory, ActivityPeriod, TripActivity } from '../../db/activityModel'

export const categoryLabels: Record<ActivityCategory, string> = {
  visit: 'Visite', meal: 'Restaurant / repas', transport: 'Transport',
  outing: 'Activité / sortie', rest: 'Repos', other: 'Autre',
}

export const periodLabels: Record<ActivityPeriod, string> = {
  morning: 'Matin', afternoon: 'Après-midi', evening: 'Soir',
}

export function activityScheduleLabel(activity: TripActivity): string {
  if (activity.scheduleType === 'exact') {
    return activity.endTime ? `${activity.startTime} – ${activity.endTime}` : activity.startTime
  }
  return activity.scheduleType === 'period' ? periodLabels[activity.period] : 'Sans horaire'
}

export const reservationLabels = {
  to_book: 'À réserver', confirmed: 'Réservée', not_required: 'Non nécessaire', cancelled: 'Annulée',
  pending: 'En attente (ancien statut)',
} satisfies Record<import('../../db/activityModel').ReservationStatus, string>
