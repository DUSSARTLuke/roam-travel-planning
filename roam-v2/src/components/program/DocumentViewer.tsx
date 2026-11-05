import { useEffect, useRef, useState, type RefObject } from 'react'
import { getDocument } from '../../db/documents'
import { NativePdfPreview } from './NativePdfPreview'
import type { ActivityDocument } from '../../db/documentModel'

type Props = { tripId: string; activityId: string; document: ActivityDocument; fallbackFocusRef: RefObject<HTMLElement | null>; onClose: () => void; readDocument?: typeof getDocument }

export function DocumentViewer({ tripId, activityId, document, fallbackFocusRef, onClose, readDocument = getDocument }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [resource, setResource] = useState<{ url: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  const [zoom, setZoom] = useState(1)
  const downloading = useRef(false)
  const backdrop = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current!
    const previous = window.document.activeElement, fallback = fallbackFocusRef.current, overflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => {
      dialog.close()
      window.document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
      else fallback?.focus({ preventScroll: true })
    }
  }, [fallbackFocusRef])

  useEffect(() => {
    let active = true
    let url: string | null = null
    readDocument(tripId, activityId, document.id).then((stored) => {
      if (!active) return
      url = URL.createObjectURL(stored.blob)
      setResource({ url, name: stored.metadata.name })
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error && caught.name === 'Error' ? caught.message : 'Impossible de lire ce document dans le stockage local.')
    })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [tripId, activityId, document.id, readDocument])

  function download() {
    if (!resource || downloading.current) return
    downloading.current = true
    try {
      const link = window.document.createElement('a')
      link.href = resource.url
      link.download = resource.name
      window.document.body.append(link)
      link.click()
      link.remove()
    } catch {
      setError('Le téléchargement n’a pas pu démarrer. Réessaie ou vérifie les autorisations du navigateur.')
    } finally {
      // The same Blob URL remains valid until the viewer closes.
      setTimeout(() => { downloading.current = false }, 600)
    }
  }

  const pdf = document.mime === 'application/pdf'
  return (
    <dialog ref={dialogRef} className="document-viewer" aria-labelledby="document-viewer-title"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        backdrop.current = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
      }}
      onClick={(event) => { if (event.target === event.currentTarget && backdrop.current) onClose(); backdrop.current = false }}>
      <header className="document-viewer-header">
        <div><h2 id="document-viewer-title">{document.name}</h2><p className="activity-meta">{document.mime}</p></div>
        <button type="button" className="secondary-button" autoFocus onClick={onClose}>Fermer</button>
      </header>
      {!resource && !error && <p role="status">Chargement du document…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {resource && <>
        <div className="document-viewer-toolbar">
          <button type="button" className="secondary-button" onClick={download}>Télécharger</button>
          {!pdf && !imageFailed && <>
            <button type="button" className="secondary-button" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))} aria-label="Réduire l’image">−</button>
            <output aria-live="polite">{zoom * 100} %</output>
            <button type="button" className="secondary-button" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))} aria-label="Agrandir l’image">+</button>
          </>}
        </div>
        {pdf ? <NativePdfPreview url={resource.url} name={document.name} pdfViewerEnabled={navigator.pdfViewerEnabled} /> : imageFailed ? <p role="alert">Cette image ne peut pas être affichée. Tu peux télécharger le fichier.</p>
          : <div className="document-image-scroll" tabIndex={0} aria-label="Image, zone de défilement"><img src={resource.url} alt={document.name}
              style={{ width: `${zoom * 100}%`, height: zoom === 1 ? '100%' : 'auto', objectFit: 'contain', imageRendering: zoom > 1 ? 'pixelated' : 'auto' }} onError={() => setImageFailed(true)} /></div>}
      </>}
    </dialog>
  )
}
