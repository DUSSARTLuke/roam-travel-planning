import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Trip } from '../../db/database'
import { readTripLibrary } from '../../db/tripLibrary'
import { getDocument } from '../../db/documents'
import type { ActivityDocument } from '../../db/documentModel'
import { documentSizeLabel } from '../../db/documentModel'
import { tripReferenceCurrency } from '../../db/currency'
import { buildTripLibrary, filterTripLibrary, initialLibraryFilters, type LibraryFilters } from '../../reservations/library'
import { reservationLabels, reservationTypeLabels, activityScheduleLabel } from '../program/activityPresentation'
import { formatDate } from '../program/dates'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { DocumentViewer } from '../program/DocumentViewer'
import './trip-library.css'

type Panel = { kind: 'activity' | 'edit'; activityId: string; returnToActivity?: boolean } | { kind: 'document'; document: ActivityDocument }
export function TripLibrary({ trip, onClose, readLibrary = readTripLibrary, readDocument = getDocument }: {
  trip: Trip; onClose: () => void; readLibrary?: typeof readTripLibrary; readDocument?: typeof getDocument
}) {
  const [filters, setFilters] = useState(initialLibraryFilters), [attempt, retry] = useState(0), [panel, setPanel] = useState<Panel | null>(null), [notice, setNotice] = useState('')
  const fallback = useRef<HTMLButtonElement>(null), origin = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const result = useLiveQuery(() => readLibrary(trip.id).then((snapshot) => ({ tripId: trip.id, snapshot, error: '' }), () => ({ tripId: trip.id, snapshot: null, error: 'Impossible de charger les réservations et documents. Les données locales sont conservées.' })), [trip.id, readLibrary, attempt])
  const snapshot = result?.tripId === trip.id ? result.snapshot : null
  const entries = useMemo(() => snapshot ? buildTripLibrary(trip.id, snapshot.activities, snapshot.documents) : [], [trip.id, snapshot])
  const visible = useMemo(() => filterTripLibrary(entries, filters), [entries, filters])
  const ready = result?.tripId === trip.id && snapshot !== null
  const selectedActivity = panel && panel.kind !== 'document' ? snapshot?.activities.find((activity) => activity.id === panel.activityId && activity.tripId === trip.id) : undefined
  const selectedDocument = panel?.kind === 'document' ? snapshot?.documents.find((document) => document.id === panel.document.id && document.activityId === panel.document.activityId) : undefined
  if (panel && result?.tripId === trip.id && (!ready || (panel.kind === 'document' ? !selectedDocument : !selectedActivity))) {
    setPanel(null); setNotice('Cet élément n’est plus disponible. Ses données ont changé ou ont été supprimées.')
  }
  if (trip.archived || trip.deletedAt !== undefined) return null
  function change<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) { setFilters({ ...filters, [key]: value }) }
  function open(next: Panel, trigger: HTMLButtonElement) { origin.current = trigger; setNotice(''); setPanel(next) }
  const date = (value: string) => formatDate(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return <section className="trip-library" aria-labelledby="trip-library-title">
    <button type="button" className="back-button" onClick={onClose}>Retour au tableau de bord</button>
    <h2 id="trip-library-title" ref={heading} tabIndex={-1}>Réservations et documents</h2>
    <p>Les informations et pièces jointes de tes activités, réunies ici sans créer de copies.</p>
    {!result || result.tripId !== trip.id ? <p role="status">Chargement des réservations et documents…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer cet espace</button></div> : <>
      <div className="library-filters"><label>Rechercher<input type="search" value={filters.query} placeholder="Lieu, référence, fichier…" onChange={(event) => change('query', event.target.value)} /></label>
        <label>Type<select value={filters.type} onChange={(event) => change('type', event.target.value as LibraryFilters['type'])}><option value="all">Tous les types</option>{Object.entries(reservationTypeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Statut<select value={filters.status} onChange={(event) => change('status', event.target.value as LibraryFilters['status'])}><option value="all">Tous les statuts</option><option value="unknown">Non renseigné</option>{Object.entries(reservationLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Documents<select value={filters.documents} onChange={(event) => change('documents', event.target.value as LibraryFilters['documents'])}><option value="all">Avec ou sans document</option><option value="with">Avec documents</option><option value="without">Sans document</option></select></label>
      </div>
      <button ref={fallback} type="button" className="secondary-button" onClick={() => setFilters(initialLibraryFilters)}>Réinitialiser la recherche et les filtres</button>
      <p role="status">{visible.length} activité(s) affichée(s) · {visible.reduce((sum, entry) => sum + entry.documents.length, 0)} document(s) associé(s).</p>
      <p className="activity-meta">Un document n’implique pas une réservation confirmée. Le type suit le classement renseigné, sinon la catégorie de l’activité. Tu peux notamment choisir Hébergement dans sa section Réservation.</p>
      {!entries.length ? <p className="library-empty">Aucune réservation renseignée ni pièce jointe pour ce voyage. Ajoute-les depuis les activités du Programme.</p> : !visible.length ? <p className="library-empty">Aucun résultat ne correspond à cette recherche ou à ces filtres.</p> : Object.entries(reservationTypeLabels).map(([type, label]) => {
        const group = visible.filter((entry) => entry.type === type)
        return group.length > 0 && <section key={type} className="library-group" aria-label={label}><h3>{label} ({group.length})</h3><ul className="library-entries">{group.map(({ activity, documents, reservation }) => <li key={activity.id} className="library-entry" data-library-activity={activity.id}>
          <h4>{activity.title}</h4><p>{activity.date === null ? 'Idée à planifier · sans date' : <time dateTime={activity.date}>{date(activity.date)}</time>} · {activityScheduleLabel(activity)}</p>
          <p>Statut : {activity.reservationStatus ? reservationLabels[activity.reservationStatus] : 'Non renseigné'}{!reservation ? ' · Documents de l’activité, sans réservation renseignée' : ''}</p>
          {(activity.location || activity.address) && <p>{activity.location}{activity.location && activity.address ? ' · ' : ''}{activity.address}</p>}
          <dl>{activity.reservationProvider && <div><dt>Prestataire</dt><dd>{activity.reservationProvider}</dd></div>}{activity.reservationReference && <div><dt>Référence</dt><dd>{activity.reservationReference}</dd></div>}{activity.reservationPeople !== undefined && <div><dt>Personnes</dt><dd>{activity.reservationPeople}</dd></div>}{activity.reservationDeadline && <div><dt>Date limite de réservation</dt><dd><time dateTime={activity.reservationDeadline}>{date(activity.reservationDeadline)}</time></dd></div>}</dl>
          {activity.reservationNotes && <p className="library-notes"><strong>Notes de réservation : </strong>{activity.reservationNotes}</p>}{activity.notes && <p className="library-notes"><strong>Notes de l’activité : </strong>{activity.notes}</p>}
          <div className="library-actions"><button type="button" className="secondary-button" onClick={(event) => open({ kind: 'activity', activityId: activity.id }, event.currentTarget)}>Voir l’activité d’origine</button><button type="button" className="secondary-button" onClick={(event) => open({ kind: 'edit', activityId: activity.id }, event.currentTarget)}>Modifier à la source</button></div>
          {!documents.length ? <p className="activity-meta">Aucun document associé à cette activité.</p> : <ul className="library-documents">{documents.map((document) => <li key={document.id}><div><strong>{document.name}</strong><p className="activity-meta">{document.mime} · {documentSizeLabel(document.size)}</p></div><button type="button" className="secondary-button" aria-label={`Ouvrir ou télécharger ${document.name}`} onClick={(event) => open({ kind: 'document', document }, event.currentTarget)}>Ouvrir / télécharger</button></li>)}</ul>}
        </li>)}</ul></section>
      })}
    </>}
    {notice && <p role="status">{notice}</p>}
    {ready && selectedDocument && <DocumentViewer key={`${trip.id}:${selectedDocument.id}`} tripId={trip.id} activityId={selectedDocument.activityId} document={selectedDocument} readDocument={readDocument} fallbackFocusRef={fallback} onClose={() => setPanel(null)} />}
    {ready && selectedActivity && panel?.kind === 'activity' && <ActivityDetailPanel trip={trip} activity={selectedActivity} returnFocusRef={origin} fallbackFocusRef={fallback} onClose={() => setPanel(null)} onEdit={() => setPanel({ kind: 'edit', activityId: selectedActivity.id, returnToActivity: true })} closeLabel="Fermer la fiche et revenir aux réservations et documents" />}
    {ready && selectedActivity && panel?.kind === 'edit' && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(trip)} activity={selectedActivity} initialDate={selectedActivity.date} fallbackDate={trip.startDate} fallbackFocusRef={origin} onClose={() => setPanel(panel.returnToActivity ? { kind: 'activity', activityId: selectedActivity.id } : null)} onSaved={() => setPanel({ kind: 'activity', activityId: selectedActivity.id })} />}
  </section>
}
