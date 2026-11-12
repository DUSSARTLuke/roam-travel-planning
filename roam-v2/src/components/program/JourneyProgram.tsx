import { activityIncludesParticipant } from '../../db/activityParticipants'
import { connectionEndpoints } from '../../routing/activityConnections'
import { useConnectionContext } from './connectionContext'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Route, Pencil, Trash2 } from 'lucide-react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import type { Journey } from '../../evolution/v21/contracts'
import type { createV21Repository, Revision } from '../../evolution/v21/repository'
import { listProgramJourneys, programJourneyRepository } from '../../db/journeys'
import { transferModes } from '../../db/transferModel'
import { ActivityDocuments } from './ActivityDocuments'
import { ActivityMoneyDetails } from './ActivityMoneyDetails'
import { reservationLabels } from './activityPresentation'
import { JourneyFormPanel } from './JourneyFormPanel'
import { formatDate } from './dates'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import './journeys.css'

type Repository=ReturnType<typeof createV21Repository>
const dayLabel=(date:string)=>formatDate(date,{day:'numeric',month:'long',year:'numeric'})
export function JourneyDetail({journey,trip,repository,trigger,onClose,onEdit}:{journey:Journey;trip:Trip;repository:Repository;trigger:HTMLButtonElement;onClose:()=>void;onEdit:(row:Journey,revision:Revision)=>void}) {
  const ref=useRef<HTMLDialogElement>(null),section=useRef<HTMLDivElement>(null),lock=useRef(false),cancel=useRef<HTMLButtonElement>(null)
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState<{row:Journey;version:Revision}|null>(null)
  useReloadBlocker(busy,'Déplacement en cours d’enregistrement')
  useEffect(()=>{const dialog=ref.current!,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();return()=>{dialog.close();document.body.style.overflow=overflow;if(trigger.isConnected)trigger.focus({preventScroll:true})}},[trigger])
  useEffect(()=>{if(confirmation)cancel.current?.focus({preventScroll:true})},[confirmation])
  async function snapshot(action:'edit'|'delete'){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const latest=await repository.read('journeys',trip.id,journey.id);if(action==='edit')onEdit(latest.entity as Journey,latest.revision);else setConfirmation({row:latest.entity as Journey,version:latest.revision})}catch(reason){setError(reason instanceof Error?reason.message:'Déplacement indisponible.')}finally{lock.current=false;setBusy(false)}}
  async function remove(){if(lock.current||!confirmation)return;lock.current=true;setBusy(true);setError('');try{await repository.remove('journeys',trip.id,journey.id,confirmation.version);onClose()}catch(reason){setError(reason instanceof Error?reason.message:'Suppression impossible.');setConfirmation(null)}finally{lock.current=false;setBusy(false)}}
  const [documentAccess]=useState(()=>({
    list:async(tripId:string,id:string)=>(await repository.listDocuments(tripId,{kind:'journey',id})).map(row=>({...row,activityId:id})),
    get:async(tripId:string,id:string,documentId:string)=>{const stored=await repository.getDocument(tripId,{kind:'journey',id},documentId);return {...stored,metadata:{...stored.metadata,activityId:id}}},
    remove:async(tripId:string,id:string,documentId:string,expected?:string)=>{if(!expected)throw new Error('Confirmation documentaire absente.');const metadata=JSON.parse(expected);delete metadata.activityId;await repository.deleteDocument(tripId,{kind:'journey',id},documentId,JSON.stringify(metadata))},
  }))
  return <dialog ref={ref} className="activity-panel activity-detail-panel journey-panel" aria-labelledby="journey-detail-title" onCancel={event=>{event.preventDefault();if(!busy){if(confirmation)setConfirmation(null);else onClose()}}}
    onClick={event=>{if(event.target!==event.currentTarget||busy)return;const b=event.currentTarget.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom){if(confirmation)setConfirmation(null);else onClose()}}}>
    <header className="activity-panel-header" inert={confirmation!==null}><h2 id="journey-detail-title">{journey.title}</h2><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Fermer</button></header>
    <div className="activity-detail-body" ref={section} tabIndex={-1} inert={confirmation!==null}>
      <p><Route size={18} aria-hidden="true" /> {journey.segments.map(segment=>transferModes[segment.mode]).join(' · ')} · Déplacement autonome</p>
      <dl className="activity-detail-fields">{journey.stops.map((stop,index)=><div key={stop.id}><dt>{index===0?'Départ':index===journey.stops.length-1?'Arrivée':`Étape ${index+1}`}</dt><dd>{stop.place.name}{stop.place.address&&<span className="activity-meta">{stop.place.address}</span>}{stop.link?.state==='deleted'&&<span className="activity-meta">Lieu lié supprimé — dernier lieu connu conservé</span>}</dd></div>)}
        <div><dt>Départ</dt><dd>{journey.departure?`${dayLabel(journey.departure.date)}${journey.departure.time?` · ${journey.departure.time}`:' · Sans horaire'}`:'Date non renseignée'}</dd></div>
        {journey.arrival&&<div><dt>Arrivée</dt><dd>{dayLabel(journey.arrival.date)}{journey.arrival.time?` · ${journey.arrival.time}`:' · Sans horaire'}</dd></div>}
        {journey.segments.length===1&&journey.segments[0].durationMinutes!==undefined&&<div><dt>Durée renseignée</dt><dd>{journey.segments[0].durationMinutes} min</dd></div>}
      </dl>
      <ActivityMoneyDetails activity={journey} trip={trip} heading="Budget du déplacement" />
      {journey.reservation&&Object.values(journey.reservation).some(value=>value!==undefined)&&<section><h3>Réservation</h3><dl className="activity-detail-fields"><div><dt>Statut</dt><dd>{journey.reservation.status?reservationLabels[journey.reservation.status]:'Non renseigné'}</dd></div>{Object.entries({reference:'Référence',provider:'Prestataire',people:'Personnes',deadline:'Date limite',notes:'Notes de réservation'}).map(([key,label])=>{const value=journey.reservation?.[key as keyof typeof journey.reservation];return value!==undefined?<div key={key}><dt>{label}</dt><dd>{String(value)}</dd></div>:null})}</dl></section>}
      {journey.notes&&<section><h3>Notes</h3><p className="journey-notes">{journey.notes}</p></section>}
      <ActivityDocuments tripId={trip.id} activityId={journey.id} readDocuments={documentAccess.list} readDocument={documentAccess.get} removeDocument={documentAccess.remove} />
      <div className="journey-actions"><button type="button" className="secondary-button" disabled={busy||trip.archived===true||trip.deletedAt!==undefined} onClick={()=>void snapshot('edit')}><Pencil size={16} />Modifier le déplacement</button><button type="button" className="secondary-button danger-text" disabled={busy||trip.archived===true||trip.deletedAt!==undefined} onClick={()=>void snapshot('delete')}><Trash2 size={16} />Supprimer le déplacement</button></div>
      <ol className="journey-segments">{journey.segments.map((segment,index)=><li key={segment.id}>{journey.stops[index].place.name} → {journey.stops[index+1].place.name} · {transferModes[segment.mode]}{segment.durationMinutes!==undefined?` · ${segment.durationMinutes} min`:' · Durée non renseignée'}</li>)}</ol>
    </div>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {confirmation&&<section className="journey-confirm" role="alertdialog" aria-modal="true" aria-label="Confirmer la suppression du déplacement"><h3>Supprimer « {confirmation.row.title} » ?</h3><p>Ce déplacement et ses documents seront supprimés définitivement. Les activités liées sont conservées.</p><button ref={cancel} type="button" className="secondary-button" disabled={busy} onClick={()=>setConfirmation(null)}>Annuler la suppression</button><button type="button" className="primary-button" disabled={busy} onClick={()=>void remove()}>{busy?'Suppression…':'Confirmer la suppression du déplacement'}</button></section>}
  </dialog>
}
export function JourneyProgram({trip,activities,date,blocked=false,readJourneys=listProgramJourneys,repository=programJourneyRepository,onDate}:{trip:Trip;activities:TripActivity[];date:string;blocked?:boolean;readJourneys?:typeof listProgramJourneys;repository?:Repository;onDate?:(date:string)=>void}) {
  const [attempt,setAttempt]=useState(0)
  const result=useLiveQuery(()=>readJourneys(trip.id).then(rows=>({rows,error:''}),()=>({rows:[] as Journey[],error:'Impossible de charger les déplacements. Les données locales sont conservées.'})),[trip.id,readJourneys,attempt])
  type Session={kind:'create'|'detail'|'edit';trigger:HTMLButtonElement;row?:Journey;version?:Revision;seen?:boolean}
  const [session,setSession]=useState<Session|null>(null)
  const editing=session?.kind==='create'||session?.kind==='edit'
  const accommodations=useLiveQuery(()=>editing?repository.listAccommodations(trip.id).then(rows=>({rows,error:''}),()=>({rows:[],error:'Impossible de charger les hébergements. Les lieux libres restent disponibles.'})):Promise.resolve({rows:[],error:''}),[repository,trip.id,editing])
  const connections = useConnectionContext()
  const raw=result?.rows??[],old=new Set(trip.manualTransfers?.map(t=>t.id)??[])
  const relevantToFilter = (row: Journey) => { if (!connections?.filter) return true; if (row.participantIds !== undefined) return row.participantIds.includes(connections.filter); const endpoints = connectionEndpoints(row); return !endpoints || endpoints.every(id => { const activity = activities.find(item => item.id === id); return activity && activityIncludesParticipant(activity, connections.filter) }) }
  const rows=raw.filter(row=>row.purpose!=='activity-connection'&&!connections?.hiddenIds.has(row.id)&&relevantToFilter(row)&&(!row.legacy||!old.has(row.legacy.id))).sort((a,b)=>(a.departure?.date??'9999').localeCompare(b.departure?.date??'9999')||(a.departure?.time??'99').localeCompare(b.departure?.time??'99')||a.id.localeCompare(b.id))
  const selected=session?.row?raw.find(row=>row.id===session.row!.id):undefined
  if(session?.kind==='detail'&&result&&!result.error){if(selected&&!session.seen)setSession({...session,seen:true});else if(!selected&&session.seen)setSession(null)}
  const disabled=blocked||trip.archived===true||trip.deletedAt!==undefined
  const today=rows.filter(row=>row.departure?.date===date),other=rows.filter(row=>!row.departure||row.departure.date<trip.startDate||row.departure.date>trip.endDate)
  const card=(row:Journey,showDate=false)=><li key={row.id} className="journey-card"><button type="button" disabled={disabled} onClick={event=>setSession({kind:'detail',trigger:event.currentTarget,row,seen:true})} aria-label={`Consulter le déplacement ${row.title}`}><Route size={20} aria-hidden="true" /><span><strong>{row.title}</strong>{showDate&&<span>{row.departure?dayLabel(row.departure.date):'Date non renseignée'}</span>}<span>{row.departure?.time??'Sans horaire'} · {row.segments.map(s=>transferModes[s.mode]).join(' · ')}</span><span>{row.stops.map(stop=>stop.place.name).join(' → ')}</span></span></button></li>
  return <section className="program-journeys" aria-label="Déplacements autonomes"><div className="journey-section-heading"><h2>Déplacements</h2><button type="button" className="secondary-button" disabled={disabled} aria-haspopup="dialog" onClick={event=>setSession({kind:'create',trigger:event.currentTarget})}><Plus size={18} />Nouveau déplacement</button></div>
    {result===undefined&&<p role="status">Chargement des déplacements…</p>}{result?.error&&<div role="alert">{result.error}<button type="button" className="secondary-button" onClick={()=>setAttempt(a=>a+1)}>Réessayer les déplacements</button></div>}
    {result&&!result.error&&<><p className="activity-meta">{dayLabel(date)} · {today.length} déplacement(s) autonome(s)</p>{today.length?<ul className="journey-list">{today.map(row=>card(row))}</ul>:<p className="activity-meta">Aucun déplacement autonome prévu ce jour.</p>}{other.length>0&&<details><summary>Déplacements sans date ou hors séjour ({other.length})</summary><ul className="journey-list">{other.map(row=>card(row,true))}</ul></details>}</>}
    {session?.kind==='detail'&&(selected??session.row)&&<JourneyDetail key={session.row!.id} journey={(selected??session.row)!} trip={trip} repository={repository} trigger={session.trigger} onClose={()=>setSession(null)} onEdit={(row,version)=>setSession({...session,kind:'edit',row,version})} />}
    {editing&&accommodations?.error&&<p role="alert">{accommodations.error}</p>}
    {(session?.kind==='create'||session?.kind==='edit')&&<JourneyFormPanel key={session.kind+session.row?.id} trip={trip} activities={activities} accommodations={accommodations?.rows} initialDate={date} baseline={session.row} version={session.version} repository={repository} trigger={session.trigger} onClose={()=>setSession(session.row?{...session,kind:'detail'}:null)} onSaved={row=>{if(row.departure)onDate?.(row.departure.date);setSession({...session,kind:'detail',row,seen:false})}} />}
  </section>
}
