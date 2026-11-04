import { useEffect, useRef, useState } from 'react'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { Download } from 'lucide-react'
import { exportBackup, type BackupScope } from '../../backup/exportBackup'
import { BackupRestore } from './BackupRestore'
import './backup.css'

export type ExportStatus = 'idle' | 'busy' | 'ready' | 'error'
type Props = { scope: BackupScope; compact?: boolean; onStatusChange?: (status: ExportStatus) => void }
export function BackupExport({ scope, compact = false, onStatusChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState<{ url: string; filename: string } | null>(null)
  useReloadBlocker(busy || ready !== null, 'Un export est en cours ou reste à récupérer. Termine l’export avant la mise à jour.')
  const lock = useRef(false)
  const alive = useRef(false)
  const urlRef = useRef<string | null>(null)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [])
  async function start() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    onStatusChange?.('busy')
    setError('')
    setReady(null)
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    try {
      const result = await exportBackup(scope, (message) => { if (alive.current) setProgress(message) })
      if (!alive.current) return
      const url = URL.createObjectURL(result.blob)
      urlRef.current = url
      setReady({ url, filename: result.filename })
      setProgress('ZIP vérifié et prêt à télécharger.')
      onStatusChange?.('ready')
    } catch (caught) {
      if (alive.current) {
        setError(caught instanceof RangeError
          ? 'Mémoire insuffisante pour cette sauvegarde. Aucun ZIP produit ; essaie un export individuel.'
          : caught instanceof Error && caught.name === 'Error' ? caught.message
          : 'Impossible de lire les données ou de créer la sauvegarde. Aucun ZIP disponible ; réessaie.')
        setProgress('')
        onStatusChange?.('error')
      }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <div className={`backup-export ${compact ? 'backup-compact' : ''}`} aria-busy={busy} onClick={(event) => event.stopPropagation()}>
    <p className="backup-privacy">Le ZIP contient des informations personnelles et des documents. Il n’est pas chiffré : conserve-le dans un endroit sûr.</p>
    <button type="button" className={compact ? 'secondary-button' : 'primary-button'} disabled={busy} onClick={() => { void start() }}>
      <Download size={17} />{busy ? 'Export en cours…' : scope.mode === 'full' ? 'Créer une sauvegarde complète' : 'Exporter ce voyage'}
    </button>
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {ready && <>
      <a className="secondary-button backup-download" href={ready.url} download={ready.filename}>Télécharger le ZIP</a>
      <button type="button" className="secondary-button" onClick={() => {
        setReady(null); setProgress(''); onStatusChange?.('idle')
        if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
      }}>J’ai récupéré le ZIP — terminer l’export</button>
    </>}
  </div>
}

export function BackupPage({ tripId }: { tripId?: string }) {
  return <section className="backup-page">
    <p className="eyebrow">PRÉPARATIFS ET PLUS</p><h1>Sauvegardes locales</h1>
    <p className="subtitle">La sauvegarde complète inclut tous les voyages, y compris les archives et la corbeille, leurs activités et documents.</p>
    <BackupExport scope={{ mode: 'full' }} />
    {tripId && <><h2>Voyage sélectionné</h2><BackupExport key={tripId} scope={{ mode: 'trip', tripId }} /></>}
    <BackupRestore />
  </section>
}
