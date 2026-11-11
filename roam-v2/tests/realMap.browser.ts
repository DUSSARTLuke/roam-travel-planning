import type { TripMapPoint } from '../src/maps/tripMapModel'
import type { TripMapState } from '../src/maps/tripMapSession'
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw Error(message)}
export async function testRealMapRenderer(){
 const {mountTripMap,mountMapPreview}=await import('../src/maps/maplibrePreview')
 const host=document.createElement('div');host.style.cssText='width:100%;height:400px;position:relative;min-width:0';document.body.append(host)
 const points:TripMapPoint[]=[{id:'activity',title:'Activité',name:'Lieu activité',latitude:0,longitude:179,kind:'activity'},{id:'hotel',title:'Hôtel',name:'Lieu hôtel',latitude:0,longitude:-179,kind:'accommodation'},{id:'station',title:'Gare',name:'Lieu gare',latitude:-1,longitude:179,kind:'station'},{id:'same',title:'Même gare',name:'Même point',latitude:-1,longitude:179,kind:'station'}]
 let latest:TripMapState|undefined,chosen:string[]=[];const handle=mountTripMap(host,points,state=>{latest=state},ids=>{chosen=ids})
 const wait=async(check:()=>boolean)=>{for(let i=0;i<200&&!check();i++)await new Promise(r=>setTimeout(r,50));assert(check(),'Carte réelle non stabilisée : '+JSON.stringify(latest))}
 try{
  await wait(()=>latest?.phase==='ready')
  assert(host.querySelectorAll('.trip-map-marker').length===4,'Marqueurs réels incomplets')
  const hotel=host.querySelector<HTMLButtonElement>('[data-kind=accommodation]')!,station=host.querySelector<HTMLButtonElement>('[data-kind=station]')!
  assert(hotel.textContent==='▣'&&station.textContent==='2','Symboles/groupement réels incohérents')
  hotel.focus();hotel.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));hotel.click();assert(chosen[0]==='hotel'&&hotel.getAttribute('aria-label')?.includes('Hôtel'),'Sélection/nom accessible hôtel absents')
  station.click();assert(chosen.length===2,'Choix réel au même point absent')
  handle.select?.('hotel');assert(hotel.getAttribute('aria-pressed')==='true','Sélection réelle non identifiable')
  handle.update(points.filter(point=>point.id!=='hotel'));assert(host.querySelectorAll('.trip-map-marker').length===3&&!host.querySelector('[data-kind=accommodation]'),'Suppression réactive du marqueur réel échouée')
  handle.transfers?.([{transfer:{id:'segment',mode:'train'},geometry:{type:'MultiLineString',coordinates:[[[179,0],[180,0]],[[-180,0],[-179,0]]]}}],null)
  handle.recenter();await wait(()=>latest?.phase==='ready');handle.dispose();assert(!host.querySelector('canvas')&&!host.querySelector('.trip-map-marker'),'Nettoyage réel échoué')
  let previewReady=false;const preview=mountMapPreview(host,{name:'Point individuel',latitude:0,longitude:0},state=>{previewReady=state.phase==='ready'})
  try{await wait(()=>previewReady);assert(host.querySelector('.activity-map-marker'),'Carte individuelle réelle cassée')}finally{preview.dispose()}
  return {ok:true,renderer:'MapLibre réel / WebGL logiciel SwiftShader',tiles:'PNG simulés via CDP, aucun appel OSM réel',width:innerWidth,checks:'marqueurs/types/±180/groupement/sélection/MAJ/segments/nettoyage et aperçu individuel'}
 }finally{handle.dispose();host.remove()}
}
