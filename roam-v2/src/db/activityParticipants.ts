import type { TripActivity } from './activityModel'
import type { TripParticipant } from '../money/expenseSharing'
// Missing means collective; an explicit empty list means nobody.
export function validateActivityParticipants(value: unknown, travelers?: readonly TripParticipant[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 512) || new Set(value).size !== value.length) throw new Error('Liste des participants de l’activité invalide.')
  if (travelers && value.some(id => !travelers.some(person => person.id === id))) throw new Error('Un participant ne fait plus partie de ce voyage. Recharge le formulaire.')
  return [...value]
}
export function activityIncludesParticipant(activity: Pick<TripActivity, 'participantIds'>, id: string): boolean {
  return activity.participantIds === undefined || activity.participantIds.includes(id)
}
export function activitiesShareParticipants(a: Pick<TripActivity, 'participantIds'>, b: Pick<TripActivity, 'participantIds'>): boolean {
  if (a.participantIds?.length === 0 || b.participantIds?.length === 0) return false
  return a.participantIds === undefined || b.participantIds === undefined || a.participantIds.some(id => b.participantIds!.includes(id))
}
