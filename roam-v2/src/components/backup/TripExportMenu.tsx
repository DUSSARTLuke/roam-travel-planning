import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, MoreHorizontal, X } from 'lucide-react'
import { BackupExport, type ExportStatus } from './BackupExport'

type Props = { tripId: string; destination: string }
const statusLabels: Record<ExportStatus, string> = {
  idle: '', busy: 'Export en cours', ready: 'ZIP prêt à télécharger', error: 'Erreur d’export',
}

export function TripExportMenu({ tripId, destination }: Props) {
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const menuId = useId()
  const titleId = useId()

  useEffect(() => {
    if (!menu) return
    itemRef.current?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setMenu(null)
    }
    function reposition() { setMenu(null) }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [menu])

  function toggleMenu() {
    if (menu) { setMenu(null); return }
    const rect = triggerRef.current!.getBoundingClientRect()
    setMenu({ top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 72)), left: Math.max(8, Math.min(rect.right - 240, window.innerWidth - 248)) })
  }
  function closeExport() {
    dialogRef.current?.close()
    triggerRef.current?.focus()
  }
  return <>
    <button ref={triggerRef} type="button" className={`trip-export-trigger card-edit export-${status}`}
      aria-label={`Autres actions pour ${destination}${statusLabels[status] ? ` — ${statusLabels[status]}` : ''}`}
      title={statusLabels[status] || 'Autres actions'} aria-haspopup="menu" aria-expanded={menu !== null} aria-controls={menuId}
      onClick={(event) => { event.stopPropagation(); toggleMenu() }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!menu) toggleMenu() } }}>
      <MoreHorizontal size={20} />
      {status !== 'idle' && <span className="trip-export-indicator" aria-hidden="true" />}
    </button>
    {menu && createPortal(<div ref={menuRef} id={menuId} role="menu" aria-label={`Actions pour ${destination}`}
      className="trip-export-menu" style={{ top: menu.top, left: menu.left }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenu(null) }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { triggerRef.current?.focus(); setMenu(null) }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); triggerRef.current?.focus() }
        if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); itemRef.current?.focus() }
      }}>
      <button ref={itemRef} type="button" role="menuitem" onClick={(event) => {
        event.stopPropagation()
        setMenu(null)
        dialogRef.current?.showModal()
      }}><Download size={17} /> Exporter le voyage</button>
    </div>, document.body)}
    <dialog ref={dialogRef} className="modal-content confirmation-dialog trip-export-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeExport() }}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeExport()
      }}>
      <header className="modal-header"><h2 id={titleId}>Exporter {destination}</h2>
        <button type="button" className="modal-close" aria-label="Fermer l’export" onClick={closeExport}><X size={20} /></button>
      </header>
      <BackupExport scope={{ mode: 'trip', tripId }} onStatusChange={setStatus} />
      <p className="activity-meta">Tu peux fermer cette fenêtre et retrouver l’export par le menu ··· de cette carte.</p>
    </dialog>
  </>
}
