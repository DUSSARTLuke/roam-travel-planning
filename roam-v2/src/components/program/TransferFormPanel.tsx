import { orderedTransferActivities } from './transferFormActivities'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { tripReferenceCurrency } from '../../db/currency'
import { saveTransfer, deleteTransfer } from '../../db/transfers'
import { transferKey, transferModes, type ManualTransfer, type TransferMode } from '../../db/transferModel'
import { CurrencySelector } from '../currency/CurrencySelector'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { formatDate } from './dates'

function decimal(value: string): number | undefined {
  if (!value.trim()) return undefined
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) throw new Error('Utilise un nombre positif ou nul, avec une virgule ou un point.')
  return Number(value.trim().replace(',', '.'))
}
type Props = { trip: Trip; activities: TripActivity[]; transfer: ManualTransfer | null; initialDate: string;
  trigger: HTMLButtonElement; fallbackFocusRef?: RefObject<HTMLButtonElement | null>; onClose: () => void
  persist?: typeof saveTransfer; remove?: typeof deleteTransfer }
export function TransferFormPanel({ trip, activities, transfer, initialDate, trigger, fallbackFocusRef, onClose, persist = saveTransfer, remove = deleteTransfer }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [initial] = useState(() => ({ date: activities.find((item) => item.id === transfer?.fromActivityId)?.date ?? initialDate,
    from: transfer?.fromActivityId ?? '', to: transfer?.toActivityId ?? '', mode: transfer?.mode ?? 'walk' as TransferMode,
    duration: transfer?.durationMinutes?.toString() ?? '', cost: transfer?.estimatedCost?.toString() ?? '',
    currency: transfer?.currency ?? tripReferenceCurrency(trip), notes: transfer?.notes ?? '' }))
  const [expected] = useState(() => transfer ? transferKey(transfer) : undefined)
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  useReloadBlocker(dirty || busy, 'Déplacement en cours de modification')
  useEffect(() => {
    const dialog = dialogRef.current!; const fallback = fallbackFocusRef?.current
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = overflow; (trigger.isConnected ? trigger : fallback)?.focus({ preventScroll: true }) }
  }, [trigger, fallbackFocusRef])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty])
  const orderedActivities = useMemo(() => orderedTransferActivities(activities, trip.id), [activities, trip.id])
  const days = [...new Set([initialDate, ...orderedActivities.map((item) => item.date!)])].sort()
  const candidates = orderedActivities.filter((item) => item.date === form.date)
  function close() { if (!lock.current) { if (confirmation) setConfirmation(null); else if (dirty) setConfirmation('discard'); else onClose() } }
  function resume() {
    setConfirmation(null)
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLSelectElement>('select')?.focus())
  }
  async function submit(deleting = false) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (deleting && transfer) await remove(trip.id, transfer.id, expected!)
      else await persist(trip.id, { fromActivityId: form.from, toActivityId: form.to, mode: form.mode, durationMinutes: decimal(form.duration),
        estimatedCost: decimal(form.cost), currency: form.currency, notes: form.notes }, transfer?.id, expected)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer le déplacement.'); setConfirmation(null) }
    finally { lock.current = false; setBusy(false) }
  }
  const endpoints = (field: 'from' | 'to', label: string) => {
    const opposite = form[field === 'from' ? 'to' : 'from']
    const options = candidates.filter((item) => item.id !== opposite)
    const value = form[field] === opposite ? '' : form[field]
    return <label>{label}<select required value={value} onChange={(event) => setForm({ ...form, [field]: event.target.value })}>
      <option value="">{options.length ? 'Choisir une activité' : 'Aucune autre activité disponible pour cette journée'}</option>
      {value && !candidates.some((item) => item.id === value) && <option value={value}>Activité hors de cette journée — à rechoisir</option>}
      {options.map((item) => <option key={item.id} value={item.id}>{item.title}{item.scheduleType === 'exact' && item.startTime ? ` · ${item.startTime}` : ''}</option>)}
    </select></label>
  }
  return <dialog ref={dialogRef} className="activity-panel transfer-panel" aria-labelledby="transfer-form-title" onCancel={(event) => { event.preventDefault(); close() }}
    onClick={(event) => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close() }}>
    <header className="activity-panel-header"><h2 id="transfer-form-title">{transfer ? 'Modifier le déplacement' : 'Ajouter un déplacement'}</h2><button type="button" className="secondary-button" disabled={busy} onClick={close}>Fermer</button></header>
    <form className="activity-panel-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <p className="activity-meta">Liaison manuelle entre deux activités du même jour. Aucun itinéraire ni durée n’est calculé.</p>
      <fieldset disabled={busy || confirmation !== null} inert={busy || confirmation !== null}>
        <label>Journée<select autoFocus value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value, from: '', to: '' })}>
          {days.map((day) => <option key={day} value={day}>{formatDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}</option>)}</select></label>
        {candidates.length < 2 && <p role="status">Ajoute ou déplace au moins deux activités dans cette journée pour les relier.</p>}
        {endpoints('from', 'Activité de départ')}{endpoints('to', 'Activité d’arrivée')}
        <label>Mode de déplacement<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as TransferMode })}>
          {Object.entries(transferModes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
        <label>Durée en minutes (facultative)<input type="text" inputMode="decimal" value={form.duration} onChange={(event) => setForm({ ...form, duration: event.target.value })} /></label>
        <label>Coût estimé (facultatif)<input type="text" inputMode="decimal" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></label>
        <CurrencySelector label="Devise du déplacement" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
        <label>Notes (facultatives)<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <button type="submit" className="primary-button" disabled={candidates.length < 2}>{busy ? 'Enregistrement…' : 'Enregistrer le déplacement'}</button>
        {transfer && <button type="button" className="secondary-button" onClick={() => setConfirmation('delete')}>Supprimer le déplacement</button>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {busy && <p role="status">Enregistrement…</p>}
      {confirmation && <div role="alert" className="transfer-confirmation"><p>{confirmation === 'delete' ? 'Supprimer définitivement ce déplacement ? Les deux activités seront conservées.' : 'Abandonner les modifications non enregistrées ?'}</p>
        <button autoFocus type="button" className="secondary-button" disabled={busy} onClick={resume}>Annuler</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => confirmation === 'delete' ? void submit(true) : onClose()}>{confirmation === 'delete' ? 'Confirmer la suppression' : 'Abandonner'}</button>
      </div>}
    </form>
  </dialog>
}
