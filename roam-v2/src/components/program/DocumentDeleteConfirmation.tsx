import { useEffect, useRef, useState, type RefObject } from 'react'
import { deleteDocument } from '../../db/documents'
import type { ActivityDocument } from '../../db/documentModel'

type Props = { tripId: string; activityId: string; document: ActivityDocument; fallbackFocusRef: RefObject<HTMLElement | null>; onClose: () => void; onDeleted: () => void }
export function DocumentDeleteConfirmation({ tripId, activityId, document, fallbackFocusRef, onClose, onDeleted }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const dialog = dialogRef.current!
    const previous = window.document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      else fallbackFocusRef.current?.focus()
    }
  }, [fallbackFocusRef])
  async function confirm() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await deleteDocument(tripId, activityId, document.id); onDeleted() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Impossible de supprimer ce document. Réessaie.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialogRef} className="modal-content confirmation-dialog" aria-labelledby="document-delete-title" aria-describedby="document-delete-description"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!lock.current) onClose() }} aria-busy={busy}>
    <h2 id="document-delete-title">Supprimer ce document ?</h2>
    <p id="document-delete-description">« {document.name} » sera supprimé définitivement de cet appareil. Cette opération est irréversible.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions">
      <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={() => { if (!lock.current) onClose() }}>Annuler</button>
      <button type="button" className="primary-button danger-button" disabled={busy} onClick={() => { void confirm() }}>{busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
    </div>
  </dialog>
}
