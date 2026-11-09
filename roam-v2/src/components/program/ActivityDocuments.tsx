import { useRef, useState } from 'react'
import { DocumentViewer } from './DocumentViewer'
import { DocumentDeleteConfirmation } from './DocumentDeleteConfirmation'
import { useLiveQuery } from 'dexie-react-hooks'
import { listDocuments } from '../../db/documents'
import { documentSizeLabel, type ActivityDocument, type DocumentMime } from '../../db/documentModel'

export type PendingDocument = { file: File; mime: DocumentMime }
type Props = {
  tripId: string
  activityId: string | null
  readDocuments?: typeof listDocuments
  pending?: PendingDocument[]
  onSelect?: (files: File[], storedCount: number) => void
}

export function ActivityDocuments({ tripId, activityId, pending = [], onSelect, readDocuments = listDocuments }: Props) {
  const [panel, setPanel] = useState<{ kind: 'view' | 'delete'; document: ActivityDocument } | null>(null)
  const [notice, setNotice] = useState('')
  const sectionRef = useRef<HTMLElement>(null)
  const result = useLiveQuery(async () => {
    try { return { documents: activityId === null ? [] : await readDocuments(tripId, activityId), error: '' } }
    catch { return { documents: [], error: 'Impossible de charger les métadonnées des documents.' } }
  }, [tripId, activityId, readDocuments])
  const documents = result?.documents ?? []
  if (panel && result && (result.error || !documents.some((document) => document.id === panel.document.id))) {
    setPanel(null)
    setNotice(result.error || 'Ce document n’est plus disponible.')
  }
  if (!onSelect && result && !result.error && documents.length === 0 && !notice) return null
  const content = <>
    {result === undefined && <p role="status">Chargement des documents…</p>}
    {notice && <p role="status">{notice}</p>}
    {result?.error && <p className="form-error" role="alert">{result.error}</p>}
    <p className="activity-meta">{documents.length + pending.length}/5 documents · 15 Mo maximum par fichier</p>
    {onSelect && <>
      <label>Importer des fichiers PDF, JPEG, PNG ou WebP
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple
          disabled={!result || !!result.error || documents.length + pending.length >= 5}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) onSelect(files, documents.length)
          }} />
      </label>
      <p className="activity-meta">Ajoutés lors de l’enregistrement. Si un fichier est invalide, toute la nouvelle sélection est refusée. Les sélections précédentes restent en attente.</p>
    </>}
    <ul className="activity-document-list">
      {documents.map((document) => <li key={document.id}><strong>{document.name}</strong>
        <span>{document.mime} · {documentSizeLabel(document.size)}</span>
        {!onSelect && <div className="document-actions">
          <button type="button" className="secondary-button" aria-haspopup="dialog" aria-label={`Consulter ${document.name}`}
            onClick={() => { setNotice(''); setPanel({ kind: 'view', document }) }}>Consulter</button>
          <button type="button" className="secondary-button danger-text" aria-haspopup="dialog" aria-label={`Supprimer ${document.name}`}
            onClick={() => { setNotice(''); setPanel({ kind: 'delete', document }) }}>Supprimer</button>
        </div>}
      </li>)}
      {pending.map(({ file, mime }, index) => <li key={`pending-${index}`}><strong>{file.name}</strong>
        <span>{mime} · {documentSizeLabel(file.size)} · En attente d’enregistrement</span>
      </li>)}
    </ul>
    {panel && activityId !== null && (panel.kind === 'view'
      ? <DocumentViewer key={panel.document.id} tripId={tripId} activityId={activityId} document={panel.document} fallbackFocusRef={sectionRef}
          onClose={() => setPanel(null)} />
      : <DocumentDeleteConfirmation tripId={tripId} activityId={activityId} document={panel.document} fallbackFocusRef={sectionRef}
          onClose={() => setPanel(null)} onDeleted={() => { setPanel(null); setNotice('Document supprimé.'); sectionRef.current?.focus() }} />)}
  </>
  return onSelect ? <details className="activity-extra"><summary>Documents</summary>{content}</details>
    : <section ref={sectionRef} tabIndex={-1} aria-labelledby="activity-detail-documents"><h3 id="activity-detail-documents">Documents</h3>{content}</section>
}
