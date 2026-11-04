import { createUpdateCoordinator, type UpdateMessage } from '../src/pwa/updateCoordinator'
import { createConnectionMonitor } from '../src/pwa/connection'
import { beginSensitiveOperation, releaseReload, reloadBlockReason, reserveReload, trackReloadBlocker } from '../src/pwa/reloadSafety'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function fixture() {
  let blocked = false
  let reloads = 0
  let index = 0
  const reservations = new Set<string>()
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  const messages: UpdateMessage[] = []
  const worker = { postMessage(message: UpdateMessage) { messages.push(message) } }
  const coordinator = createUpdateCoordinator({
    reason: () => blocked ? 'Saisie non enregistrée' : null,
    reserve(id) { if (blocked) return false; reservations.add(id); return true },
    release(id) { reservations.delete(id) }, reload() { reloads++ }, token: () => `request-${++index}`,
    timer(callback) { const id = ++index as unknown as ReturnType<typeof setTimeout>; timers.set(id, callback); return id },
    clear(id) { timers.delete(id) },
  })
  return { coordinator, worker, messages, reservations, setBlocked(value: boolean) { blocked = value },
    reloads: () => reloads, timeout() { for (const callback of [...timers.values()]) callback() } }
}

export function testPwaUpdates(report: (message: string) => void) {
  const f = fixture()
  f.coordinator.setWaiting(f.worker)
  assert(f.messages.length === 0 && f.reloads() === 0, 'Détection a activé une version sans action.')
  f.coordinator.dismiss(); assert(f.coordinator.getSnapshot().dismissed, 'Plus tard ignoré.')
  f.coordinator.show(); f.setBlocked(true); f.coordinator.request()
  assert(f.messages.length === 0 && f.coordinator.getSnapshot().phase === 'deferred', 'Saisie non enregistrée non protégée.')
  f.setBlocked(false); f.coordinator.request(); f.coordinator.request()
  const request = f.messages.find((message) => message.type === 'ROAM_REQUEST_UPDATE')!
  assert(f.messages.filter((message) => message.type === 'ROAM_REQUEST_UPDATE').length === 1 && f.reservations.size === 1, 'Double demande ou absence de réservation.')
  f.coordinator.message({ type: 'ROAM_UPDATE_CHECK', id: request.id }, f.worker)
  assert(f.messages.some((message) => message.type === 'ROAM_UPDATE_VOTE' && message.ok), 'Vote sûr absent.')
  f.coordinator.message({ type: 'ROAM_UPDATE_COMMIT', id: request.id }, f.worker)
  assert(f.reloads() === 0, 'Rechargement avant activation.')
  f.coordinator.activated(); f.coordinator.activated()
  f.coordinator.message({ type: 'ROAM_UPDATE_ACTIVATED' }, f.worker)
  assert(f.reloads() === 1 && f.reservations.size === 0, 'Rechargement multiple ou verrou non libéré.')

  const order = fixture(); order.coordinator.setWaiting(order.worker); order.coordinator.request()
  const id = order.messages[0].id
  order.coordinator.activated()
  assert(order.reloads() === 0, 'Controllerchange seul a autorisé un reload.')
  order.coordinator.message({ type: 'ROAM_UPDATE_COMMIT', id }, order.worker)
  assert(order.reloads() === 1, 'Ordre controllerchange/commit non géré.')

  const other = fixture()
  other.coordinator.message({ type: 'ROAM_UPDATE_CHECK', id: 'other-tab' }, other.worker)
  other.coordinator.message({ type: 'ROAM_UPDATE_COMMIT', id: 'other-tab' }, other.worker)
  other.setBlocked(true); other.coordinator.activated()
  assert(other.reloads() === 0 && other.coordinator.getSnapshot().phase === 'reload' && other.reservations.size === 0, 'Blocage tardif ignoré.')
  other.coordinator.request(); assert(other.reloads() === 0, 'Reload manuel a ignoré la saisie.')
  other.setBlocked(false); other.coordinator.request(); other.coordinator.request()
  assert(other.reloads() === 1, 'Reload différé explicite incorrect.')

  const refused = fixture(); refused.coordinator.setWaiting(refused.worker); refused.coordinator.request()
  refused.coordinator.message({ type: 'ROAM_UPDATE_RELEASE', id: refused.messages[0].id }, refused.worker)
  assert(refused.reloads() === 0 && refused.reservations.size === 0, 'Refus d’un autre onglet ignoré.')
  refused.coordinator.request(); refused.timeout()
  assert(refused.coordinator.getSnapshot().phase === 'error' && refused.reservations.size === 0, 'Timeout laisse un onglet verrouillé.')

  const unsolicited = fixture()
  unsolicited.coordinator.message({ type: 'ROAM_UPDATE_COMMIT', id: 'unsolicited' }, unsolicited.worker)
  unsolicited.coordinator.message({ type: 'ROAM_UPDATE_ACTIVATED' }, unsolicited.worker)
  assert(unsolicited.reloads() === 0, 'Messages non sollicités ont rechargé la page.')
  unsolicited.coordinator.activated()
  assert(unsolicited.reloads() === 0 && unsolicited.coordinator.getSnapshot().phase === 'reload', 'Activation externe non reportée.')
  report('Mises à jour : attente, Plus tard, saisies, double action, vote/activation, ordre des événements, refus, report, timeout et reload unique.')

  const root = document.createElement('div'); root.id = 'roam-app'
  const button = document.createElement('button'); button.textContent = 'Test focus'
  root.append(button); document.body.append(root); button.focus()
  const stop = trackReloadBlocker('Export test en cours')
  try {
    assert(reloadBlockReason() !== null && !reserveReload('test-reserve'), 'Opération sensible non protégée.')
    stop()
    assert(reserveReload('test-reserve') && root.inert, 'Interactions non verrouillées après vote.')
    let failed = false
    try { beginSensitiveOperation('Nouvelle opération') } catch { failed = true }
    assert(failed, 'Opération démarrée pendant la réservation.')
    releaseReload('test-reserve')
    assert(!root.inert && document.activeElement === button, 'Focus/inert non restaurés.')
  } finally { stop(); releaseReload('test-reserve'); root.remove() }
  report('Sécurité : blocage d’opérations, réservation inert et restauration du focus.')

  const events = new Map<string, () => void>()
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  let timerIndex = 0
  const connection = createConnectionMonitor({ online: () => true,
    listen(type, callback) { events.set(type, callback); return () => { events.delete(type) } },
    timer(callback) { const id = ++timerIndex as unknown as ReturnType<typeof setTimeout>; timers.set(id, callback); return id },
    clear(id) { timers.delete(id) },
  })
  assert(!connection.getSnapshot().offline && !connection.getSnapshot().returned, 'Signal initial incorrect.')
  events.get('offline')!(); assert(connection.getSnapshot().offline, 'Offline ignoré.')
  events.get('online')!(); assert(connection.getSnapshot().returned && !connection.getSnapshot().offline, 'Retour réseau non signalé.')
  for (const callback of [...timers.values()]) callback()
  assert(!connection.getSnapshot().returned, 'Notification de retour non discrète.')
  events.get('offline')!(); events.get('online')!(); events.get('offline')!()
  assert(connection.getSnapshot().offline && !connection.getSnapshot().returned, 'Signal périmé de retour réseau.')
  connection.stop(); assert(events.size === 0, 'Écouteurs réseau non nettoyés.')
  report('Connexion : offline/online, retour temporaire, transitions rapides et nettoyage, sans sonde serveur.')
}
