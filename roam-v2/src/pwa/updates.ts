import { createId } from '../utils/createId'
import { createUpdateCoordinator } from './updateCoordinator'
import { releaseReload, reloadBlockReason, reserveReload } from './reloadSafety'

export const updates = createUpdateCoordinator({
  reason: reloadBlockReason, reserve: reserveReload, release: releaseReload,
  reload: () => window.location.reload(), token: () => createId(),
  timer: (callback, delay) => setTimeout(callback, delay), clear: (timer) => clearTimeout(timer),
})
let observing: ServiceWorkerRegistration | null = null
let connected = false
export function observeUpdates(registration: ServiceWorkerRegistration) {
  if (observing === registration) return
  observing = registration
  const container = navigator.serviceWorker
  if (!connected) {
    connected = true
    let controller = container.controller
    container.addEventListener('controllerchange', () => {
      const next = container.controller
      const changed = controller !== null && controller !== next
      controller = next
      if (next && (changed || updates.hasReservation())) updates.activated()
    })
    container.addEventListener('message', (event: MessageEvent) => {
      const worker = event.source
      if (!(worker instanceof ServiceWorker) || worker.scriptURL !== new URL('sw.js', registration.scope).href) return
      updates.message(event.data, worker)
    })
  }
  function inspectWaiting() { if (registration.waiting && registration.active) updates.setWaiting(registration.waiting) }
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    if (!worker) return
    const changed = () => {
      if (worker.state === 'installed') inspectWaiting()
      if (worker.state === 'activated' || worker.state === 'redundant') worker.removeEventListener('statechange', changed)
    }
    worker.addEventListener('statechange', changed)
    changed()
  })
  inspectWaiting()
  const installing = registration.installing
  if (installing) installing.addEventListener('statechange', () => { if (installing.state === 'installed') inspectWaiting() })
}
