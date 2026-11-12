import { AccommodationForm } from '../src/components/accommodations/AccommodationSpace'
import { JourneyFormPanel } from '../src/components/program/JourneyFormPanel'
import type { Journey } from '../src/evolution/v21/contracts'
import { refreshLegacyProjection } from '../src/evolution/v21/projection'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey, type ManualTransfer } from '../src/db/transferModel'
import { createV21Repository, type Revision } from '../src/evolution/v21/repository'
import type { Accommodation } from '../src/evolution/v21/contracts'
import { useLiveQuery } from 'dexie-react-hooks'
import { useActivityEditSnapshot } from '../src/components/program/useActivityEditSnapshot'
import { createRef } from 'react'
import { flushSync } from 'react-dom'
import { ActivityFormPanel } from '../src/components/program/ActivityFormPanel'
import { createDocumentRepository } from '../src/db/documents'
import '../src/App.css'
import '../src/components/program/program.css'
import { createRoot } from 'react-dom/client'
import { RoamDatabase } from '../src/db/database'
import { createRoutingService, RoutingCache } from '../src/routing/routingService'
import { makeRoutingEstimate, validateRoutingRequest } from '../src/routing/estimateModel'
import { createActivityRepository } from '../src/db/activities'
import type { TripActivity } from '../src/db/activityModel'
// Only temporary databases explicitly named by the isolated browser runner.
const name = new URL(location.href).searchParams.get('database') ?? ''
if (!/^roam-v2-test-concurrent-[0-9a-f-]{36}$/.test(name)) throw new Error('Base de test temporaire requise.')
const database = new RoamDatabase(name), repository = createActivityRepository(database)
let snapshot: TripActivity | undefined
const root = createRoot(document.getElementById('editor')!)
const documents = createDocumentRepository(database), fallback = createRef<HTMLButtonElement>()
let editorKey = 0, saved = 0
export function TestEditor({ initial }: { initial: TripActivity }) {
  const rows = useLiveQuery(() => repository.listActivities('trip'), [])
  const retained = useActivityEditSnapshot('trip', initial.id, rows === undefined ? initial : rows.find((row) => row.id === initial.id))
  return <><button ref={fallback}>Retour test</button>{retained && <ActivityFormPanel tripId="trip" referenceCurrency="EUR" initialDate={initial.date} fallbackDate="2026-12-31" activity={retained} fallbackFocusRef={fallback} readDocuments={documents.listDocuments} readActivity={repository.getActivity} persistActivity={documents.saveActivityWithDocuments} onClose={() => root.render(null)} onSaved={() => { saved++; root.render(null) }} />}</>
}
const bridge = createTransferRepository(database)
let bridgeSnapshot: ManualTransfer
const v6 = createV21Repository(database)
let v6Snapshot: {entity: Accommodation; revision: Revision}
const routingCache = new RoutingCache(name + '-routing'), routingRequest = validateRoutingRequest({ version: 1, profile: 'foot-walking', coordinates: [[2, 48], [2.1, 48.1]] })
const routing = createRoutingService({ namespace: 'temporary-mock', route: async input => { await database.transaction('rw', database.metadata, async () => { await database.metadata.put({ key: 'routing-provider-calls', value: (((await database.metadata.get('routing-provider-calls')) as {value?: number})?.value ?? 0) + 1 } as never) }); await new Promise(resolve => setTimeout(resolve, 150)); return makeRoutingEstimate(input, 601, 1234, Date.now()) } }, routingCache, { online: () => true, spacingMs: 0 })
let routingSnapshot: Awaited<ReturnType<typeof v6.read>> | undefined
const api = {
  async routingCompute() { return routing.calculate('trip', routingRequest) },
  async routingCalls() { return (await database.metadata.get('routing-provider-calls') as {value?: number})?.value },
  async routingOpen() { routingSnapshot = await v6.read('journeys', 'trip', 'journey-ui') },
  async routingManual() { const latest = await v6.read('journeys', 'trip', 'journey-ui'), row = latest.entity as Journey; await v6.saveJourney('trip', { ...row, segments: row.segments.map((part, i) => i ? part : { ...part, durationMinutes: 91, durationSource: 'manual' }) }, latest.revision) },
  async routingStaleSave() { const estimate = await routing.calculate('trip', routingRequest), row = routingSnapshot!.entity as Journey; try { await v6.saveJourney('trip', { ...row, segments: row.segments.map((part, i) => i ? part : { ...part, routingEstimate: estimate }) }, routingSnapshot!.revision); return true } catch { return false } },
  async openStayUI(){const snapshot=await v6.read('accommodations','trip','hotel'),trip=(await database.trips.get('trip'))!;const trigger=document.createElement('button');document.body.append(trigger);flushSync(()=>root.render(<AccommodationForm key={++editorKey} trip={trip} baseline={snapshot.entity as Accommodation} revision={snapshot.revision} repository={v6} trigger={trigger} onClose={()=>root.render(null)} onSaved={()=>root.render(null)}/>))},
  async stayUIState(){return {row:await database.accommodations.get('hotel'),operations:await database.syncOutbox.count(),notes:[...document.querySelectorAll('dialog label')].find(label=>label.firstChild?.textContent==='Notes')?.querySelector('textarea')?.value}},
  async deleteStay(){const latest=await v6.read('accommodations','trip','hotel');await v6.remove('accommodations','trip','hotel',latest.revision)},
  async openJourneyUI(seed = false) {
    if(seed){const now=new Date().toISOString();await v6.saveJourney('trip',{id:'journey-ui',tripId:'trip',title:'Trajet initial',stops:[{id:'s1',kind:'home',place:{name:'Maison'}},{id:'s-mid',kind:'station',place:{name:'Correspondance'}},{id:'s2',kind:'station',place:{name:'Gare'}}],segments:[{id:'g',fromStopId:'s1',toStopId:'s-mid',mode:'walk',durationMinutes:10},{id:'g2',fromStopId:'s-mid',toStopId:'s2',mode:'train'}],departure:{date:'2026-12-31'},currency:'EUR',createdAt:now,updatedAt:now})}
    const snapshot=await v6.read('journeys','trip','journey-ui'),trip=(await database.trips.get('trip'))!
    const trigger=document.createElement('button');trigger.textContent='Origine trajet test';document.body.append(trigger)
    flushSync(()=>root.render(<JourneyFormPanel key={++editorKey} trip={trip} activities={[]} initialDate="2026-12-31" baseline={snapshot.entity as Journey} version={snapshot.revision} repository={v6} trigger={trigger} onClose={()=>root.render(null)} onSaved={()=>root.render(null)} />))
  },
  async journeyUIState(){return {row:await database.journeys.get('journey-ui'),operations:await database.syncOutbox.count(),notes:[...document.querySelectorAll('dialog label')].find(label=>label.firstChild?.textContent==='Notes')?.querySelector('textarea')?.value,error:document.querySelector('.journey-panel [role="alert"]')?.textContent}},
  async seedBridge() {
    const a=await repository.createActivity('trip',{title:'Départ test',category:'visit',date:'2026-12-31',scheduleType:'unscheduled',period:null})
    const b=await repository.createActivity('trip',{title:'Arrivée test',category:'visit',date:'2026-12-31',scheduleType:'unscheduled',period:null})
    await bridge.saveTransfer('trip',{fromActivityId:a.id,toActivityId:b.id,mode:'train',currency:'EUR',estimatedCost:12,paidAmount:0})
  },
  async openBridge() { bridgeSnapshot=(await database.trips.get('trip'))!.manualTransfers![0] },
  async saveBridge() { try { await bridge.saveTransfer('trip',{...bridgeSnapshot,notes:'Édition V2'},bridgeSnapshot.id,transferKey(bridgeSnapshot)); return true } catch { return false } },
  async deleteBridge() { try { await bridge.deleteTransfer('trip',bridgeSnapshot.id,transferKey(bridgeSnapshot)); return true } catch { return false } },
  async touchBridgeHidden() { await database.transaction('rw',database.tables,async()=>{ const row=(await database.journeys.toArray())[0]; await database.journeys.update(row.id,{reservation:{status:'confirmed',reference:'NATIVE'}}); await refreshLegacyProjection(database,'trip') }) },
  async bridgeState() { return {rows:await database.journeys.toArray(),projection:(await database.trips.get('trip'))!.manualTransfers,operations:await database.syncOutbox.count()} },
  async seedV6() { const at = new Date().toISOString(); await v6.saveAccommodation('trip', {id:'hotel',tripId:'trip',place:{name:'Hôtel'},arrivalDate:'2026-12-31',departureDate:'2027-01-01',createdAt:at,updatedAt:at}) },
  async openV6() { v6Snapshot = await v6.read('accommodations','trip','hotel') as typeof v6Snapshot },
  async saveV6(name: string) { try { await v6.saveAccommodation('trip',{...v6Snapshot.entity,place:{name}},v6Snapshot.revision); return true } catch { return false } },
  async stateV6() { return {hotel:await database.accommodations.get('hotel'),operations:await database.syncOutbox.count()} },
  async seed() {
    await database.open()
    if (!await database.trips.get('trip')) await database.trips.add({ id: 'trip', destination: 'Test isolé', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' })
    if (!await database.activities.get('activity')) await database.activities.add({ id: 'activity', tripId: 'trip', title: 'Titre initial', category: 'visit', date: '2026-12-31', scheduleType: 'unscheduled', period: null, createdAt: '2026-11-09T12:00:00.000Z', updatedAt: '2026-11-09T12:00:00.000Z' })
  },
  async open() { snapshot = await repository.getActivity('trip', 'activity'); return snapshot.title },
  async save(patch: Partial<TripActivity>) { try { await repository.updateActivity('trip', 'activity', { ...snapshot!, ...patch }); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
  async blindSave() { try { await repository.updateActivity('trip', 'activity', { title: 'Sans révision', category: 'visit', date: null, scheduleType: 'unscheduled', period: null }); return { ok: true } } catch (error) { return { ok: false, error: String(error) } } },
  async state() { return { activity: await database.activities.get('activity'), operations: await database.syncOutbox.count(), documents: await database.activityDocuments.count(), groups: (await database.syncOutbox.toArray()).map((op) => op.groupId) } },
  async remove() { const activity = await repository.getActivity('trip', 'activity'); await repository.deleteActivity('trip', activity.id, JSON.stringify(activity)) },
  async openUI() {
    const activity = await repository.getActivity('trip', 'activity')
    flushSync(() => root.render(<TestEditor key={++editorKey} initial={activity} />))
  },
  field(field: 'title' | 'notes', value: string) {
    const element = field === 'title' ? document.querySelector<HTMLInputElement>('dialog input:not([type])')! : [...document.querySelectorAll('dialog label')].find((label) => label.firstChild?.textContent === 'Notes')!.querySelector<HTMLTextAreaElement>('textarea')!
    element.closest('details')?.setAttribute('open', '')
    flushSync(() => { Object.getOwnPropertyDescriptor(field === 'title' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })) })
  },
  attach() {
    const input = document.querySelector<HTMLInputElement>('dialog input[type=file]')!, data = new DataTransfer()
    input.closest('details')?.setAttribute('open', '')
    data.items.add(new File(['%PDF-1.7\nTest PDF'], 'pending.pdf', { type: 'application/pdf' }))
    flushSync(() => { input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })) })
  },
  submit(double = false) { const button = document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!; flushSync(() => { button.click(); if (double) button.click() }) },
  reload() { flushSync(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Recharger les données récentes')!.click()) },
  editorState() { const title = document.querySelector<HTMLInputElement>('dialog input:not([type])'), notes = [...document.querySelectorAll('dialog label')].find((label) => label.firstChild?.textContent === 'Notes')?.querySelector<HTMLTextAreaElement>('textarea'); return { title: title?.value, notes: notes?.value, ready: Boolean(document.querySelector<HTMLButtonElement>('dialog button[type=submit]') && !document.querySelector<HTMLButtonElement>('dialog button[type=submit]')!.disabled), error: document.querySelector('.activity-panel-form > [role=alert]')?.textContent, recoveries: [...document.querySelectorAll<HTMLTextAreaElement>('textarea[readonly]')].map((input) => input.value), pending: document.body.textContent?.includes('pending.pdf'), saved } },
  async cleanup() { root.unmount(); routingCache.close(); database.close() },
}
Object.assign(window, { roamConcurrentTest: api })
document.getElementById('status')!.textContent = 'Prêt'
