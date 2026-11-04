import { useEffect, useRef, useState } from 'react'
import { prepareRestore, previewRestore, restoreBackup, type PreparedRestore, type RestorePreview } from '../../backup/restoreBackup'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { RESTORE_LIMITS } from '../../backup/readZip'

export function BackupRestore() {
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [filename, setFilename] = useState('')
  useReloadBlocker(busy || prepared !== null, 'Termine la restauration ou efface sa sélection avant la mise à jour.')
  const lock = useRef(false)
  const alive = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  function message(caught: unknown) {
    return caught instanceof Error && caught.name === 'Error' ? caught.message
      : 'Impossible de vérifier ou de restaurer cette sauvegarde. Aucun import partiel ; vérifie le fichier et l’espace de stockage.'
  }
  async function select(file: File) {
    if (lock.current) return
    lock.current = true
    setBusy(true); setError(''); setPrepared(null); setPreview(null); setConfirmed(false)
    setFilename(file.name); setProgress('Vérification de la sauvegarde, sans écriture…')
    try {
      const checked = await prepareRestore(file, (text) => { if (alive.current) setProgress(text) })
      const next = await previewRestore(checked)
      if (!alive.current) return
      setPrepared(checked); setPreview(next); setProgress('Archive intégralement vérifiée. Aucune donnée importée pour le moment.')
      requestAnimationFrame(() => headingRef.current?.focus())
    } catch (caught) { if (alive.current) { setError(message(caught)); setProgress('') } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function refresh() {
    if (!prepared || lock.current) return
    lock.current = true; setBusy(true); setConfirmed(false); setError(''); setProgress('Actualisation de l’aperçu, sans écriture…')
    try {
      const next = await previewRestore(prepared)
      if (alive.current) { setPreview(next); setProgress('Aperçu actualisé. Confirme les voyages à importer.') }
    } catch (caught) { if (alive.current) { setError(message(caught)); setPreview(null) } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function commit() {
    if (!prepared || !preview || !confirmed || lock.current) return
    lock.current = true; setBusy(true); setError(''); setProgress('Import transactionnel en cours…')
    try {
      const result = await restoreBackup(prepared, preview)
      if (!alive.current) return
      setProgress(`Restauration terminée : ${result.importedTrips} voyage(s), ${result.activities} activité(s), ${result.documents} document(s) importé(s). ${result.skippedTrips} voyage(s) déjà présent(s) ignoré(s). ${result.metadata} métadonnée(s) ajoutée(s), ${result.skippedMetadata} clé(s) locale(s) conservée(s).`)
      setPrepared(null); setPreview(null); setConfirmed(false)
    } catch (caught) {
      if (alive.current) { setError(message(caught)); setConfirmed(false); setPreview(null); setProgress('Aucune donnée n’a été importée. Actualise l’aperçu avant de réessayer.') }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="backup-restore" aria-labelledby="backup-restore-title" aria-busy={busy}>
    <h2 id="backup-restore-title">Restaurer une sauvegarde ZIP</h2>
    <p>Les voyages déjà présents seront ignorés avec toutes leurs activités et leurs documents. Aucune donnée locale ne sera remplacée.</p>
    <label>Choisir une sauvegarde Roam V2 (maximum {RESTORE_LIMITS.archiveBytes / (1024 * 1024)} Mio)
      <input ref={fileInputRef} type="file" accept=".zip,application/zip" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void select(file)
      }} />
    </label>
    {filename && <>
      <p className="activity-meta">Fichier : {filename}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => {
        setPrepared(null); setPreview(null); setConfirmed(false); setFilename(''); setProgress(''); setError('')
        fileInputRef.current?.focus()
      }}>Effacer la sélection</button>
    </>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {prepared && <button type="button" className="secondary-button" disabled={busy} onClick={() => { void refresh() }}>Actualiser l’aperçu et les conflits</button>}
    {preview && <div className="backup-restore-preview">
      <h3 ref={headingRef} tabIndex={-1}>Aperçu de la restauration</h3>
      <h4>Voyages à importer ({preview.importing.length})</h4>
      {preview.importing.length === 0 ? <p>Aucun nouveau voyage à importer.</p> : <ul>{preview.importing.map((trip) => <li key={trip.id}>{trip.destination} — {trip.state === 'trash' ? 'Corbeille' : trip.state === 'archived' ? 'Archivé' : 'Actif'}</li>)}</ul>}
      <h4>Voyages ignorés ({preview.skipped.length})</h4>
      {preview.skipped.length === 0 ? <p>Aucun voyage déjà présent.</p> : <ul>{preview.skipped.map((trip) => <li key={trip.id}>{trip.destination}</li>)}</ul>}
      <p>{preview.activities} activité(s), {preview.documents} document(s) et {preview.metadata} métadonnée(s) à importer. {preview.skippedMetadata} clé(s) de métadonnées déjà présente(s) conservée(s).</p>
      <label className="backup-restore-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Je confirme l’import des données indiquées ci-dessus, sans remplacement des données locales.</label>
      <button type="button" className="primary-button" disabled={busy || !confirmed || (preview.importing.length === 0 && preview.metadata === 0)} onClick={() => { void commit() }}>Confirmer et restaurer</button>
    </div>}
  </section>
}
