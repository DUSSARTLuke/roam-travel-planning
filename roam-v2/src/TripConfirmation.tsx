import { useEffect, useRef } from 'react'
import type { Trip } from './db/database'

type Props = {
  trip: Trip
  permanent: boolean
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}

export function TripConfirmation({ trip, permanent, busy, error, onCancel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return (
    <dialog ref={dialogRef} className="modal-content confirmation-dialog"
      aria-labelledby="trash-confirm-title" aria-describedby="trash-confirm-description"
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
      <div className="modal-header">
        <h2 id="trash-confirm-title">{permanent ? 'Supprimer définitivement ce voyage ?' : 'Mettre ce voyage à la corbeille ?'}</h2>
      </div>
      <p id="trash-confirm-description">
        {permanent
          ? `« ${trip.destination} » sera supprimé définitivement. Cette opération est irréversible et toutes les données de ce voyage seront perdues.`
          : `« ${trip.destination} » sera déplacé dans la corbeille. Tu pourras le restaurer avec toutes ses informations.`}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>Annuler</button>
        <button type="button" className="primary-button danger-button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Enregistrement…' : permanent ? 'Supprimer définitivement' : 'Mettre à la corbeille'}
        </button>
      </div>
    </dialog>
  )
}
