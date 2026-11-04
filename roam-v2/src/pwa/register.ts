import { observeUpdates } from './updates'

export type PwaStatus = { state: 'disabled' | 'registering' | 'preparing' | 'ready' | 'unsupported' | 'error'; message: string }
let status: PwaStatus = { state: 'disabled', message: '' }
const listeners = new Set<() => void>()
let pending: Promise<void> | null = null
function publish(state: PwaStatus['state'], message: string) {
  status = { state, message }
  for (const listener of listeners) listener()
}
export function subscribePwa(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getPwaStatus() { return status }

export function registerPwa(): Promise<void> {
  if (!import.meta.env.PROD) return Promise.resolve()
  if (pending) return pending
  pending = (async () => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      publish('unsupported', 'Le mode hors connexion n’est pas disponible dans ce navigateur ou sur cette adresse. Utilise HTTPS ou localhost ; Roam reste utilisable en ligne.')
      return
    }
    publish('registering', 'Préparation du mode hors connexion…')
    try {
      const base = new URL(import.meta.env.BASE_URL, document.baseURI)
      if (base.origin !== location.origin || !base.pathname.endsWith('/')) throw new Error('Invalid application base')
      const registration = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname, updateViaCache: 'none' })
      observeUpdates(registration)
      // Only the explicit update protocol may activate a waiting worker.
      if (registration.active) { publish('ready', ''); return }
      const worker = registration.installing ?? registration.waiting
      if (!worker) throw new Error('Worker unavailable after registration')
      publish('preparing', 'Préparation des ressources hors connexion. Garde cette page ouverte quelques instants.')
      function reportError() { publish('error', 'Le service hors connexion a rencontré une erreur. Roam reste utilisable en ligne.') }
      function observe() {
        if (worker!.state === 'activated' || worker!.state === 'redundant') {
          worker!.removeEventListener('statechange', observe)
          worker!.removeEventListener('error', reportError)
          if (worker!.state === 'activated') publish('ready', '')
          else publish('error', 'Le mode hors connexion n’a pas pu être préparé. Roam reste utilisable en ligne ; vérifie la connexion et réessaie.')
        }
      }
      worker.addEventListener('statechange', observe)
      worker.addEventListener('error', reportError)
      observe()
    } catch (error) {
      console.error('Enregistrement du service worker Roam impossible :', error)
      publish('error', 'Impossible d’activer le mode hors connexion. Roam reste utilisable en ligne ; vérifie la connexion et réessaie.')
    }
  })().finally(() => { pending = null })
  return pending
}
