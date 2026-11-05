import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { Trip } from '../src/db/database'
import { validateTransferInput, transferKey, type TransferInput, type ManualTransfer } from '../src/db/transferModel'
import type { TripActivity } from '../src/db/activityModel'
import { TransferFormPanel } from '../src/components/program/TransferFormPanel'
import { orderedTransferActivities } from '../src/components/program/transferFormActivities'
import { timedFixture } from './dayPlanning.core'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export async function testTransferFormActivities(report: (message: string) => void) {
  const early = timedFixture('Tôt', '08:00', '09:00', 99)
  const late = timedFixture('Tard', '16:00', '17:00', -99)
  const period: TripActivity = { ...timedFixture('Période', '09:00'), scheduleType: 'period', period: 'morning', startTime: undefined, sortOrder: 2 }
  const legacy: TripActivity = { ...timedFixture('Sans horaire', '09:00'), scheduleType: 'unscheduled', period: null, startTime: undefined, sortOrder: undefined }
  const nextDay = { ...early, id: 'Autre date', date: '2027-01-01' }
  const foreign = { ...early, id: 'Autre voyage', tripId: 'foreign' }
  const idea = { ...early, id: 'Idée', date: null }
  const fixture = [nextDay, late, period, foreign, legacy, idea, early]
  const before = JSON.stringify(fixture)
  const ordered = orderedTransferActivities(Object.freeze(fixture.map((item) => Object.freeze(item))), early.tripId)
  assert(ordered.map((item) => item.id).join() === 'Tôt,Tard,Sans horaire,Période,Autre date', 'Tri dates/heures/À organiser ou isolation incorrect.')
  assert(JSON.stringify(fixture) === before && ordered[0] === early, 'Tri a muté ou dupliqué les activités.')
  const tied = { ...early, id: 'Après égalité' }
  assert(orderedTransferActivities([early, tied], early.tripId).map((item) => item.id).join() === orderedTransferActivities([tied, early], early.tripId).map((item) => item.id).join(), 'Ordre des heures identiques instable.')
  const trip: Trip = { id: early.tripId, destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-01', travelers: 1, image: '', referenceCurrency: 'EUR' }
  const existing: ManualTransfer = { id: 'edit-transfer', fromActivityId: early.id, toActivityId: late.id, mode: 'bus', durationMinutes: 12.5, estimatedCost: 0, currency: 'JPY', notes: 'Conserver ces notes', createdAt: early.createdAt, updatedAt: early.updatedAt }
  const host = document.createElement('div'); document.body.append(host)
  const trigger = document.createElement('button'); document.body.append(trigger)
  const root = createRoot(host)
  let saved: TransferInput | undefined; let savedId: string | undefined; let savedVersion: string | undefined; let calls = 0
  const persist = async (_tripId: string, input: TransferInput, id?: string, expected?: string): Promise<ManualTransfer> => {
    calls++; saved = validateTransferInput(input); savedId = id; savedVersion = expected
    return { ...saved, id: id ?? 'new-transfer', createdAt: early.createdAt, updatedAt: early.updatedAt }
  }
  const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => flushSync(() => {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }))
  })
  const fields = () => { const selects = host.querySelectorAll<HTMLSelectElement>('select'); return { day: selects[0], from: selects[1], to: selects[2], mode: selects[3] } }
  const values = (select: HTMLSelectElement) => [...select.options].map((option) => option.value).filter(Boolean)
  try {
    flushSync(() => root.render(<TransferFormPanel trip={trip} activities={fixture} transfer={null} initialDate={trip.startDate} trigger={trigger} persist={persist} onClose={() => {}} />))
    let { day, from, to } = fields()
    assert([...day.options].map((option) => option.value).join() === '2026-12-31,2027-01-01', 'Journées non triées.')
    assert(values(from).join() === 'Tôt,Tard,Sans horaire,Période' && from.options[1].textContent?.includes('08:00') && !from.options[3].textContent?.includes('09:00'), 'Options/horaires non conformes au Programme.')
    from.focus(); assert(document.activeElement === from && from.closest('label')?.textContent?.includes('Activité de départ'), 'Sélecteur de départ non accessible.')
    change(from, early.id)
    assert(!values(to).includes(early.id), 'Départ non exclu des arrivées.')
    change(to, late.id)
    assert(!values(from).includes(late.id) && from.value === early.id, 'Arrivée non exclue des départs ou sélection valide perdue.')
    const inputs = host.querySelectorAll<HTMLInputElement>('input'); change(inputs[0], '15,5'); change(inputs[1], '4')
    change(to, period.id)
    assert(from.value === early.id && values(from).includes(late.id) && !values(from).includes(period.id), 'Changement d’arrivée ne libère pas l’ancienne option.')
    change(from, late.id)
    assert(to.value === period.id && values(to).includes(early.id) && !values(to).includes(late.id), 'Exclusion réciproque non immédiate.')
    assert(inputs[0].value === '15,5' && inputs[1].value === '4', 'Changement de sélection a effacé les autres saisies.')
    flushSync(() => root.render(<TransferFormPanel trip={trip} activities={[...fixture].reverse()} transfer={null} initialDate={trip.startDate} trigger={trigger} persist={persist} onClose={() => {}} />))
    assert(fields().from.value === late.id && fields().to.value === period.id && host.querySelector<HTMLInputElement>('input')!.value === '15,5', 'Actualisation de la liste a effacé les sélections ou la saisie.')
    flushSync(() => host.querySelector('form')!.requestSubmit())
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert(calls === 1 && saved?.fromActivityId === late.id && saved.toActivityId === period.id && saved.durationMinutes === 15.5, 'Création depuis sélecteurs filtrés incorrecte.')
    flushSync(() => root.render(<TransferFormPanel key="edit" trip={trip} activities={fixture} transfer={existing} initialDate={trip.startDate} trigger={trigger} persist={persist} onClose={() => {}} />))
    ;({ from, to } = fields())
    assert(from.value === early.id && to.value === late.id && !values(from).includes(late.id) && !values(to).includes(early.id), 'Édition préremplie altérée par le filtrage.')
    change(from, period.id)
    assert(to.value === late.id && host.querySelector('textarea')!.value === existing.notes, 'Modification du départ a effacé arrivée/notes.')
    flushSync(() => host.querySelector('form')!.requestSubmit())
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert(savedId === existing.id && savedVersion === transferKey(existing) && saved?.toActivityId === late.id && saved.notes === existing.notes && saved.estimatedCost === 0 && saved.currency === 'JPY', 'Édition a perdu identité, version ou données.')
    flushSync(() => root.render(<TransferFormPanel key="one" trip={trip} activities={[early]} transfer={null} initialDate={trip.startDate} trigger={trigger} persist={persist} onClose={() => {}} />))
    ;({ from, to } = fields())
    change(from, early.id)
    assert(values(to).length === 0 && to.selectedOptions[0].textContent?.includes('Aucune autre activité') && host.textContent?.includes('au moins deux activités'), 'État sans autre activité incompréhensible.')
    assert(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, 'Enregistrement possible avec une seule activité.')
    let rejected = false
    try { validateTransferInput({ ...existing, toActivityId: existing.fromActivityId }) } catch { rejected = true }
    assert(rejected, 'La validation métier ne refuse plus un trajet vers lui-même.')
    report('Formulaire déplacements : tri dates/heures stable, sans horaire, heures lisibles, exclusion réciproque, valeurs préservées, création/édition et cas à une activité (sans données utilisateur).')
  } finally { flushSync(() => root.unmount()); host.remove(); trigger.remove() }
}
