import { parseDate } from '../components/program/dates'
export const preparationCategories = { documents: 'Documents', luggage: 'Bagages', transport: 'Transport', reservations: 'Réservations', other: 'Autres' } as const
export const preparationPriorities = { high: 'Haute', normal: 'Normale', low: 'Basse' } as const
export type TaskCategory = keyof typeof preparationCategories
export type TaskPriority = keyof typeof preparationPriorities
export type TaskInput = { title: string; category: TaskCategory; priority: TaskPriority; dueDate?: string; notes?: string }
export type PreparationTask = TaskInput & { id: string; completed: boolean; createdAt: string; updatedAt: string; templateId?: string }
export const preparationTemplates = [
  { id: 'identity', title: 'Vérifier les pièces d’identité', category: 'documents' },
  { id: 'bags', title: 'Préparer les bagages', category: 'luggage' },
  { id: 'tickets', title: 'Vérifier les billets de transport', category: 'transport' },
  { id: 'bookings', title: 'Vérifier les réservations', category: 'reservations' },
  { id: 'home', title: 'Préparer la maison avant le départ', category: 'other' },
] as const
export const MAX_PREPARATION_TASKS = 500
export function normalizeTaskInput(value: TaskInput): TaskInput {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 200) throw new Error('Le titre doit comporter entre 1 et 200 caractères.')
  if (!Object.hasOwn(preparationCategories, value.category)) throw new Error('Catégorie de préparatif invalide.')
  if (!Object.hasOwn(preparationPriorities, value.priority)) throw new Error('Priorité invalide.')
  if (value.dueDate !== undefined && (typeof value.dueDate !== 'string' || !parseDate(value.dueDate))) throw new Error('La date limite doit être une date valide au format AAAA-MM-JJ.')
  if (value.notes !== undefined && (typeof value.notes !== 'string' || value.notes.length > 5000)) throw new Error('Les notes sont limitées à 5 000 caractères.')
  return { title: value.title.trim(), category: value.category, priority: value.priority,
    ...(value.dueDate !== undefined ? { dueDate: value.dueDate } : {}), ...(value.notes?.trim() ? { notes: value.notes.trim() } : {}) }
}
function timestamp(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Date de préparatif invalide.') }
export function validatePreparationTasks(value: unknown): PreparationTask[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PREPARATION_TASKS) throw new Error(`La liste est limitée à ${MAX_PREPARATION_TASKS} préparatifs.`)
  const seen = new Set<string>(), templates = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Préparatif invalide.')
    if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 512 || [...raw.id].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || seen.has(raw.id)) throw new Error('Identifiant de préparatif invalide ou dupliqué.')
    seen.add(raw.id)
    if (typeof raw.completed !== 'boolean') throw new Error('État de préparatif invalide.')
    timestamp(raw.createdAt); timestamp(raw.updatedAt)
    if (raw.templateId !== undefined) {
      if (typeof raw.templateId !== 'string' || !preparationTemplates.some((template) => template.id === raw.templateId) || templates.has(raw.templateId)) throw new Error('Modèle de préparatif invalide ou dupliqué.')
      templates.add(raw.templateId)
    }
    const fields = normalizeTaskInput(raw)
    if (fields.title !== raw.title || fields.notes !== raw.notes) throw new Error('Préparatif non normalisé.')
    return { ...fields, id: raw.id, completed: raw.completed, createdAt: raw.createdAt, updatedAt: raw.updatedAt, ...(raw.templateId !== undefined ? { templateId: raw.templateId } : {}) }
  })
}
export function taskStatus(task: PreparationTask, today: string): 'done' | 'overdue' | 'todo' {
  return task.completed ? 'done' : task.dueDate !== undefined && task.dueDate < today ? 'overdue' : 'todo'
}
export function preparationSummary(tasks: readonly PreparationTask[], today: string) {
  return { total: tasks.length, completed: tasks.filter((task) => task.completed).length, overdue: tasks.filter((task) => taskStatus(task, today) === 'overdue').length }
}
export function sortPreparationTasks(tasks: readonly PreparationTask[]) {
  const ranks = { high: 0, normal: 1, low: 2 }
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || ranks[a.priority] - ranks[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
