export type UpdateMessage = { type: string; id?: string; ok?: boolean; message?: string }
export type WaitingWorker = { postMessage: (message: UpdateMessage) => void }
export type UpdateSnapshot = {
  phase: 'none' | 'available' | 'checking' | 'activating' | 'deferred' | 'error' | 'reload'
  dismissed: boolean
  message: string
}
type Environment = {
  reason: () => string | null
  reserve: (id: string) => boolean
  release: (id: string) => void
  reload: () => void
  token: () => string
  timer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

export function createUpdateCoordinator(environment: Environment) {
  let waiting: WaitingWorker | null = null
  let snapshot: UpdateSnapshot = { phase: 'none', dismissed: false, message: '' }
  let attempt: { id: string; worker: WaitingWorker; armed: boolean; activated: boolean; timer: ReturnType<typeof setTimeout> } | null = null
  let reloaded = false
  const listeners = new Set<() => void>()
  function publish(phase: UpdateSnapshot['phase'], message: string, dismissed = false) {
    snapshot = { phase, message, dismissed }
    for (const listener of listeners) listener()
  }
  function release() {
    if (!attempt) return
    environment.clear(attempt.timer)
    environment.release(attempt.id)
    attempt = null
  }
  function complete() {
    if (!attempt?.activated || !attempt.armed || reloaded) return
    const blocked = environment.reason()
    if (blocked) { release(); waiting = null; publish('reload', `La nouvelle version est active. ${blocked}`); return }
    reloaded = true
    release()
    waiting = null
    publish('none', '')
    environment.reload()
  }
  function reserve(id: string, worker: WaitingWorker): boolean {
    if ((attempt && attempt.id !== id) || !environment.reserve(id)) return false
    if (!attempt) {
      const timer = environment.timer(() => {
        if (attempt?.id !== id) return
        const changed = attempt.activated
        release()
        if (changed) waiting = null
        publish(changed ? 'reload' : 'error', 'La mise à jour n’a pas abouti. Aucun rechargement forcé ; réessaie quand tous les onglets sont disponibles.')
      }, 15000)
      attempt = { id, worker, timer, armed: false, activated: false }
    }
    return true
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot() { return snapshot },
    hasReservation() { return attempt !== null },
    setWaiting(worker: WaitingWorker) {
      if (waiting === worker) return
      if (attempt?.worker === worker) { waiting = worker; return }
      if (attempt) release()
      waiting = worker
      publish('available', 'Nouvelle version disponible')
    },
    dismiss() { if (!attempt) publish(snapshot.phase, snapshot.message, true) },
    show() { publish(snapshot.phase, snapshot.message) },
    request() {
      if (attempt || reloaded) return
      const reason = environment.reason()
      if (reason) { publish(snapshot.phase === 'reload' ? 'reload' : 'deferred', `Mise à jour reportée. ${reason}`); return }
      if (snapshot.phase === 'reload') {
        reloaded = true
        environment.reload()
        return
      }
      if (!waiting) { publish('error', 'La version en attente n’est plus disponible. Recharge manuellement après avoir terminé tes opérations.'); return }
      const id = environment.token()
      if (!reserve(id, waiting)) { publish('deferred', 'Mise à jour reportée : termine les opérations en cours.'); return }
      publish('checking', 'Vérification des autres onglets…')
      try { waiting.postMessage({ type: 'ROAM_REQUEST_UPDATE', id }) }
      catch { release(); publish('error', 'Impossible de joindre la nouvelle version. Réessaie plus tard.') }
    },
    message(data: UpdateMessage, worker: WaitingWorker) {
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'ROAM_UPDATE_ACTIVATED') {
        // An activation broadcast alone never authorizes a reload.
        if (attempt && attempt.worker === worker) { attempt.activated = true; complete() }
        return
      }
      if (typeof data.id !== 'string') return
      if (data.type === 'ROAM_UPDATE_CHECK') {
        const allowed = !reloaded && reserve(data.id, worker)
        if (allowed) publish('checking', 'Mise à jour demandée : vérification des onglets…')
        worker.postMessage({ type: 'ROAM_UPDATE_VOTE', id: data.id, ok: allowed })
      } else if (attempt?.id === data.id && attempt.worker === worker) {
        if (data.type === 'ROAM_UPDATE_COMMIT') {
          attempt.armed = true
          publish('activating', 'Activation de la nouvelle version…')
          complete()
        } else if (data.type === 'ROAM_UPDATE_RELEASE' || (data.type === 'ROAM_UPDATE_RESULT' && data.ok === false)) {
          release()
          publish('deferred', data.message || 'Mise à jour reportée : un onglet est occupé ou ne répond pas. Termine les opérations puis réessaie.')
        }
      }
    },
    activated() {
      waiting = null
      if (attempt) { attempt.activated = true; complete() }
      else if (!reloaded) publish('reload', 'Une nouvelle version est active. Recharge quand tes opérations sont terminées.')
    },
  }
}
