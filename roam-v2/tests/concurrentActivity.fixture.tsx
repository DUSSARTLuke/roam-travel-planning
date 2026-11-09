import { useLiveQuery } from 'dexie-react-hooks'
import { useActivityEditSnapshot } from '../src/components/program/useActivityEditSnapshot'
import { createRef } from 'react'
import { flushSync } from 'react-dom'
import { ActivityFormPanel } from '../src/components/program/ActivityFormPanel'
import { createDocumentRepository } from '../src/db/documents'
import '../src/App.css'
import '../src/components/program/program.css'
import { createRoot } from 'react-dom/client'
import { RoamDatabase } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import type { TripActivity } from '../src/db/activityModel'
// Only temporary databases explicitly named by the isolated browser runner.
const name = new URL(location.href).searchParams.get('database') ?? ''
if (!/^roam-v2-test-concurrent-[0-9a-f-]{36}$/.test(name)) throw new Error('Base de test temporaire requise.')
const database = new RoamDatabase(name), repository = createActivityRepository(database)
let snapshot: TripActivity | undefined
const root = createRoot(document.getElementById('editor')!)
const documents = createDocumentRepository(database), fallback = createRef<HTMLButtonElement>()
let editorKey = 0, saved = 0
export function TestEditor({ initial }: { initial: TripActivity }) {
  const rows = useLiveQuery(() => repository.listActivities('trip'), [])
  const retained = useActivityEditSnapshot('trip', initial.id, rows === undefined ? initial : rows.find((row) => row.id === initial.id))
  return <><button ref={fallback}>Retour test</button>{retained && <ActivityFormPanel tripId="trip" referenceCurrency="EUR" initialDate={initial.date} fallbackDate="2026-12-31" activity={retained} fallbackFocusRef={fallback} readDocuments={documents.listDocuments} readActivity={repository.getActivity} persistActivity={documents.saveActivityWithDocuments} onClose={() => root.render(null)} onSaved={() => { saved++; root.render(null) }} />}</>
}
const api = {
  async seed() {
    await database.open()
    if (!await database.trips.get('trip')) await database.trips.add({ id: 'trip', destination: 'Test isolé', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' })
    if (!await database.activities.get('activity')) await database.activities.add({ id: 'activity', tripId: 'trip', title: 'Titre initial', category: 'visit', date: '2026-12-31', scheduleType: 'unscheduled', period: null, createdAt: '2026-11-09T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z' })
  },
  async open() { snapshot = await repository.getActivity('trip', 'activity'); return snapshot.title },
  async save(patch: Partial<TripActivity>) { try { await repository.updateActivity('trip', 'activity', { ...snapshot!, ...patch }); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
  async blindSave() { try { await repository.updateActivity('trip', 'activity', { title: 'Sans révision', category: 'visit', date: null, scheduleType: 'unscheduled', period: null }); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
  async state() { return { activity: await database.activities.get('activity'), operations: await database.syncOutbox.count(), documents: await database.activityDocuments.count(), groups: (await database.syncOutbox.toArray()).map((op) => op.groupId) } },
  async remove() { const activity = await repository.getActivity('trip', 'activity'); await repository.deleteActivity('trip', activity.id, JSON.stringify(activity)) },
  async openUI() {
    const activity = await repository.getActivity('trip', 'activity')
    flushSync(() => root.render(<TestEditor key={++editorKey} initial={activity} />))
  },
  field(field: 'title' | 'notes', value: string) {
    const element = field === 'title' ? document.querySelector<HTMLInputElement>('dialog input:not([type])')! : [...document.querySelectorAll('dialog label')].find((label) => label.firstChild?.textContent === 'Notes')!.querySelector<HTMLTextAreaElement>('textarea')!
    element.closest('details')?.setAttribute('open', '')
    flushSync(() => { Object.getOwnPropertyDescriptor(field === 'title' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
  },
  attach() {
    const input = document.querySelector<HTMLInputElement>('dialog input[type=file]')!, data = new DataTransfer()
    input.closest('details')?.setAttribute('open', '')
    data.items.add(new File(['%PDF-1.7\nTest PDF'], 'pending.pdf', { type: 'application/pdf' }))
    flushSync(() => { input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })) })
  },
  submit(double = false) { const button = document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!; flushSync(() => { button.click(); if (double) button.click() }) },
  reload() { flushSync(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Recharger les données récentes')!.click()) },
  editorState() { const title = document.querySelector<HTMLInputElement>('dialog input:not([type])'), notes = [...document.querySelectorAll('dialog label')].find((label) => label.firstChild?.textContent === 'Notes')?.querySelector<HTMLTextAreaElement>('textarea'); return { title: title?.value, notes: notes?.value, ready: Boolean(document.querySelector<HTMLButtonElement>('dialog button[type=submit]') && !document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.disabled), error: document.querySelector('.activity-panel-form > [role=alert]')?.textContent, recoveries: [...document.querySelectorAll<HTMLTextAreaElement>('textarea[readonly]')].map((input) => input.value), pending: document.body.textContent?.includes('pending.pdf'), saved } },
  async cleanup() { root.unmount(); database.close() },
}
Object.assign(window, { roamConcurrentTest: api })
document.getElementById('status')!.textContent = 'Prêt'
