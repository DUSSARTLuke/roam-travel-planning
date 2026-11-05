import { db, type RoamDatabase } from './database'
import { createId } from '../utils/createId'
import { withSensitiveOperation } from '../pwa/reloadSafety'
import { normalizeTaskInput, validatePreparationTasks, preparationTemplates, MAX_PREPARATION_TASKS, type TaskInput, type PreparationTask } from '../preparation/tasks'

// A copy is a new departure to prepare. Preserve text/notes/deadlines, reset checks.
export function copyPreparationTasks(value: unknown) {
  if (value === undefined) return {}
  const now = new Date().toISOString()
  return { preparationTasks: validatePreparationTasks(value).map((task) => ({ ...task, id: createId(), completed: false, createdAt: now, updatedAt: now })) }
}
export function createPreparationRepository(database: RoamDatabase = db) {
  async function change<T>(tripId: string, update: (tasks: PreparationTask[]) => { tasks: PreparationTask[]; result: T }) {
    return withSensitiveOperation('Enregistrement des préparatifs.', () => database.transaction('rw', database.trips, async () => {
      const trip = await database.trips.get(tripId)
      if (!trip || trip.archived || trip.deletedAt !== undefined) throw new Error('Ce voyage est inaccessible. Restaure-le avant de modifier ses préparatifs.')
      const next = update(validatePreparationTasks(trip.preparationTasks))
      await database.trips.update(tripId, { preparationTasks: validatePreparationTasks(next.tasks) })
      return next.result
    }))
  }
  function existing(tasks: PreparationTask[], id: string, expected: string) {
    const task = tasks.find((item) => item.id === id)
    if (!task || JSON.stringify(task) !== expected) throw new Error('Cette tâche a changé ou a été supprimée dans un autre onglet. Ferme puis rouvre sa modification ; ta saisie est conservée.')
    return task
  }
  return {
    async save(tripId: string, input: TaskInput, id?: string, expected?: string) {
      const fields = normalizeTaskInput(input)
      return change(tripId, (tasks) => {
        const old = id !== undefined ? existing(tasks, id, expected ?? '') : undefined
        if (!old && tasks.length >= MAX_PREPARATION_TASKS) throw new Error('La limite de 500 préparatifs est atteinte.')
        const now = new Date().toISOString(), task: PreparationTask = { ...old, ...fields, id: old?.id ?? createId(), completed: old?.completed ?? false, createdAt: old?.createdAt ?? now, updatedAt: now }
        // Clearing optional fields is explicit; spreading old must not resurrect them.
        delete task.dueDate; delete task.notes
        Object.assign(task, fields)
        const normalized = validatePreparationTasks([task])[0]
        return { tasks: old ? tasks.map((item) => item.id === id ? normalized : item) : [...tasks, normalized], result: normalized }
      })
    },
    async setCompleted(tripId: string, id: string, completed: boolean, expected: string) {
      if (typeof completed !== 'boolean') throw new Error('État de tâche invalide.')
      return change(tripId, (tasks) => { const old = existing(tasks, id, expected), task = { ...old, completed, updatedAt: new Date().toISOString() }; return { tasks: tasks.map((item) => item.id === id ? task : item), result: task } })
    },
    async remove(tripId: string, id: string, expected: string) {
      return change(tripId, (tasks) => { existing(tasks, id, expected); return { tasks: tasks.filter((task) => task.id !== id), result: undefined } })
    },
    async addTemplates(tripId: string, ids: readonly string[]) {
      if (!ids.length || ids.some((id) => !preparationTemplates.some((template) => template.id === id))) throw new Error('Choisis au moins un modèle valide.')
      return change(tripId, (tasks) => {
        const selected = new Set(ids), now = new Date().toISOString()
        const additions: PreparationTask[] = preparationTemplates.filter((template) => selected.has(template.id) && !tasks.some((task) => task.templateId === template.id)).map((template) => ({ id: createId(), templateId: template.id, title: template.title, category: template.category, priority: 'normal', completed: false, createdAt: now, updatedAt: now }))
        if (tasks.length + additions.length > MAX_PREPARATION_TASKS) throw new Error('La limite de 500 préparatifs serait dépassée.')
        return { tasks: [...tasks, ...additions], result: additions.length }
      })
    },
  }
}
export const preparationRepository = createPreparationRepository()
