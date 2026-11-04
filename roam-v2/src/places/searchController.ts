import { PLACE_MIN_LENGTH, PLACE_MAX_LENGTH, type PlaceProvider, type PlaceSuggestion } from './photon'

export type PlaceSearchState = { query: string; phase: 'idle' | 'short' | 'waiting' | 'loading' | 'results' | 'empty' | 'error' | 'offline'; results: PlaceSuggestion[]; message: string }
export function createPlaceSearch(provider: PlaceProvider, timers = { set: (callback: () => void, delay: number) => setTimeout(callback, delay), clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer) }) {
  let snapshot: PlaceSearchState = { query: '', phase: 'idle', results: [], message: '' }
  let online = true
  let disposed = false
  let serial = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | null = null
  const listeners = new Set<() => void>()
  function publish(phase: PlaceSearchState['phase'], message: string, results: PlaceSuggestion[] = []) {
    snapshot = { ...snapshot, phase, message, results }
    for (const listener of listeners) listener()
  }
  function cancel() {
    serial++
    if (timer !== undefined) timers.clear(timer)
    timer = undefined
    controller?.abort(); controller = null
  }
  function query(value: string) {
    if (disposed) return
    cancel()
    snapshot = { ...snapshot, query: value }
    if (!online) { publish('offline', 'Recherche indisponible hors connexion. Tu peux saisir le lieu manuellement.'); return }
    const q = value.trim()
    if (!q) { publish('idle', ''); return }
    if (q.length < PLACE_MIN_LENGTH) { publish('short', 'Saisis au moins 3 caractères.'); return }
    if (q.length > PLACE_MAX_LENGTH) { publish('error', 'Recherche trop longue (200 caractères maximum).'); return }
    const ticket = serial
    publish('waiting', 'Recherche en préparation…')
    timer = timers.set(() => {
      timer = undefined
      if (ticket !== serial || disposed || !online) return
      const request = new AbortController()
      controller = request
      publish('loading', 'Recherche en cours…')
      void provider.search(q, request.signal).then((results) => {
        if (ticket !== serial || disposed || request.signal.aborted || !online) return
        publish(results.length ? 'results' : 'empty', results.length ? `${results.length} résultats proposés.` : 'Aucun résultat. Essaie un nom ou une adresse plus précise.', results)
      }, (error: unknown) => {
        if (ticket !== serial || disposed || request.signal.aborted || !online) return
        publish('error', error instanceof Error ? error.message : 'Service de recherche indisponible. La saisie manuelle reste disponible.')
      })
    }, 650)
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot() { return snapshot },
    query,
    setOnline(value: boolean) { if (online === value && (value || snapshot.phase === 'offline')) return; online = value; query(snapshot.query) },
    dismiss() { cancel(); if (!disposed) publish('idle', '') },
    activate() { const wasDisposed = disposed; disposed = false; if (wasDisposed && snapshot.query.trim()) query(snapshot.query) },
    dispose() { cancel(); disposed = true },
  }
}
