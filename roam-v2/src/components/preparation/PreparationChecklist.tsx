import { useRef, useState, type RefObject } from 'react'
import type { Trip } from '../../db/database'
import { createPreparationRepository, preparationRepository } from '../../db/preparation'
import { preparationCategories, preparationPriorities, preparationTemplates, preparationSummary, validatePreparationTasks, sortPreparationTasks, taskStatus, type PreparationTask, type TaskInput } from '../../preparation/tasks'
import { SharingDialog } from '../budget/ExpenseSharing'
import { formatDate } from '../program/dates'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import './preparation-checklist.css'

type Repository = ReturnType<typeof createPreparationRepository>
const reason = 'Un formulaire de préparatifs est en cours.'
function TaskEditor({ task, busy, error, save, close, fallback }: { task?: PreparationTask; busy: boolean; error: string; save: (input: TaskInput) => void; close: () => void; fallback: RefObject<HTMLButtonElement | null> }) {
  const [initial] = useState(() => ({ title: task?.title ?? '', category: task?.category ?? 'other', priority: task?.priority ?? 'normal', dueDate: task?.dueDate ?? '', notes: task?.notes ?? '' }))
  const [draft, setDraft] = useState(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  return <SharingDialog title={task ? 'Modifier le préparatif' : 'Ajouter un préparatif'} busy={busy} dirty={dirty} onClose={close} reloadReason={reason} fallbackFocusRef={fallback}>{(requestClose) => <form onSubmit={(event) => { event.preventDefault(); save({ ...draft, dueDate: draft.dueDate || undefined, notes: draft.notes || undefined }) }}>
    <fieldset className="preparation-fields" disabled={busy}><label>Tâche<input autoFocus required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Catégorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as TaskInput['category'] })}>{Object.entries(preparationCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Priorité<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskInput['priority'] })}>{Object.entries(preparationPriorities).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Date limite facultative<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
      <label>Notes facultatives<textarea rows={4} maxLength={5000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={requestClose}>Annuler</button><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le préparatif'}</button></footer>
  </form>}</SharingDialog>
}
export function PreparationChecklist({ trip, today, repository = preparationRepository }: { trip: Trip; today: string; repository?: Repository }) {
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'delete'; task?: PreparationTask } | null>(null)
  const [filter, setFilter] = useState<'all' | 'todo' | 'done' | 'overdue'>('all')
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const lock = useRef(false), addRef = useRef<HTMLButtonElement>(null)
  useReloadBlocker(busy, 'Enregistrement des préparatifs.')
  let tasks: PreparationTask[]
  try { tasks = validatePreparationTasks(trip.preparationTasks) } catch (caught) { return <section className="preparation-checklist"><h2>Préparatifs</h2><p role="alert">{caught instanceof Error ? caught.message : 'Liste de préparatifs illisible.'} Les données sont conservées.</p></section> }
  if (trip.archived || trip.deletedAt !== undefined) return null
  const summary = preparationSummary(tasks, today)
  const sorted = sortPreparationTasks(tasks).filter((task) => filter === 'all' || (filter === 'todo' ? !task.completed : taskStatus(task, today) === filter))
  async function perform(action: () => Promise<unknown>, success = 'Préparatifs enregistrés.') {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action(); setDialog(null); setMessage(success) }
    catch (caught) { setError(caught instanceof DOMException && caught.name === 'QuotaExceededError' ? 'Le stockage local est plein. Aucune modification enregistrée ; tes saisies sont conservées.' : caught instanceof Error ? caught.message : 'Impossible d’enregistrer les préparatifs. Aucune modification enregistrée ; tes saisies sont conservées.') }
    finally { lock.current = false; setBusy(false) }
  }
  function open(kind: 'edit' | 'delete', task?: PreparationTask) { setError(''); setDialog({ kind, task }) }
  const available = selectedTemplates.filter((id) => !tasks.some((task) => task.templateId === id))
  return <section className="preparation-checklist" aria-labelledby="preparation-title" aria-busy={busy}><h2 id="preparation-title">Préparatifs</h2>
    <p role="status">{summary.completed} / {summary.total} tâche(s) terminée(s){summary.overdue ? ` · ${summary.overdue} en retard` : ''}</p>
    {summary.total > 0 && <progress max={summary.total} value={summary.completed} aria-label={`${summary.completed} tâches terminées sur ${summary.total}`} />}
    {!tasks.length && <p>Aucun préparatif ajouté. Crée ta première tâche ou choisis un modèle ; rien n’est ajouté automatiquement.</p>}
    <details className="preparation-content"><summary>Ouvrir la checklist du voyage</summary>
      <div className="preparation-toolbar"><button ref={addRef} type="button" className="primary-button" disabled={busy} onClick={() => open('edit')}>Ajouter une tâche</button>
        <label>Afficher<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Toutes les tâches</option><option value="todo">À faire (retards inclus)</option><option value="overdue">En retard</option><option value="done">Terminées</option></select></label></div>
      <p className="budget-meta">Dans chaque catégorie : tâches à faire d’abord, échéance la plus proche puis priorité. Sans échéance en dernier. Retard après la date limite, selon la date locale de l’appareil.</p>
      {tasks.length > 0 && !sorted.length && <p>Aucune tâche ne correspond à ce filtre.</p>}
      {Object.entries(preparationCategories).map(([category, label]) => {
        const group = sorted.filter((task) => task.category === category)
        return group.length > 0 && <section key={category} className="preparation-category" aria-label={label}><h3>{label}</h3><ul>{group.map((task) => {
          const status = taskStatus(task, today)
          return <li key={task.id} className={`preparation-task is-${status}`} data-task-id={task.id}><label className="preparation-check"><input type="checkbox" checked={task.completed} disabled={busy} onChange={(event) => void perform(() => repository.setCompleted(trip.id, task.id, event.target.checked, JSON.stringify(task)))} /><strong>{task.title}</strong></label>
            <div className="preparation-task-meta"><span>{status === 'done' ? 'Terminée' : status === 'overdue' ? 'En retard' : 'À faire'}</span><span>Priorité {preparationPriorities[task.priority].toLowerCase()}</span>{task.dueDate && <time dateTime={task.dueDate}>Date limite : {formatDate(task.dueDate, { day: 'numeric', month: 'long', year: 'numeric' })}</time>}</div>
            {task.notes && <p className="preparation-notes">{task.notes}</p>}
            <div className="preparation-actions"><button type="button" className="secondary-button" disabled={busy} aria-label={`Modifier ${task.title}`} onClick={() => open('edit', task)}>Modifier</button><button type="button" className="secondary-button" disabled={busy} aria-label={`Supprimer ${task.title}`} onClick={() => open('delete', task)}>Supprimer</button></div>
          </li>
        })}</ul></section>
      })}
      <details className="preparation-templates"><summary>Modèles de tâches courantes</summary><p>Choisis les tâches à ajouter. Aucun document, réservation ou paiement n’est créé. Un modèle déjà présent n’est pas ajouté deux fois.</p>
        <fieldset disabled={busy}><legend>Modèles disponibles</legend>{preparationTemplates.map((template) => {
          const exists = tasks.some((task) => task.templateId === template.id)
          return <label key={template.id} className="preparation-check"><input type="checkbox" checked={!exists && selectedTemplates.includes(template.id)} disabled={exists} onChange={(event) => setSelectedTemplates((old) => event.target.checked ? [...old, template.id] : old.filter((id) => id !== template.id))} />{template.title} · {preparationCategories[template.category]}{exists ? ' (déjà ajouté)' : ''}</label>
        })}</fieldset>
        <button type="button" className="secondary-button" disabled={busy || !available.length} onClick={() => void perform(async () => { await repository.addTemplates(trip.id, available); setSelectedTemplates([]) })}>Ajouter les modèles sélectionnés</button>
      </details>
    </details>
    {busy && !dialog && <p role="status">Enregistrement des préparatifs…</p>}
    {message && <p role="status">{message}</p>}{error && !dialog && <p className="form-error" role="alert">{error}</p>}
    {dialog?.kind === 'edit' && <TaskEditor task={dialog.task} busy={busy} error={error} fallback={addRef} close={() => setDialog(null)} save={(input) => void perform(() => repository.save(trip.id, input, dialog.task?.id, dialog.task ? JSON.stringify(dialog.task) : undefined))} />}
    {dialog?.kind === 'delete' && dialog.task && <SharingDialog title={`Supprimer « ${dialog.task.title} » ?`} busy={busy} reloadReason={reason} fallbackFocusRef={addRef} returnFocusRef={addRef} onClose={() => setDialog(null)}>{() => <div className="sharing-confirm"><p>Cette tâche et ses notes seront supprimées de ce voyage. Les autres préparatifs seront conservés.</p>{error && <p role="alert">{error}</p>}<button type="button" className="secondary-button" disabled={busy} onClick={() => setDialog(null)}>Annuler</button><button type="button" className="primary-button" disabled={busy} onClick={() => void perform(() => repository.remove(trip.id, dialog.task!.id, JSON.stringify(dialog.task)))}>{busy ? 'Suppression…' : 'Confirmer la suppression'}</button></div>}</SharingDialog>}
  </section>
}
