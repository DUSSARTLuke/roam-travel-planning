import { useLiveQuery } from 'dexie-react-hooks'
import { listDocuments } from '../../db/documents'
import { documentSizeLabel, type DocumentMime } from '../../db/documentModel'

export type PendingDocument = { file: File; mime: DocumentMime }
type Props = {
  tripId: string
  activityId: string | null
  pending?: PendingDocument[]
  onSelect?: (files: File[], storedCount: number) => void
}

export function ActivityDocuments({ tripId, activityId, pending = [], onSelect }: Props) {
  const result = useLiveQuery(async () => {
    try { return { documents: activityId === null ? [] : await listDocuments(tripId, activityId), error: '' } }
    catch { return { documents: [], error: 'Impossible de charger les métadonnées des documents.' } }
  }, [tripId, activityId])
  const documents = result?.documents ?? []
  if (!onSelect && result && !result.error && documents.length === 0) return null
  const content = <>
    {result === undefined && <p role="status">Chargement des documents…</p>}
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
      </li>)}
      {pending.map(({ file, mime }, index) => <li key={`pending-${index}`}><strong>{file.name}</strong>
        <span>{mime} · {documentSizeLabel(file.size)} · En attente d’enregistrement</span>
      </li>)}
    </ul>
  </>
  return onSelect ? <details className="activity-extra"><summary>Documents</summary>{content}</details>
    : <section aria-labelledby="activity-detail-documents"><h3 id="activity-detail-documents">Documents</h3>{content}</section>
}
