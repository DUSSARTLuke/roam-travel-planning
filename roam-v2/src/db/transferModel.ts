import { isActivityDate, type TripActivity } from './activityModel'
import { validateCurrency } from './currency'

export const transferModes = {
  walk: 'À pied', bicycle: 'Vélo', bus: 'Bus', metro: 'Métro', tram: 'Tramway',
  train: 'Train', car: 'Voiture', taxi: 'Taxi / VTC', plane: 'Avion', boat: 'Bateau', other: 'Autre',
} as const
export type TransferMode = keyof typeof transferModes
export type TransferInput = {
  fromActivityId: string; toActivityId: string; mode: TransferMode
  durationMinutes?: number; paidAmount?: number; estimatedCost?: number; currency: string; notes?: string
}
export type ManualTransfer = TransferInput & { id: string; createdAt: string; updatedAt: string }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Déplacement invalide.')
  return value as Record<string, unknown>
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('Identifiant du déplacement ou de l’activité invalide.')
}
export function validateTransferInput(value: unknown): TransferInput {
  const input = object(value)
  identity(input.fromActivityId); identity(input.toActivityId)
  if (input.fromActivityId === input.toActivityId) throw new Error('Choisis deux activités différentes.')
  if (typeof input.mode !== 'string' || !Object.hasOwn(transferModes, input.mode)) throw new Error('Mode de déplacement invalide.')
  for (const key of ['durationMinutes', 'estimatedCost', 'paidAmount'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0)) {
      throw new Error(key === 'durationMinutes' ? 'La durée doit être un nombre positif ou nul de minutes.' : key === 'paidAmount' ? 'Le montant payé doit être positif ou nul et fini.' : 'Le coût doit être un montant positif ou nul.')
    }
  }
  if (input.notes !== undefined && typeof input.notes !== 'string') throw new Error('Notes de déplacement invalides.')
  return { fromActivityId: input.fromActivityId, toActivityId: input.toActivityId, mode: input.mode as TransferMode,
    currency: validateCurrency(input.currency),
    ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes as number } : {}),
    ...(input.paidAmount !== undefined ? { paidAmount: input.paidAmount as number } : {}),
    ...(input.estimatedCost !== undefined ? { estimatedCost: input.estimatedCost as number } : {}),
    ...(typeof input.notes === 'string' && input.notes.trim() ? { notes: input.notes.trim() } : {}) }
}
export function validateTransfer(value: unknown): ManualTransfer {
  const row = object(value)
  identity(row.id)
  for (const key of ['createdAt', 'updatedAt']) {
    const date = row[key]
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(date) || !isActivityDate(date.slice(0, 10)) || !Number.isFinite(Date.parse(date))) throw new Error('Date du déplacement invalide.')
  }
  return { ...validateTransferInput(row), id: row.id, createdAt: row.createdAt as string, updatedAt: row.updatedAt as string }
}
// Date drift is allowed on disk: retain the link and show a correction warning.
// Missing/cross-trip endpoints are never accepted in persisted backups.
export function validateTripTransfers(value: unknown, tripId: string, activities: ReadonlyMap<string, TripActivity>): ManualTransfer[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Liste de déplacements invalide ou excessive.')
  const ids = new Set<string>()
  return value.map((row) => {
    const transfer = validateTransfer(row)
    if (ids.has(transfer.id)) throw new Error('Identifiant de déplacement dupliqué.')
    ids.add(transfer.id)
    const from = activities.get(transfer.fromActivityId); const to = activities.get(transfer.toActivityId)
    if (!from || !to || from.tripId !== tripId || to.tripId !== tripId) throw new Error('Un déplacement référence une activité absente ou un autre voyage.')
    return transfer
  })
}
export function transferKey(transfer: ManualTransfer): string { return JSON.stringify(transfer) }
