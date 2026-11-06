import { getDocument } from '../../db/documents'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Trip } from '../../db/database'
import { readTripLibrary } from '../../db/tripLibrary'
import { localClock, tripProgress, type LocalClock } from '../dashboard/overviewModel'
import { travelDay, travelActivities } from './travelModel'
import { formatDate } from '../program/dates'
import { activityScheduleLabel, reservationLabels } from '../program/activityPresentation'
import { hasReservationInformation } from '../../reservations/library'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { DocumentViewer } from '../program/DocumentViewer'
import { tripReferenceCurrency } from '../../db/currency'
import { addressLink } from '../../practical/model'
import './travel-mode.css'
export type TravelDestination = 'program' | 'map' | 'library' | 'practical'
export function TravelMode({ trip, selectedDate, onDateChange, navigate, onClose, read = readTripLibrary, readDocument = getDocument, clock: suppliedClock }: {
  trip: Trip; selectedDate?: string; onDateChange: (date: string) => void; navigate: (destination: TravelDestination, date: string) => void; onClose: () => void; read?: typeof readTripLibrary; readDocument?: typeof getDocument; clock?: LocalClock
}) {
  const [clock, setClock] = useState(() => localClock(new Date()))
  useEffect(() => { if (suppliedClock) return; const update = () => { const next = localClock(new Date()); setClock((old) => old.date === next.date && old.time === next.time ? old : next) }; const timer = window.setInterval(update, 1000); window.addEventListener('focus', update); return () => { clearInterval(timer); window.removeEventListener('focus', update) } }, [suppliedClock])
  const now = suppliedClock ?? clock, { days, date } = travelDay(trip, selectedDate, now.date), progress = tripProgress(trip, now.date)
  const [attempt, retry] = useState(0), [panel, setPanel] = useState<{ kind: 'detail' | 'edit' | 'document'; id: string } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null), origin = useRef<HTMLButtonElement>(null), fallback = useRef<HTMLButtonElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const result = useLiveQuery(() => read(trip.id).then((snapshot) => ({ snapshot, error: '' }), () => ({ snapshot: null, error: 'Impossible de charger le mode voyage. Les données locales sont conservées.' })), [trip.id, read, attempt])
  const snapshot = result?.snapshot, planning = travelActivities(trip, snapshot?.activities ?? [], date ?? '', now)
  const activity = panel && panel.kind !== 'document' ? snapshot?.activities.find((item) => item.id === panel.id && item.tripId === trip.id) : undefined
  const document = panel?.kind === 'document' ? snapshot?.documents.find((item) => item.id === panel.id) : undefined
  if (panel && snapshot && !(panel.kind === 'document' ? document : activity)) setPanel(null)
  if (trip.archived || trip.deletedAt !== undefined) return null
  const index = date ? days.indexOf(date) : -1
  const label = (value: string) => formatDate(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return <section className="travel-mode" aria-labelledby="travel-title">
    <button type="button" className="back-button" onClick={onClose}>Retour au tableau de bord</button>
    <h2 id="travel-title" ref={heading} tabIndex={-1}>Mode voyage</h2>
    <p role="status">{progress.status === 'during' ? `Aujourd’hui : jour ${progress.day} sur ${progress.days}` : progress.status === 'before' ? 'Voyage à venir' : progress.status === 'after' ? 'Voyage terminé' : 'Dates du voyage à vérifier'}</p>
    <p className="activity-meta">Date et heure locales de cet appareil. Aucun fuseau de destination n’est enregistré ; adapte le fuseau de l’appareil pendant le séjour.</p>
    {date ? <><div className="travel-days"><button type="button" className="secondary-button" disabled={index <= 0} onClick={() => onDateChange(days[index - 1])} aria-label="Journée précédente">←</button><label>Journée consultée<select value={date} onChange={(event) => onDateChange(event.target.value)}>{days.map((day) => <option key={day} value={day}>{label(day)}</option>)}</select></label><button type="button" className="secondary-button" disabled={index >= days.length - 1} onClick={() => onDateChange(days[index + 1])} aria-label="Journée suivante">→</button></div>
      <nav className="travel-shortcuts" aria-label="Raccourcis du mode voyage">{([['program', 'Programme'], ['map', 'Carte'], ['library', 'Réservations'], ['practical', 'Infos pratiques']] as const).map(([target, title]) => <button ref={target === 'program' ? fallback : undefined} type="button" className="secondary-button" key={target} onClick={() => navigate(target, date)}>{title}</button>)}</nav>
      <h3>{label(date)}</h3>
      {!result ? <p role="status">Chargement des activités et documents…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer</button></div> : !planning.items.length ? <p className="travel-empty">Aucune activité pour cette journée. Le Programme permet de préparer la suite du séjour.</p> : <ol className="travel-activities">{planning.items.map((item) => {
        const documents = snapshot!.documents.filter((file) => file.activityId === item.id)
        let address: string | undefined
        try { if (item.address || item.location) address = addressLink(item.address || item.location!) } catch { /* Historical text remains readable. */ }
        return <li key={item.id} data-travel-activity={item.id} className={planning.nextId === item.id ? 'travel-next' : ''}>
          {planning.nextId === item.id && <p className="eyebrow">Prochaine activité à heure précise</p>}
          <h4>{item.title}</h4><p>{activityScheduleLabel(item)}</p>
          {(item.location || item.address) && <p className="travel-text">{item.location}{item.location && item.address ? ' · ' : ''}{item.address}</p>}
          {address && <a href={address} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ouvrir l’adresse</a>}
          {hasReservationInformation(item) && <div><p>Réservation : {item.reservationStatus ? reservationLabels[item.reservationStatus] : 'Statut non renseigné'}</p>{item.reservationReference && <p className="travel-text">Référence : {item.reservationReference}</p>}{item.reservationNotes && <p className="travel-text">{item.reservationNotes}</p>}</div>}
          <button type="button" className="secondary-button" onClick={(event) => { origin.current = event.currentTarget; setPanel({ kind: 'detail', id: item.id }) }}>Voir l’activité</button>
          {documents.length ? <ul className="travel-documents">{documents.map((file) => <li key={file.id}><button type="button" className="secondary-button" onClick={(event) => { origin.current = event.currentTarget; setPanel({ kind: 'document', id: file.id }) }}>Ouvrir / télécharger {file.name}</button></li>)}</ul> : <p className="activity-meta">Aucun document associé.</p>}
        </li>
      })}</ol>}
    </> : <p role="alert">Les dates du voyage ne permettent pas de consulter ses journées.</p>}
    {activity && panel?.kind === 'detail' && <ActivityDetailPanel trip={trip} activity={activity} returnFocusRef={origin} fallbackFocusRef={fallback} onClose={() => setPanel(null)} onEdit={() => setPanel({ kind: 'edit', id: activity.id })} closeLabel="Revenir au mode voyage" />}
    {activity && panel?.kind === 'edit' && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(trip)} activity={activity} initialDate={activity.date} fallbackDate={trip.startDate} fallbackFocusRef={origin} onClose={() => setPanel({ kind: 'detail', id: activity.id })} onSaved={() => setPanel({ kind: 'detail', id: activity.id })} />}
    {document && <DocumentViewer readDocument={readDocument} key={document.id} tripId={trip.id} activityId={document.activityId} document={document} fallbackFocusRef={origin} onClose={() => setPanel(null)} />}
  </section>
}
