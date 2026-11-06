import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Trip } from '../../db/database'
import { createPracticalRepository, practicalRepository } from '../../db/practical'
import { addressLink, emailLink, phoneLink, contactFieldErrors, practicalCategories, practicalKinds, buildPracticalEntries, searchPracticalEntries, practicalCopyText, type PracticalRecord, type PracticalInput, type PracticalCategory, type PracticalEntry } from '../../practical/model'
import { copyPracticalText } from '../../practical/clipboard'
import { SharingDialog } from '../budget/ExpenseSharing'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { ActivityDetailPanel } from '../program/ActivityDetailPanel'
import { ActivityFormPanel } from '../program/ActivityFormPanel'
import { tripReferenceCurrency } from '../../db/currency'
import './practical-notebook.css'

type Repository = ReturnType<typeof createPracticalRepository>
type Panel = { kind: 'edit'; record?: PracticalRecord } | { kind: 'delete'; record: PracticalRecord } | { kind: 'copy'; title: string; text: string } | { kind: 'activity' | 'activity-edit'; activityId: string }
const warning = 'Carnet et sauvegardes ZIP non chiffrés : évite les mots de passe, codes bancaires et autres secrets sensibles.'
const reloadReason = 'Un formulaire d’informations pratiques est en cours.'
function RecordEditor({ record, busy, error, fallback, onClose, save }: { record?: PracticalRecord; busy: boolean; error: string; fallback: RefObject<HTMLButtonElement | null>; onClose: () => void; save: (input: PracticalInput) => void }) {
  const [initial] = useState(() => ({ title: record?.title ?? '', category: record?.category ?? 'other', kind: record?.kind ?? 'contact', notes: record?.notes ?? '', phone: record?.kind === 'contact' ? record.phone ?? '' : '', email: record?.kind === 'contact' ? record.email ?? '' : '', address: record?.kind === 'address' ? record.address : '' }))
  const [draft, setDraft] = useState(initial)
  const [touched, setTouched] = useState({ phone: Boolean(record), email: Boolean(record) })
  const id = useId(), phoneRef = useRef<HTMLInputElement>(null), emailRef = useRef<HTMLInputElement>(null)
  const fieldErrors = draft.kind === 'contact' ? contactFieldErrors(draft.phone, draft.email) : {}
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  function submit() {
    if (draft.kind === 'contact') {
      setTouched({ phone: true, email: true })
      if (fieldErrors.phone || fieldErrors.email) { (fieldErrors.phone ? phoneRef : emailRef).current?.focus(); return }
    }
    const base = { title: draft.title, category: draft.category, notes: draft.notes || undefined }
    save(draft.kind === 'contact' ? { ...base, kind: 'contact', phone: draft.phone || undefined, email: draft.email || undefined } : draft.kind === 'address' ? { ...base, kind: 'address', address: draft.address } : { ...base, kind: 'note', notes: draft.notes })
  }
  return <SharingDialog title={record ? 'Modifier la fiche pratique' : 'Ajouter une information pratique'} busy={busy} dirty={dirty} onClose={onClose} reloadReason={reloadReason} fallbackFocusRef={fallback}>{(close) => <form noValidate onSubmit={(event) => { event.preventDefault(); submit() }}>
    <p className="practical-warning">{warning}</p>
    <fieldset className="practical-fields" disabled={busy}>
      {record ? <p>Type : {practicalKinds[record.kind]}. Pour changer de type, crée une nouvelle fiche.</p> : <label>Type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as PracticalInput['kind'] })}>{Object.entries(practicalKinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      <label>Nom ou titre<input autoFocus required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Catégorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as PracticalCategory })}>{Object.entries(practicalCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {draft.kind === 'contact' && <>
        <label>Téléphone facultatif<input ref={phoneRef} type="tel" autoComplete="tel" maxLength={80} value={draft.phone} aria-invalid={touched.phone && Boolean(fieldErrors.phone)} aria-describedby={touched.phone && fieldErrors.phone ? `${id}-phone-error` : undefined} onBlur={() => setTouched((old) => ({ ...old, phone: true }))} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
        {touched.phone && fieldErrors.phone && <p id={`${id}-phone-error`} role="alert" className="form-error">{fieldErrors.phone}</p>}
        <label>E-mail facultatif<input ref={emailRef} type="email" autoComplete="email" maxLength={254} value={draft.email} aria-invalid={touched.email && Boolean(fieldErrors.email)} aria-describedby={touched.email && fieldErrors.email ? `${id}-email-error` : undefined} onBlur={() => setTouched((old) => ({ ...old, email: true }))} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
        {touched.email && fieldErrors.email && <p id={`${id}-email-error`} role="alert" className="form-error">{fieldErrors.email}</p>}
        <p className="budget-meta">Ces deux champs sont facultatifs. Le format est vérifié, sans garantir que le numéro ou l’adresse existe.</p></>}
      {draft.kind === 'address' && <label>Adresse<textarea required rows={3} maxLength={1000} value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} /></label>}
      <label>{draft.kind === 'note' ? 'Contenu de la note' : 'Notes facultatives'}<textarea rows={4} required={draft.kind === 'note'} maxLength={5000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>Annuler</button><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer la fiche'}</button></footer>
  </form>}</SharingDialog>
}
function ManualCopy({ title, text, close, fallback }: { title: string; text: string; close: () => void; fallback: RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  return <SharingDialog title={`Copier ${title}`} busy={false} onClose={close} reloadReason={reloadReason} fallbackFocusRef={fallback}>{() => <div className="sharing-confirm"><p>La copie automatique n’est pas disponible. Sélectionne le texte puis utilise Copier, Ctrl+C ou un appui long.</p><label>Information à copier<textarea ref={ref} autoFocus readOnly rows={7} value={text} onFocus={(event) => event.currentTarget.select()} className="practical-copy-text" /></label><button type="button" className="secondary-button" onClick={() => { ref.current?.focus(); ref.current?.select() }}>Sélectionner le texte</button><button type="button" className="primary-button" onClick={close}>Fermer la copie manuelle</button></div>}</SharingDialog>
}
function ContactCoordinate({ kind, value }: { kind: 'phone' | 'email'; value?: string }) {
  if (!value?.trim()) return null
  let href: string | undefined, error = ''
  try { href = kind === 'phone' ? phoneLink(value) : emailLink(value) } catch (caught) { error = caught instanceof Error ? caught.message : 'Coordonnée à vérifier.' }
  return href ? <a href={href}>{kind === 'phone' ? 'Appeler' : 'Écrire à'} {value}</a> : <div><p className="practical-text">{value}</p><p className="form-error">{kind === 'phone' ? 'Téléphone' : 'E-mail'} à vérifier : {error} Valeur conservée ; modifie la fiche pour la corriger.</p></div>
}
function AddressAction({ address }: { address: string }) {
  let url: string | undefined
  try { url = addressLink(address) } catch { /* Text remains available even for an unsupported historical address. */ }
  return url ? <a className="practical-link" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ouvrir l’adresse · application ou nouvel onglet</a> : <p className="budget-meta">Adresse conservée. Copie le texte pour l’ouvrir dans l’application de ton choix.</p>
}
export function PracticalNotebook({ trip, onClose, backLabel = 'Retour au tableau de bord', repository = practicalRepository, copyText = copyPracticalText }: { trip: Trip; onClose: () => void; backLabel?: string; repository?: Repository; copyText?: typeof copyPracticalText }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState<PracticalCategory | 'all'>('all'), [attempt, retry] = useState(0)
  const [panel, setPanel] = useState<Panel | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const lock = useRef(false), fallback = useRef<HTMLButtonElement>(null), origin = useRef<HTMLButtonElement>(null)
  useReloadBlocker(busy, 'Enregistrement du carnet pratique.')
  const result = useLiveQuery(() => repository.read(trip.id).then((snapshot) => ({ id: trip.id, snapshot, error: '' }), () => ({ id: trip.id, snapshot: null, error: 'Impossible de charger le carnet pratique. Les données locales sont conservées.' })), [trip.id, repository, attempt])
  const snapshot = result?.id === trip.id ? result.snapshot : null
  const entries = useMemo(() => snapshot ? buildPracticalEntries(trip.id, snapshot.records, snapshot.activities) : [], [trip.id, snapshot])
  const visible = useMemo(() => searchPracticalEntries(entries, query, category), [entries, query, category])
  const sourceActivity = panel?.kind === 'activity' || panel?.kind === 'activity-edit' ? snapshot?.activities.find((activity) => activity.id === panel.activityId && activity.tripId === trip.id) : undefined
  if (panel && (panel.kind === 'activity' || panel.kind === 'activity-edit') && result?.id === trip.id && !sourceActivity) { setPanel(null); setMessage('Cette activité n’est plus accessible.') }
  if (trip.archived || trip.deletedAt !== undefined) return null
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action(); setPanel(null); setMessage('Carnet pratique enregistré.') }
    catch (caught) { setError(caught instanceof DOMException && caught.name === 'QuotaExceededError' ? 'Le stockage local est plein. Aucune modification enregistrée ; tes saisies sont conservées.' : caught instanceof Error ? caught.message : 'Impossible d’enregistrer. Les données et saisies sont conservées.') }
    finally { lock.current = false; setBusy(false) }
  }
  async function copy(entry: PracticalEntry) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    const text = practicalCopyText(entry)
    try {
      if (await copyText(text) === 'copied') setMessage('Information copiée dans le presse-papiers de cet appareil.')
      else setPanel({ kind: 'copy', title: entry.title, text })
    } catch { setPanel({ kind: 'copy', title: entry.title, text }) }
    finally { lock.current = false; setBusy(false) }
  }
  function open(next: Panel, trigger?: HTMLButtonElement) { if (trigger) origin.current = trigger; setError(''); setPanel(next) }
  return <section className="practical-notebook" aria-labelledby="practical-title" aria-busy={busy}>
    <button type="button" className="back-button" onClick={onClose}>{backLabel}</button><h2 id="practical-title" ref={heading} tabIndex={-1}>Infos pratiques</h2>
    <p>Contacts, adresses et notes propres à ce voyage, disponibles hors connexion.</p><p className="practical-warning">{warning}</p>
    <button ref={fallback} type="button" className="primary-button" disabled={busy || !snapshot} onClick={() => open({ kind: 'edit' })}>Ajouter une information</button>
    {!result || result.id !== trip.id ? <p role="status">Chargement du carnet…</p> : result.error ? <div role="alert"><p>{result.error}</p><button type="button" className="secondary-button" onClick={() => retry((value) => value + 1)}>Réessayer le carnet</button></div> : <>
      <div className="practical-filters"><label>Rechercher<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, téléphone, lieu, notes…" /></label><label>Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">Toutes les catégories</option>{Object.entries(practicalCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <p role="status">{visible.length} information(s) affichée(s).</p>
      <p className="budget-meta">Les lieux des activités sont réutilisés sans copie. Les mêmes textes d’adresse sont regroupés avec leurs sources. Les liens d’adresse ouvrent Google Maps, dans l’application ou le navigateur, uniquement après ton action ; sa carte peut nécessiter Internet.</p>
      {!entries.length ? <p className="practical-empty">Aucune information pratique pour ce voyage. Ajoute un contact, une adresse ou une note ; les lieux renseignés dans les activités apparaîtront aussi ici.</p> : !visible.length ? <p className="practical-empty">Aucune information ne correspond à cette recherche ou catégorie.</p> : <ul className="practical-list">{visible.map((entry) => <li key={entry.key} className="practical-card" data-practical-key={entry.key}><p className="eyebrow">{practicalKinds[entry.kind]} · {practicalCategories[entry.category]}</p><h3>{entry.title}</h3>
        {entry.record?.kind === 'contact' && <div className="practical-contact"><ContactCoordinate kind="phone" value={entry.record.phone} /><ContactCoordinate kind="email" value={entry.record.email} /></div>}
        {entry.address && <><p className="practical-text">{entry.address}</p><AddressAction address={entry.address} /></>}
        {entry.record?.notes && <p className="practical-text">{entry.record.notes}</p>}
        <div className="practical-actions"><button type="button" className="secondary-button" disabled={busy} onClick={(event) => { origin.current = event.currentTarget; void copy(entry) }}>Copier l’information</button>{entry.record && <><button type="button" className="secondary-button" disabled={busy} onClick={(event) => open({ kind: 'edit', record: entry.record }, event.currentTarget)}>Modifier</button><button type="button" className="secondary-button" disabled={busy} onClick={() => open({ kind: 'delete', record: entry.record! })}>Supprimer</button></>}</div>
        {entry.activities.length > 0 && <div className="practical-sources"><p>{entry.record ? 'Adresse également renseignée dans les activités :' : 'Depuis les activités — à modifier à la source :'}</p><ul>{entry.activities.map((activity) => <li key={activity.id}><button type="button" className="secondary-button" disabled={busy} onClick={(event) => open({ kind: 'activity', activityId: activity.id }, event.currentTarget)}>{activity.title}</button></li>)}</ul></div>}
      </li>)}</ul>}
    </>}
    {busy && !panel && <p role="status">Opération en cours…</p>}{message && <p role="status">{message}</p>}{error && !panel && <p role="alert" className="form-error">{error}</p>}
    {panel?.kind === 'edit' && <RecordEditor record={panel.record} busy={busy} error={error} fallback={fallback} onClose={() => setPanel(null)} save={(input) => void perform(() => repository.save(trip.id, input, panel.record?.id, panel.record ? JSON.stringify(panel.record) : undefined))} />}
    {panel?.kind === 'delete' && <SharingDialog title={`Supprimer « ${panel.record.title} » ?`} busy={busy} onClose={() => setPanel(null)} reloadReason={reloadReason} returnFocusRef={fallback}>{() => <div className="sharing-confirm"><p>Cette fiche manuelle sera supprimée de ce voyage. Les informations et adresses des activités seront conservées.</p>{error && <p role="alert">{error}</p>}<button type="button" className="secondary-button" disabled={busy} onClick={() => setPanel(null)}>Annuler</button><button type="button" className="primary-button" disabled={busy} onClick={() => void perform(() => repository.remove(trip.id, panel.record.id, JSON.stringify(panel.record)))}>{busy ? 'Suppression…' : 'Confirmer la suppression'}</button></div>}</SharingDialog>}
    {panel?.kind === 'copy' && <ManualCopy title={panel.title} text={panel.text} close={() => setPanel(null)} fallback={origin} />}
    {sourceActivity && panel?.kind === 'activity' && <ActivityDetailPanel trip={snapshot?.trip ?? trip} activity={sourceActivity} returnFocusRef={origin} fallbackFocusRef={fallback} onClose={() => setPanel(null)} onEdit={() => setPanel({ kind: 'activity-edit', activityId: sourceActivity.id })} closeLabel="Fermer la fiche et revenir aux infos pratiques" />}
    {sourceActivity && panel?.kind === 'activity-edit' && <ActivityFormPanel tripId={trip.id} referenceCurrency={tripReferenceCurrency(snapshot?.trip ?? trip)} activity={sourceActivity} initialDate={sourceActivity.date} fallbackDate={trip.startDate} fallbackFocusRef={origin} onClose={() => setPanel({ kind: 'activity', activityId: sourceActivity.id })} onSaved={() => setPanel({ kind: 'activity', activityId: sourceActivity.id })} />}
  </section>
}
