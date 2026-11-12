import { ActivityPlaceSearch } from './ActivityPlaceSearch'
import type { PlaceProvider } from '../../places/photon'
import { createId } from '../../utils/createId'
import { coordinateFormValue, isCoordinateDraft } from '../../db/activityLocation'
import type { Accommodation } from '../../evolution/v21/contracts'
import { useEffect, useRef, useState } from 'react'
import type { Trip } from '../../db/database'
import type { TripActivity } from '../../db/activityModel'
import type { Journey } from '../../evolution/v21/contracts'
import type { Revision, createV21Repository } from '../../evolution/v21/repository'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { CurrencySelector } from '../currency/CurrencySelector'
import { transferModes } from '../../db/transferModel'
import { reservationLabels } from './activityPresentation'
import { ActivityDocuments, type PendingDocument } from './ActivityDocuments'
import { prepareDocuments } from '../../db/documentModel'
import { activityEndpoint, accommodationEndpoint, orderedEndpoints, reconcileSegments, draftJourney, journeyDraft, type EndpointDraft } from './journeyFormModel'

type Repository=ReturnType<typeof createV21Repository>
export function JourneyFormPanel({trip,activities,accommodations=[],initialDate,baseline,version,repository,trigger,onClose,onSaved,placeProvider}:{placeProvider?:PlaceProvider;trip:Trip;activities:TripActivity[];accommodations?:Accommodation[];initialDate:string;baseline?:Journey;version?:Revision;repository:Repository;trigger:HTMLButtonElement;onClose:()=>void;onSaved:(journey:Journey)=>void}) {
  const [initial]=useState(()=>journeyDraft(trip,initialDate,baseline)),[form,setForm]=useState(initial)
  const [files,setFiles]=useState<PendingDocument[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [confirmation,setConfirmation]=useState<'discard'|{side:number;id:string}|{remove:number}|null>(null)
  const ref=useRef<HTMLDialogElement>(null),lock=useRef(false),cancel=useRef<HTMLButtonElement>(null)
  const dirty=JSON.stringify(form)!==JSON.stringify(initial)||files.length>0
  useReloadBlocker(dirty||busy,'Déplacement autonome en cours de modification')
  useEffect(()=>{const dialog=ref.current!,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();return()=>{dialog.close();document.body.style.overflow=overflow;if(trigger.isConnected)trigger.focus({preventScroll:true})}},[trigger])
  useEffect(()=>{if(confirmation)cancel.current?.focus({preventScroll:true})},[confirmation])
  useEffect(()=>{if(!dirty)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent)},[dirty])
  function resume(){setConfirmation(null);requestAnimationFrame(()=>ref.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true}))}
  function close(){if(!lock.current){if(dirty)setConfirmation('discard');else onClose()}}
  const endpoints=orderedEndpoints(form)
  function updateEndpoint(index:number,next:EndpointDraft){setForm({...form,from:index===0?next:form.from,to:index===endpoints.length-1?next:form.to,intermediate:form.intermediate.map((value,i)=>i+1===index?next:value)})}
  function applyReference(index:number,value:string){
    const current=endpoints[index]
    if(!value){updateEndpoint(index,{...current,reference:'',kind:'free',link:undefined});return}
    const [kind,...parts]=value.split(':');const id=parts.join(':')
    const activity=activities.find(a=>a.id===id&&a.tripId===trip.id),stay=accommodations.find(a=>a.id===id&&a.tripId===trip.id)
    const next=kind==='accommodation'&&stay?accommodationEndpoint(stay):kind==='activity'&&activity?activityEndpoint(activity):null
    if(next)updateEndpoint(index,{...next,id:current.id})
    setConfirmation(null)
  }
  function choose(index:number,id:string){const current=endpoints[index];if(id&&(current.place.name||current.place.address)&&id!==`${current.referenceKind??'activity'}:${current.reference}`)setConfirmation({side:index,id});else applyReference(index,id)}
  function removeStep(index:number){setForm(reconcileSegments({...form,intermediate:form.intermediate.filter((_,i)=>i+1!==index)}));setConfirmation(null)}
  function moveStep(index:number,direction:number){const middle=[...form.intermediate];const i=index-1;[middle[i],middle[i+direction]]=[middle[i+direction],middle[i]];setForm(reconcileSegments({...form,intermediate:middle}))}
  async function submit(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('')
    try{const row=draftJourney(trip.id,form,baseline);const saved=await repository.saveWithDocuments('journeys',trip.id,row,files.map(f=>f.file),version);onSaved(saved.entity as Journey)}
    catch(reason){setError(reason instanceof Error?reason.message:'Impossible d’enregistrer ce déplacement. Ta saisie est conservée.')}
    finally{lock.current=false;setBusy(false)}
  }
  const [readDocs]=useState(()=>async(tripId:string,id:string)=>{const rows=await repository.listDocuments(tripId,{kind:'journey',id});return rows.map(row=>({...row,activityId:id}))})
  async function selectFiles(selected:File[],count:number){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{if(count+files.length+selected.length>5)throw new Error('Maximum 5 documents. Aucun fichier ajouté.');const prepared=await prepareDocuments(selected);setFiles([...files,...selected.map((file,i)=>({file,mime:prepared[i].mime}))])}catch(reason){setError(reason instanceof Error?reason.message:'Fichier invalide.')}finally{lock.current=false;setBusy(false)}}
  function endpoint(index:number,label:string){const value=endpoints[index];const update=(next:EndpointDraft)=>updateEndpoint(index,next);return <fieldset key={value.id} className="journey-endpoint"><legend>{label}</legend>
    <label>{index===0?'Point de départ':index===endpoints.length-1?'Point d’arrivée':`Référence étape ${index}`}<select value={value.reference?(value.referenceKind==='accommodation'?`accommodation:${value.reference}`:value.reference):''} onChange={event=>choose(index,!event.target.value||event.target.value.startsWith('activity:')||event.target.value.startsWith('accommodation:')?event.target.value:`activity:${event.target.value}`)}><option value="">Lieu libre</option>{activities.filter(a=>a.tripId===trip.id).map(a=><option key={a.id} value={a.id}>{a.title}{a.date?` · ${a.date}`:''}</option>)}{accommodations.filter(a=>a.tripId===trip.id).map(a=><option key={a.id} value={`accommodation:${a.id}`}>Hébergement · {a.place.name}</option>)}</select></label>
    {!value.reference&&<label>Type de lieu<select value={value.kind} onChange={event=>update({...value,kind:event.target.value as EndpointDraft['kind'],link:undefined})}>{Object.entries({free:'Lieu personnalisé',home:'Domicile',station:'Gare',airport:'Aéroport',accommodation:'Hébergement',activity:'Ancien lieu d’activité'}).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>}
    {<ActivityPlaceSearch provider={placeProvider} label={`Rechercher un lieu · ${label.toLowerCase()}`} selectionHelp="La sélection ne sauvegarde pas le déplacement. Un lieu lié est remplacé uniquement après confirmation."
      form={{location:value.place.name,address:value.place.address??'',latitude:value.latitudeText??coordinateFormValue(value.place.latitude),longitude:value.longitudeText??coordinateFormValue(value.place.longitude)}}
      onChange={next=>update({...value,reference:'',referenceKind:undefined,link:undefined,kind:value.reference?'free':value.kind,place:{...value.place,name:next.location,address:next.address,latitude:Number(next.latitude),longitude:Number(next.longitude)},latitudeText:next.latitude,longitudeText:next.longitude})} />}
    <label>{index===0?'Lieu de départ':index===endpoints.length-1?'Lieu d’arrivée':`Lieu étape ${index}`}<input required value={value.place.name} onChange={event=>update({...value,place:{...value.place,name:event.target.value}})} /></label>
    <label>{index===0?'Adresse de départ (facultative)':index===endpoints.length-1?'Adresse d’arrivée (facultative)':`Adresse étape ${index}`}<input value={value.place.address??''} onChange={event=>update({...value,place:{...value.place,address:event.target.value}})} /></label>
    <details><summary>Coordonnées GPS facultatives</summary>{(['latitude','longitude'] as const).map(key=><label key={key}>{key==='latitude'?'Latitude':'Longitude'}<input type="text" inputMode="decimal" value={value[key==='latitude'?'latitudeText':'longitudeText']??coordinateFormValue(value.place[key])} onChange={event=>{if(isCoordinateDraft(event.target.value))update({...value,latitudeText:value.latitudeText??coordinateFormValue(value.place.latitude),longitudeText:value.longitudeText??coordinateFormValue(value.place.longitude),[key==='latitude'?'latitudeText':'longitudeText']:event.target.value})}} /></label>)}</details>
    {index>0&&index<endpoints.length-1&&<div className="journey-actions"><button type="button" className="secondary-button" disabled={index===1} onClick={()=>moveStep(index,-1)} aria-label={`Monter étape ${index}`}>Monter</button><button type="button" className="secondary-button" disabled={index===endpoints.length-2} onClick={()=>moveStep(index,1)} aria-label={`Descendre étape ${index}`}>Descendre</button><button type="button" className="secondary-button" onClick={()=>setConfirmation({remove:index})}>Supprimer étape {index}</button></div>}
    {value.link?.state==='deleted'&&<p role="status">Le lieu lié a été supprimé. Le dernier lieu connu est conservé.</p>}
  </fieldset>}
  return <dialog ref={ref} className="activity-panel journey-panel" aria-labelledby="journey-form-title" aria-busy={busy} onCancel={event=>{event.preventDefault();if(confirmation)resume();else close()}}
    onClick={event=>{if(event.target!==event.currentTarget)return;const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)close()}}>
    <div inert={confirmation!==null}><header className="activity-panel-header"><h2 id="journey-form-title">{baseline?'Modifier le déplacement autonome':'Nouveau déplacement'}</h2><button type="button" className="secondary-button" disabled={busy} onClick={close}>Fermer</button></header>
    <form className="activity-panel-form" onSubmit={event=>{event.preventDefault();void submit()}}>
      <p className="activity-meta">Deux lieux suffisent. Les modes et durées restent attachés à une paire ordonnée de lieux ; après réorganisation, renseigne les nouveaux segments. Aucune activité, coordonnée GPS ou durée n’est obligatoire. Les dates sont locales ; aucun fuseau n’est déduit.</p>
      <fieldset disabled={busy||confirmation!==null} inert={busy||confirmation!==null}>
        <label>Titre (facultatif)<input autoFocus value={form.title} onChange={event=>setForm({...form,title:event.target.value})} /></label>
        {endpoints.map((_,index)=>endpoint(index,index===0?'Départ':index===endpoints.length-1?'Arrivée':`Étape ${index}`))}<button type="button" className="secondary-button" disabled={endpoints.length>=100} onClick={()=>setForm(reconcileSegments({...form,intermediate:[...form.intermediate,{id:createId(),kind:'free',reference:'',place:{name:''}}]}))}>Ajouter une étape</button>
        <label>Date de départ<input type="date" required={!baseline||!!baseline.departure} value={form.date} onChange={event=>setForm({...form,date:event.target.value,arrivalDate:form.arrivalDate===form.date?event.target.value:form.arrivalDate})} /></label>
        <div className="activity-form-row"><label>Heure de départ (facultative)<input type="time" value={form.departureTime} onChange={event=>setForm({...form,departureTime:event.target.value})} /></label><label>Heure d’arrivée (facultative)<input type="time" value={form.arrivalTime} onChange={event=>setForm({...form,arrivalTime:event.target.value})} /></label></div>
        <label>Date d’arrivée<input type="date" value={form.arrivalDate} onChange={event=>setForm({...form,arrivalDate:event.target.value})} /></label>
        {endpoints.slice(0,-1).map((from,index)=>{const to=endpoints[index+1];const segment=form.segments.find(s=>s.fromStopId===from.id&&s.toStopId===to.id);return <fieldset className="journey-endpoint" key={`${from.id}/${to.id}`}><legend>Segment {index+1} · {from.place.name||'Départ'} → {to.place.name||'Arrivée'}</legend><label>{index===0?'Mode de transport':`Mode du segment ${index+1}`}<select value={index===0?form.mode:segment?.mode??'other'} onChange={event=>{const next={...form,segments:form.segments.map(s=>s===segment?{...s,mode:event.target.value as typeof form.mode}:s)};if(index===0)next.mode=event.target.value as typeof form.mode;setForm(next)}}>{Object.entries(transferModes).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label><label>Durée segment {index+1} (minutes)<input type="number" min="0" step="any" value={segment?.durationMinutes??''} onChange={event=>{const segments=segment?form.segments:reconcileSegments(form).segments;setForm({...form,segments:segments.map(s=>s.fromStopId===from.id&&s.toStopId===to.id?{...s,durationMinutes:event.target.value===''?undefined:Number(event.target.value),durationSource:event.target.value===''?undefined:'manual'}:s)})}} /></label></fieldset>})}
        <details className="activity-extra"><summary>Budget</summary><label>Coût estimé<input inputMode="decimal" value={form.estimated} onChange={event=>setForm({...form,estimated:event.target.value})} /></label><label>Montant payé<input inputMode="decimal" value={form.paid} onChange={event=>setForm({...form,paid:event.target.value})} /></label><CurrencySelector label="Devise du déplacement" value={form.currency} onChange={currency=>setForm({...form,currency})} allowEmpty /><p className="activity-meta">Un montant absent reste inconnu. Zéro est un montant renseigné.</p></details>
        <details className="activity-extra"><summary>Réservation</summary><label>Statut de réservation<select value={form.status} onChange={event=>setForm({...form,status:event.target.value})}><option value="">Non renseigné</option>{Object.entries(reservationLabels).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>
          {(['reference','provider','people','deadline','reservationNotes'] as const).map(key=><label key={key}>{({reference:'Référence de confirmation',provider:'Prestataire',people:'Nombre de personnes',deadline:'Date limite',reservationNotes:'Notes de réservation'})[key]}<input type={key==='deadline'?'date':'text'} inputMode={key==='people'?'numeric':undefined} value={form[key]} onChange={event=>setForm({...form,[key]:event.target.value})} /></label>)}
        </details>
        <ActivityDocuments tripId={trip.id} activityId={baseline?.id??null} readDocuments={readDocs} pending={files} onSelect={(selected,count)=>void selectFiles(selected,count)} />
        <label>Notes<textarea value={form.notes} onChange={event=>setForm({...form,notes:event.target.value})} /></label>
      </fieldset>
      {(trip.archived||trip.deletedAt!==undefined)&&<p role="alert">Ce voyage est archivé ou dans la corbeille. Ta saisie est conservée ; restaure le voyage avant d’enregistrer.</p>}
      {error&&<p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy||confirmation!==null||trip.archived===true||trip.deletedAt!==undefined}>{busy?'Enregistrement…':baseline?'Enregistrer les modifications':'Créer le déplacement'}</button>
    </form></div>
    {confirmation&&<section className="journey-confirm" role="alertdialog" aria-modal="true" aria-label={confirmation==='discard'?'Abandonner la saisie ?':'remove' in confirmation?'Supprimer cette étape ?':'Remplacer le lieu saisi ?'}><h3>{confirmation==='discard'?'Abandonner les modifications non enregistrées ?':'remove' in confirmation?'Supprimer cette étape et ses segments adjacents ?':'Remplacer le lieu saisi par celui de la référence ?'}</h3><button ref={cancel} type="button" className="secondary-button" onClick={resume}>Continuer la saisie</button><button type="button" className="primary-button" onClick={()=>confirmation==='discard'?onClose():'remove' in confirmation?removeStep(confirmation.remove):applyReference(confirmation.side,confirmation.id)}>{confirmation==='discard'?'Abandonner':'remove' in confirmation?'Confirmer la suppression de l’étape':'Remplacer le lieu'}</button></section>}
  </dialog>
}
