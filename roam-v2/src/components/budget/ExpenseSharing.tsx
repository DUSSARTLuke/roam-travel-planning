import { matchingActivityReservations } from '../../accommodations/model'
import type { Journey, Accommodation } from '../../evolution/v21/contracts'
import type { SharingSource } from '../../money/expenseSharing'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import { expenseSharingRepository, type createExpenseSharingRepository } from '../../db/expenseSharing'
import { calculateExpenseSharing, sharingSources, expenseReferenceKey, sharingVersion, parseSharingAmount, formatSharingMinorUnits, type TripParticipant, type ExpenseShare } from '../../money/expenseSharing'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import './expense-sharing.css'

type Repository = ReturnType<typeof createExpenseSharingRepository>
type Source = SharingSource
export function SharingDialog({ title, onClose, dirty = false, busy, children, reloadReason = 'Un formulaire budgétaire est en cours.', fallbackFocusRef, returnFocusRef }: { title: string; onClose: () => void; dirty?: boolean; busy: boolean; children: (close: () => void) => ReactNode; reloadReason?: string; fallbackFocusRef?: { current: HTMLElement | null }; returnFocusRef?: { current: HTMLElement | null } }) {
  const ref = useRef<HTMLDialogElement>(null), backdrop = useRef(false)
  const [discard, setDiscard] = useState(false)
  useReloadBlocker(dirty || busy, reloadReason)
  useEffect(() => {
    const dialog = ref.current!, previous = returnFocusRef?.current ?? document.activeElement, overflow = document.body.style.overflow, fallback = fallbackFocusRef?.current
    document.body.style.overflow = 'hidden'; dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else fallback?.focus({ preventScroll: true }) }
  }, [fallbackFocusRef, returnFocusRef])
  useEffect(()=>{if(!dirty&&!busy)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent)},[dirty,busy])
  function close() { if (!busy) { if (dirty) setDiscard(true); else onClose() } }
  return <dialog ref={ref} className="activity-panel expense-sharing-dialog" aria-labelledby="sharing-dialog-title" onCancel={(event) => { event.preventDefault(); close() }}
    onPointerDown={(event) => { const box = event.currentTarget.getBoundingClientRect(); backdrop.current = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom }}
    onClick={(event) => { if (event.target === event.currentTarget && backdrop.current) close(); backdrop.current = false }}>
    <div inert={discard}><header className="activity-panel-header"><h2 id="sharing-dialog-title">{title}</h2><button type="button" className="secondary-button" disabled={busy} onClick={close}>Fermer</button></header>
      {children(close)}</div>
    {discard && <div className="sharing-discard" role="alert"><h3>Abandonner les modifications non enregistrées ?</h3><button type="button" className="secondary-button" autoFocus onClick={() => setDiscard(false)}>Continuer la saisie</button><button type="button" className="secondary-button" onClick={onClose}>Abandonner</button></div>}
  </dialog>
}
function ParticipantEditor({ participant, busy, error, onClose, save }: { participant?: TripParticipant; busy: boolean; error: string; onClose: () => void; save: (name: string) => void }) {
  const [name, setName] = useState(participant?.name ?? '')
  return <SharingDialog title={participant ? 'Modifier le participant' : 'Ajouter un participant'} busy={busy} dirty={name !== (participant?.name ?? '')} onClose={onClose}>{(close) => <form onSubmit={(event) => { event.preventDefault(); save(name) }}>
    <label>Nom<input autoFocus required maxLength={80} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>Annuler</button><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le participant'}</button></footer>
  </form>}</SharingDialog>
}
function ShareEditor({ source, existing, participants, busy, error, save, onClose }: { source: Source; existing?: ExpenseShare; participants: readonly TripParticipant[]; busy: boolean; error: string; save: (input: Pick<ExpenseShare, 'amount' | 'payerId' | 'shares'>) => void; onClose: () => void }) {
  const [initial] = useState(() => ({ amount: source.paidAmount === undefined ? '' : String(source.paidAmount), payer: existing?.payerId ?? participants[0]?.id ?? '', weights: Object.fromEntries(participants.map((participant) => [participant.id, String(existing?.shares.find((share) => share.participantId === participant.id)?.weight ?? 1)])), selected: Object.fromEntries(participants.map((participant) => [participant.id, existing ? existing.shares.some((share) => share.participantId === participant.id) : true])) }))
  const [draft, setDraft] = useState(initial), [localError, setLocalError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  return <SharingDialog title={existing ? 'Modifier le partage' : 'Partager cette dépense'} busy={busy} dirty={dirty} onClose={onClose}>{(close) => <form onSubmit={(event) => {
    event.preventDefault(); setLocalError('')
    try {
      const shares = Object.entries(draft.selected).filter(([, selected]) => selected).map(([participantId]) => { const value = draft.weights[participantId] ?? '';  if (!/^\d+$/.test(value)) throw new Error('Les parts sont des nombres entiers positifs.'); return { participantId, weight: Number(value) } })
      save({ amount: parseSharingAmount(draft.amount), payerId: draft.payer, shares })
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : 'Partage invalide.') }
  }}>
    <p><strong>{source.label}</strong></p><p className="budget-meta">Un seul payeur par dépense. Seul le montant réellement payé est partagé, jamais l’estimation ni son reste à payer.</p>
    <label>Montant effectivement payé ({source.currency || 'devise à renseigner dans l’activité'})<input autoFocus type="text" inputMode="decimal" required disabled={busy} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
    <p className="budget-meta">Enregistrer confirme ce montant payé sur la dépense. La devise d’origine reste inchangée.</p>
    <label>Payé par<select required disabled={busy} value={draft.payer} onChange={(event) => setDraft({ ...draft, payer: event.target.value })}><option value="">Choisir un payeur</option>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}</select></label>
    <fieldset><legend>Partagé pour — parts égales par défaut</legend><p className="budget-meta">Une part de 2 prend deux fois la part de 1. Décoche une personne pour l’exclure.</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setDraft({ ...draft, weights: Object.fromEntries(participants.map((participant) => [participant.id, '1'])), selected: Object.fromEntries(participants.map((participant) => [participant.id, true])) })}>Partager également entre tous</button>
      {participants.map((participant) => <div key={participant.id} className="sharing-weight"><label><input type="checkbox" disabled={busy} checked={draft.selected[participant.id] ?? false} onChange={(event) => setDraft({ ...draft, selected: { ...draft.selected, [participant.id]: event.target.checked }, weights: { ...draft.weights, [participant.id]: draft.weights[participant.id] ?? '1' } })} />{participant.name}</label>
        {draft.selected[participant.id] && <label>Parts de {participant.name}<input type="text" inputMode="numeric" required disabled={busy} value={draft.weights[participant.id] ?? ''} onChange={(event) => setDraft({ ...draft, weights: { ...draft.weights, [participant.id]: event.target.value } })} /></label>}</div>)}
    </fieldset>
    {(localError || error) && <p role="alert" className="form-error">{localError || error}</p>}
    <footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>Annuler</button><button className="primary-button" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le partage'}</button></footer>
  </form>}</SharingDialog>
}
export function ExpenseSharing({ trip, activities, journeys=[], accommodations=[], repository = expenseSharingRepository, chosenExpense, onChosenExpenseChange }: { trip: Trip; activities: readonly TripActivity[];journeys?:readonly Journey[];accommodations?:readonly Accommodation[]; repository?: Repository; chosenExpense?: string; onChosenExpenseChange?: (value: string) => void }) {
  const sources:SharingSource[]=sharingSources(trip,activities)
  for(const journey of journeys)if(journey.tripId===trip.id&&journey.purpose!=='activity-connection'&&!sources.some(source=>source.kind==='transfer'&&source.expenseId===journey.legacy?.id))sources.push({kind:journey.legacy&&trip.expenseShares?.some(share=>share.kind==='transfer'&&share.expenseId===journey.legacy?.id)?'transfer':'journey',expenseId:journey.legacy&&trip.expenseShares?.some(share=>share.kind==='transfer'&&share.expenseId===journey.legacy?.id)?journey.legacy.id:journey.id,label:journey.title,paidAmount:journey.paidAmount,currency:journey.currency})
  for(const stay of accommodations)if(stay.tripId===trip.id&&!stay.budgetExcluded&&!matchingActivityReservations(stay,activities).length)sources.push({kind:'accommodation',expenseId:stay.id,label:stay.place.name,paidAmount:stay.paidAmount,currency:stay.currency})
  const result = calculateExpenseSharing(trip,activities,sources)
  const participants = trip.participants ?? [], shares = trip.expenseShares ?? []
  const [localChosen, setChosen] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const chosen = chosenExpense ?? localChosen
  const lock = useRef(false)
  const [dialog, setDialog] = useState<{ kind: 'participant'; participant?: TripParticipant } | { kind: 'expense'; source: Source; existing?: ExpenseShare; version: string } | { kind: 'delete'; participant: TripParticipant } | { kind: 'remove'; share: ExpenseShare; label: string } | null>(null)
  useReloadBlocker(busy, 'Enregistrement du partage des dépenses.')
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action(); setDialog(null); setMessage('Modification enregistrée.') }
    catch (caught) { console.error('Échec d’enregistrement du partage.', caught); setError(caught instanceof Error ? caught.message : 'Impossible d’enregistrer le partage. Les saisies sont conservées.') }
    finally { lock.current = false; setBusy(false) }
  }
  function openExpense(source: Source) { setError(''); const existing = shares.find((item) => expenseReferenceKey(item) === expenseReferenceKey(source)); setDialog({ kind: 'expense', source, existing, version: sharingVersion(source, existing) }) }
  const names = new Map(participants.map((item) => [item.id, item.name]))
  const money = (minor: number) => result.status === 'calculated' ? formatSharingMinorUnits(Math.abs(minor), result.currency) : 'Indisponible'
  return <section className="expense-sharing" aria-labelledby="expense-sharing-title"><h2 id="expense-sharing-title">Partage entre voyageurs</h2>
    <p className="budget-meta">Les anciennes dépenses restent non partagées tant que tu ne les actives pas ici. Le nombre de voyageurs du voyage n’est pas modifié.</p>
    <h3>Participants ({participants.length})</h3><ul className="sharing-participants">{participants.map((participant) => <li key={participant.id}><strong>{participant.name}</strong><div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setDialog({ kind: 'participant', participant }) }}>Modifier {participant.name}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setDialog({ kind: 'delete', participant }) }}>Supprimer {participant.name}</button></div></li>)}</ul>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setDialog({ kind: 'participant' }) }}>Ajouter un participant</button>
    {participants.length > 0 && <div className="sharing-source-picker"><label>Dépense à partager<select value={sources.some((item) => expenseReferenceKey(item) === chosen) ? chosen : ''} onChange={(event) => { setChosen(event.target.value); onChosenExpenseChange?.(event.target.value) }}><option value="">Choisir une activité, un déplacement ou un hébergement</option>{sources.map((source) => <option key={expenseReferenceKey(source)} value={expenseReferenceKey(source)}>{source.kind === 'activity' ? 'Activité' : source.kind==='accommodation'?'Hébergement':'Déplacement'} · {source.label}</option>)}</select></label>
      <button type="button" className="secondary-button" disabled={busy || !sources.some((item) => expenseReferenceKey(item) === chosen)} onClick={() => { const source = sources.find((item) => expenseReferenceKey(item) === chosen); if (source) openExpense(source) }}>Configurer le partage</button></div>}
    {result.status === 'invalid' ? <p role="alert" className="budget-warning">{result.reason}</p> : <>
      <p className="budget-meta">{result.included} partage(s) calculable(s) · {result.unshared} dépense(s) non activée(s) · soldes en {result.currency}. Les paiements partiels partagent uniquement la somme déjà payée.</p>
      {result.included > 0 && <div className="budget-table-wrap" tabIndex={0} role="region" aria-label="Soldes des participants"><table><caption>Solde positif : à recevoir ; solde négatif : à rembourser.</caption><thead><tr><th scope="col">Participant</th><th scope="col">Payé</th><th scope="col">Sa part</th><th scope="col">Solde</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><th scope="row">{row.name}</th><td>{money(row.paidMinor)}</td><td>{money(row.owedMinor)}</td><td>{row.balanceMinor > 0 ? '+' : row.balanceMinor < 0 ? '−' : ''}{money(row.balanceMinor)}</td></tr>)}</tbody></table></div>}
      {result.included === 0 ? <p>Aucun partage calculable pour le moment.</p> : <><h3>Remboursements proposés</h3>{result.reimbursements.length ? <ul>{result.reimbursements.map((item) => <li key={`${item.from}:${item.to}`}>{names.get(item.from)} doit {money(item.minor)} à {names.get(item.to)}.</li>)}</ul> : <p>Aucun remboursement nécessaire pour les partages calculables.</p>}</>}
      {result.issues.length > 0 && <div className="budget-warning" role="status"><p>Partages exclus des soldes et remboursements :</p><ul>{result.issues.map((issue) => <li key={issue.key}>{issue.label} : {issue.reason}</li>)}</ul></div>}
    </>}
    {shares.length > 0 && <ul className="sharing-expenses">{shares.map((share) => { const source = sources.find((item) => expenseReferenceKey(item) === expenseReferenceKey(share)); return <li key={expenseReferenceKey(share)}><strong>{source?.label ?? 'Dépense inaccessible'}</strong><span>Payeur enregistré : {names.get(share.payerId) ?? 'Participant absent'}</span><div>
      <button type="button" className="secondary-button" disabled={busy || !source} onClick={() => source && openExpense(source)}>Modifier le partage</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setError(''); setDialog({ kind: 'remove', share, label: source?.label ?? 'Dépense inaccessible' }) }}>Retirer le partage</button></div></li> })}</ul>}
    <p className="budget-meta">Les remboursements sont des propositions sur les seuls paiements confirmés et convertibles, pas des remboursements enregistrés. Les paiements des déplacements sont suivis ici, sans être ajoutés au total payé du budget global ni aux graphiques. Arrondi par dépense après conversion, puis répartition exacte des unités monétaires. Aucun montant estimé n’est changé.</p>
    {message && <p role="status">{message}</p>}{error && !dialog && <p role="alert">{error}</p>}
    {dialog?.kind === 'participant' && <ParticipantEditor participant={dialog.participant} busy={busy} error={error} onClose={() => setDialog(null)} save={(name) => void perform(() => repository.saveParticipant(trip.id, name, dialog.participant?.id, dialog.participant?.name))} />}
    {dialog?.kind === 'expense' && <ShareEditor source={dialog.source} existing={dialog.existing} participants={participants} busy={busy} error={error} onClose={() => setDialog(null)} save={(input) => void perform(() => repository.saveShare(trip.id, dialog.source, input, dialog.version))} />}
    {(dialog?.kind === 'delete' || dialog?.kind === 'remove') && <SharingDialog title={dialog.kind === 'delete' ? `Supprimer ${dialog.participant.name} ?` : `Retirer le partage de ${dialog.label} ?`} busy={busy} onClose={() => setDialog(null)}>{() => <div className="sharing-confirm"><p>{dialog.kind === 'delete' ? 'Ce voyageur sera retiré des activités. La suppression est refusée s’il est utilisé par une dépense partagée.' : 'Le montant payé et la dépense seront conservés. Seule leur répartition sera retirée.'}</p>{error && <p role="alert">{error}</p>}<button type="button" className="secondary-button" disabled={busy} onClick={() => setDialog(null)}>Annuler</button><button type="button" className="primary-button" disabled={busy} onClick={() => void perform(() => dialog.kind === 'delete' ? repository.deleteParticipant(trip.id, dialog.participant.id, dialog.participant.name) : repository.removeShare(trip.id, dialog.share, JSON.stringify(dialog.share)))}>{busy ? 'Enregistrement…' : 'Confirmer'}</button></div>}</SharingDialog>}
  </section>
}
