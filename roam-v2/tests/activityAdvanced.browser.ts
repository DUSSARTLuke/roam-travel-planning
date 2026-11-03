import { createActivityRepository } from '../src/db/activities'
import { activityFormInput, initialActivityValues } from '../src/components/program/activityFormModel'
import type { TripActivityInput } from '../src/db/activityModel'

type Repo = ReturnType<typeof createActivityRepository>
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function rejects(operation: () => Promise<unknown>) {
  let failed = false
  try { await operation() } catch { failed = true }
  assert(failed, 'Validation avancée contournée.')
}

export async function testAdvancedActivities(repo: Repo, tripId: string) {
  const plain: TripActivityInput = { title: 'Test avancé isolé', category: 'visit', date: null,
    scheduleType: 'unscheduled', period: null, sortOrder: 0 }
  let activity = await repo.createActivity(tripId, plain)
  assert(activity.estimatedCost === undefined && activity.paidAmount === undefined && activity.links === undefined, 'Création rapide incorrecte.')
  activity = await repo.updateActivity(tripId, activity.id, { ...plain, estimatedCost: 0, paidAmount: 0,
    currency: 'gbp', reservationStatus: 'pending', url: 'https://example.com/legacy',
    reservationReference: 'REF-123', reservationProvider: 'Prestataire', reservationPeople: 2,
    reservationDeadline: '2028-02-29', reservationNotes: 'À conserver',
    links: [{ id: 'one', title: 'Premier', url: 'https://example.com/one' }, { id: 'two', title: 'Deuxième', url: 'http://example.com/two' }] })
  assert(activity.estimatedCost === 0 && activity.paidAmount === 0 && activity.currency === 'GBP', 'Zéro ou devise perdus.')
  // Old clients omit the new advanced fields; omitted is not deletion.
  activity = await repo.updateActivity(tripId, activity.id, { ...plain, title: 'Titre seul' })
  assert(activity.reservationReference === 'REF-123' && activity.url === 'https://example.com/legacy' && activity.links?.length === 2, 'Anciennes valeurs perdues lors d’une modification simple.')
  const initial = initialActivityValues(activity, null, '2026-12-31')
  let form = { ...initial, reservationStatus: 'cancelled' as const, estimatedCost: '25.5', paidAmount: '0', currency: 'USD' }
  activity = await repo.updateActivity(tripId, activity.id, activityFormInput(form, activity, initial))
  assert(activity.reservationReference === 'REF-123' && activity.reservationStatus === 'cancelled', 'Changement de statut destructif.')
  assert(activity.estimatedCost === 25.5 && activity.paidAmount === 0 && activity.currency === 'USD', 'Budget incorrect.')
  const baseline = initialActivityValues(activity, null, '2026-12-31')
  form = { ...baseline, reservationStatus: 'cancelled', estimatedCost: '', paidAmount: '', currency: 'EUR',
    links: [{ id: 'two', title: 'Titre modifié', url: 'https://example.com/new' }, { id: 'three', title: 'Ajout', url: 'https://example.com/three' }] }
  activity = await repo.updateActivity(tripId, activity.id, activityFormInput(form, activity, baseline))
  assert(activity.estimatedCost === undefined && activity.paidAmount === undefined, 'Valeurs absentes confondues avec zéro.')
  assert(activity.links?.map((link) => link.id).join() === 'two,three' && activity.links[0].title === 'Titre modifié', 'Identifiants/ordre/liens incorrects.')
  const currentForm = initialActivityValues(activity, null, '2026-12-31')
  const changedElsewhere = await repo.updateActivity(tripId, activity.id, { ...plain, reservationReference: 'REF-EXTERNE' })
  const merged = activityFormInput({ ...currentForm, title: 'Modification simple' }, changedElsewhere, currentForm)
  assert(merged.reservationReference === 'REF-EXTERNE', 'Champ non modifié écrasé par une saisie obsolète.')
  for (const patch of [
    { paidAmount: -1 }, { paidAmount: NaN }, { estimatedCost: Infinity }, { currency: 'ZZZ' },
    { reservationPeople: 0 }, { reservationPeople: 1.5 }, { reservationDeadline: '2027-02-29' },
    { links: [{ id: 'x', title: 'X', url: 'javascript:alert(1)' }] },
    { links: [{ id: 'x', title: '', url: 'https://example.com' }] },
    { links: [{ id: 'x', title: 'X', url: 'https://example.com' }, { id: 'x', title: 'Y', url: 'https://example.com' }] },
    { links: [{ id: 'x', title: 'X', url: 'data:text/html,bad' }] },
    { links: [{ id: 'x', title: 'X', url: 'not-a-url' }] },
  ]) await rejects(() => repo.updateActivity(tripId, activity.id, { ...plain, ...patch } as TripActivityInput))
  const reread = await repo.getActivity(tripId, activity.id)
  assert(reread.links?.length === 2 && reread.reservationReference === 'REF-EXTERNE', 'Échec de validation a altéré les données.')
  await repo.deleteActivity(tripId, activity.id)
}
