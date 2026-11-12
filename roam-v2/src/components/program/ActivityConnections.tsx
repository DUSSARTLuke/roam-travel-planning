import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ConnectionContext, useConnectionContext } from './connectionContext'
import { Route } from 'lucide-react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import type { Journey } from '../../evolution/v21/contracts'
import type { Revision } from '../../evolution/v21/repository'
import { listProgramJourneys, programJourneyRepository } from '../../db/journeys'
import { transferModes, type TransferMode } from '../../db/transferModel'
import { createId } from '../../utils/createId'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { buildConnectionPlan, connectionPlace, externalConnectionUrl, type ActivityConnection, type SavedConnection } from '../../routing/activityConnections'
import { JourneyDetail } from './JourneyProgram'
import { JourneyFormPanel } from './JourneyFormPanel'
import './activity-connections.css'

type Repository = typeof programJourneyRepository
type Session = { pair?: ActivityConnection; row?: Journey; revision?: Revision; trigger: HTMLButtonElement; kind: 'edit' | 'delete' | 'detail' | 'full-edit' }
export function ActivityConnectionRows({ activity }: { activity: TripActivity }) { return useConnectionContext()?.render(activity) ?? null }
export function UnmanagedTransfer({ id, children }: { id: string; children: ReactNode }) { return useConnectionContext()?.hiddenLegacyIds.has(id) ? null : children }

function optionalNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) throw new Error(`${label} doit être un nombre positif ou nul.`)
  const result = Number(value.replace(',', '.'))
  if (!Number.isFinite(result)) throw new Error(`${label} est trop élevée.`)
  return result
}

function ConnectionEditor({ trip, session, repository, onClose }: { trip: Trip; session: Session; repository: Repository; onClose: () => void }) {
  const row = session.row, segment = row?.segments[0], pair = session.pair
  const [mode, setMode] = useState<TransferMode>(segment?.mode ?? 'walk')
  const [duration, setDuration] = useState(segment?.durationMinutes?.toString() ?? '')
  const [margin, setMargin] = useState(segment?.safetyMarginMinutes?.toString() ?? '')
  const [distance, setDistance] = useState(segment?.distanceMeters === undefined ? '' : String(segment.distanceMeters / 1000))
  const choices = pair?.participantIds ?? []
  const [selected, setSelected] = useState<string[] | undefined>(row ? row.participantIds?.filter(id => choices.includes(id)) ?? pair?.participantIds?.slice() : pair?.participantIds?.slice())
  const [initial] = useState(() => JSON.stringify([mode, duration, margin, distance, selected]))
  const dirty = JSON.stringify([mode, duration, margin, distance, selected]) !== initial
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [discard, setDiscard] = useState(false)
  const ref = useRef<HTMLDialogElement>(null), lock = useRef(false), cancelRef = useRef<HTMLButtonElement>(null)
  useReloadBlocker(dirty || busy, 'Enregistre ou abandonne la liaison avant la mise à jour.')
  useEffect(() => {
    const dialog = ref.current!, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = overflow; if (session.trigger.isConnected) session.trigger.focus({ preventScroll: true }) }
  }, [session.trigger])
  useEffect(() => { if (discard) cancelRef.current?.focus() }, [discard])
  useEffect(() => {
    if (!dirty) return
    const block = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', block); return () => window.removeEventListener('beforeunload', block)
  }, [dirty])
  function close() { if (!lock.current) { if (dirty) setDiscard(true); else onClose() } }
  async function save(event: FormEvent) {
    event.preventDefault(); if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      if (session.kind === 'delete') {
        await repository.remove('journeys', trip.id, row!.id, session.revision!)
      } else {
        const durationMinutes = optionalNumber(duration, 'La durée')
        if (durationMinutes === undefined) throw new Error('Renseigne une durée manuelle en minutes.')
        if (!pair) throw new Error('Ces activités ne se suivent plus. Les données du déplacement sont conservées.')
        if (choices.length && (!selected?.length || selected.some(id => !choices.includes(id)))) throw new Error('Choisis des voyageurs qui suivent encore ces deux activités.')
        const now = new Date().toISOString(), id = row?.id ?? createId()
        const stop = (activity: TripActivity, index: number) => ({ id: row?.stops[index]?.id ?? createId(), kind: 'activity' as const, link: { kind: 'activity' as const, id: activity.id, state: 'linked' as const }, place: connectionPlace(activity) })
        const stops = row && row.purpose !== 'activity-connection' ? row.stops : [stop(pair.from, 0), stop(pair.to, 1)]
        const next: Journey = { ...row, id, tripId: trip.id, title: row?.title ?? `${pair.from.title} → ${pair.to.title}`, stops,
          participantIds: selected, ...(!row || row.purpose === 'activity-connection' ? { purpose: 'activity-connection' as const, departure: { date: pair.from.date! }, arrival: { date: pair.to.date! } } : {}),
          segments: [{ ...segment, id: segment?.id ?? createId(), fromStopId: stops[0].id, toStopId: stops[1].id, mode, durationMinutes, durationSource: 'manual', safetyMarginMinutes: optionalNumber(margin, 'La marge'), distanceMeters: distance.trim() ? optionalNumber(distance, 'La distance')! * 1000 : undefined }],
          createdAt: row?.createdAt ?? now, updatedAt: now }
        await repository.saveJourney(trip.id, next, session.revision)
      }
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible. Ta saisie est conservée.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={ref} className="activity-panel connection-panel" aria-labelledby="connection-title" onCancel={event => { event.preventDefault(); if (discard) setDiscard(false); else close() }}>
    <header className="activity-panel-header"><h2 id="connection-title">{session.kind === 'delete' ? 'Supprimer le déplacement ?' : row ? 'Modifier la liaison' : 'Ajouter une liaison'}</h2><button type="button" className="secondary-button" disabled={busy} onClick={close}>Fermer</button></header>
    <form className="activity-panel-form" onSubmit={save} inert={discard}>
      <p className="connection-endpoints">{pair ? `${pair.from.title} → ${pair.to.title}` : row?.title}</p>
      {session.kind === 'delete' ? <p>Le déplacement sera supprimé pour ses voyageurs, avec ses éventuels documents et partages. Les activités sont conservées.</p> : <fieldset disabled={busy}>
        <label>Moyen de transport<select autoFocus value={mode} onChange={event => setMode(event.target.value as TransferMode)}>{Object.entries(transferModes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Durée manuelle (min) *<input required inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} /></label>
        <div className="form-row"><label>Marge de sécurité (min)<input inputMode="decimal" value={margin} onChange={event => setMargin(event.target.value)} /></label><label>Distance (km)<input inputMode="decimal" value={distance} onChange={event => setDistance(event.target.value)} /></label></div>
        {!!choices.length && <fieldset className="connection-participants"><legend>Voyageurs concernés</legend>{choices.map(id => <label key={id} className="activity-checkbox"><input type="checkbox" checked={selected?.includes(id) ?? false} onChange={event => setSelected(event.target.checked ? [...(selected ?? []), id] : selected?.filter(value => value !== id))} />{trip.participants?.find(person => person.id === id)?.name ?? 'Voyageur indisponible'}</label>)}</fieldset>}
        {!choices.length && <p className="activity-meta">{pair ? 'Voyage collectif sans voyageurs nommés.' : 'Liaison à vérifier : ces activités ne se suivent plus.'}</p>}
        {pair?.uncertain && <p className="activity-meta">Ordre à confirmer : les horaires ne permettent pas de déterminer une succession certaine.</p>}
      </fieldset>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <footer className="activity-panel-footer"><button type="button" className="secondary-button" disabled={busy} onClick={close}>Annuler</button><button type="submit" className="primary-button" disabled={busy || session.kind !== 'delete' && !pair}>{busy ? 'Enregistrement…' : session.kind === 'delete' ? 'Confirmer la suppression' : 'Enregistrer la liaison'}</button></footer>
    </form>
    {discard && <section className="activity-discard" role="alertdialog" aria-label="Abandonner la liaison"><p>Abandonner les modifications non enregistrées ?</p><button ref={cancelRef} type="button" className="secondary-button" onClick={() => setDiscard(false)}>Continuer la saisie</button><button type="button" className="primary-button" onClick={onClose}>Abandonner</button></section>}
  </dialog>
}

export function ActivityConnections({ trip, activities, filter, disabled, readJourneys = listProgramJourneys, repository = programJourneyRepository, children }: {
  trip: Trip; activities: TripActivity[]; filter: string; disabled: boolean; readJourneys?: typeof listProgramJourneys; repository?: Repository; children: ReactNode
}) {
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), lock = useRef(false)
  const [session, setSession] = useState<Session | null>(null)
  const result = useLiveQuery(() => readJourneys(trip.id).then(rows => ({ rows, error: '' }), () => ({ rows: [] as Journey[], error: 'Impossible de charger les liaisons.' })), [trip.id, readJourneys, attempt])
  const plan = useMemo(() => buildConnectionPlan(trip, activities, result?.rows ?? []), [trip, activities, result])
  const hiddenIds = new Set(plan.saved.map(item => item.journey.id)), hiddenLegacyIds = new Set(plan.saved.flatMap(item => item.journey.legacy ? [item.journey.legacy.id] : []))
  const blocked = disabled || busy || !result || !!result.error
  useReloadBlocker(busy, 'Ouverture du déplacement en cours.')
  async function open(item: SavedConnection, trigger: HTMLButtonElement, kind: 'edit' | 'delete' | 'detail') {
    if (lock.current || blocked) return
    lock.current = true; setBusy(true); setError('')
    try {
      const latest = await repository.read('journeys', trip.id, item.journey.id)
      if (JSON.stringify(latest.entity) !== JSON.stringify(item.journey)) throw new Error('Ce déplacement a changé. Rouvre sa dernière version.')
      setSession({ row: latest.entity as Journey, revision: latest.revision, pair: item.pair, trigger, kind: kind === 'edit' && item.journey.stops.length !== 2 ? 'detail' : kind })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Déplacement indisponible.') }
    finally { lock.current = false; setBusy(false) }
  }
  const names = (ids?: string[]) => ids === undefined ? 'Tous les voyageurs' : ids.length ? ids.map(id => trip.participants?.find(person => person.id === id)?.name ?? 'Voyageur indisponible').join(', ') : 'Aucun voyageur commun'
  const relevant = (item: SavedConnection) => !filter || (item.stale ? item.journey.participantIds?.includes(filter) ?? item.pair?.participantIds?.includes(filter) ?? false : item.participantIds?.includes(filter) ?? true)
  const card = (item: SavedConnection) => {
    const row = item.journey, segment = row.segments[0], url = item.pair && row.stops.length === 2 ? externalConnectionUrl(item.pair.from, item.pair.to, segment.mode) : undefined
    return <div className="activity-connection" key={row.id} data-connection-id={row.id}>
      <Route size={16} aria-hidden="true" /><div className="connection-content"><strong>{item.pair ? `Vers ${item.pair.to.title}` : row.title}</strong>
      <span>{row.segments.map(part => transferModes[part.mode]).join(' · ')} · {row.segments.length === 1 && segment.durationMinutes !== undefined ? `${segment.durationMinutes} min · ${segment.durationSource === 'automatic' ? 'Durée calculée' : 'Durée manuelle'}` : 'Déplacement existant à consulter'}{segment.safetyMarginMinutes !== undefined && ` · Marge ${segment.safetyMarginMinutes} min`}{segment.distanceMeters !== undefined && ` · ${segment.distanceMeters / 1000} km`}</span>
      <span>{names(item.stale ? row.participantIds : item.participantIds)}</span>
      {item.stale ? <span>À vérifier : programme ou voyageurs modifiés. Durée conservée.</span> : item.pair?.uncertain && <span>Ordre à confirmer</span>}
      <div className="connection-actions"><button type="button" className="connection-link" disabled={blocked} onClick={event => void open(item, event.currentTarget, 'edit')}>{row.stops.length === 2 ? 'Modifier' : 'Consulter'}</button><button type="button" className="connection-link" disabled={blocked} onClick={event => void open(item, event.currentTarget, 'delete')}>Supprimer</button>{row.purpose !== 'activity-connection' && row.stops.length === 2 && <button type="button" className="connection-link" disabled={blocked} onClick={event => void open(item, event.currentTarget, 'detail')}>Fiche complète</button>}{url && <a href={url} target="_blank" rel="noopener noreferrer">Itinéraire externe</a>}</div></div>
    </div>
  }
  const render = (activity: TripActivity) => <>
    {plan.saved.filter(item => !item.stale && item.pair?.from.id === activity.id && relevant(item)).map(card)}
    {plan.available.filter(pair => pair.from.id === activity.id && (!filter || pair.participantIds?.includes(filter) || pair.participantIds === undefined)).map(pair => <div className="connection-suggestion" key={pair.key}><button type="button" className="connection-link" disabled={blocked} onClick={event => setSession({ pair, trigger: event.currentTarget, kind: 'edit' })}><Route size={14} aria-hidden="true" />Ajouter une liaison vers {pair.to.title}</button><span className="activity-meta">{names(pair.participantIds)}{pair.uncertain ? ' · Ordre à confirmer' : ''}</span></div>)}
  </>
  return <ConnectionContext value={{ hiddenIds, hiddenLegacyIds, filter, render }}>
    {children}
    {result?.error && <p role="alert">{result.error} <button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Réessayer les liaisons</button></p>}
    {error && <p role="alert">{error}</p>}
    {plan.saved.some(item => item.stale && relevant(item)) && <section className="connection-corrections" aria-label="Liaisons à vérifier"><h2>Liaisons à vérifier</h2>{plan.saved.filter(item => item.stale && relevant(item)).map(card)}</section>}
    {session && (session.kind === 'edit' || session.kind === 'delete') && <ConnectionEditor key={`${session.kind}-${session.row?.id ?? session.pair?.key}`} trip={trip} session={session} repository={repository} onClose={() => setSession(null)} />}
    {session?.kind === 'detail' && <JourneyDetail journey={session.row!} trip={trip} repository={repository} trigger={session.trigger} onClose={() => setSession(null)} onEdit={(row, revision) => setSession({ ...session, row, revision, kind: 'full-edit' })} />}
    {session?.kind === 'full-edit' && <JourneyFormPanel trip={trip} activities={activities} initialDate={session.row!.departure?.date ?? trip.startDate} baseline={session.row} version={session.revision} repository={repository} trigger={session.trigger} onClose={() => setSession(null)} onSaved={() => setSession(null)} />}
  </ConnectionContext>
}
