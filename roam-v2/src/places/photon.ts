import { validateCoordinates } from '../db/activityLocation'

export type PlaceSuggestion = { id: string; name: string; address: string; city: string; country: string; latitude: number; longitude: number }
export type PlaceProvider = { search: (query: string, signal: AbortSignal) => Promise<PlaceSuggestion[]> }
export const PLACE_MIN_LENGTH = 3
export const PLACE_MAX_LENGTH = 200
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse de recherche invalide.')
  return value as Record<string, unknown>
}
export function parsePhotonResults(value: unknown): PlaceSuggestion[] {
  const collection = record(value)
  if ((collection.type !== undefined && collection.type !== 'FeatureCollection') || !Array.isArray(collection.features) || collection.features.length > 20) throw new Error('Réponse de recherche invalide.')
  return collection.features.map((raw, index) => {
    const feature = record(raw)
    const geometry = record(feature.geometry)
    if (feature.type !== 'Feature' || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 2) throw new Error('Coordonnées du résultat invalides.')
    const [longitude, latitude] = geometry.coordinates
    const coordinates = validateCoordinates(latitude, longitude)
    if (coordinates.latitude === undefined || coordinates.longitude === undefined) throw new Error('Coordonnées du résultat absentes.')
    const properties = record(feature.properties)
    function text(key: string) {
      const value = properties[key]
      if (value === undefined || value === null) return ''
      if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Libellé du résultat invalide.')
      return value.trim()
    }
    const city = text('city') || text('town') || text('village') || text('locality')
    const country = text('country')
    const street = [text('housenumber'), text('street')].filter(Boolean).join(' ')
    const district = text('district')
    const postalCity = [text('postcode'), city].filter(Boolean).join(' ')
    const parts = [street, district, postalCity, text('state'), country].filter(Boolean)
    const address = [...new Set(parts)].join(', ')
    const name = text('name') || street || city || district || country || address
    if (!name) throw new Error('Résultat sans nom ni adresse exploitable.')
    return { id: `photon-${index}`, name, address, city, country, latitude: coordinates.latitude, longitude: coordinates.longitude }
  }).slice(0, 5)
}
function cancelled() { return new DOMException('Recherche annulée.', 'AbortError') }
function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delay)
    function abort() { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()) }
    signal.addEventListener('abort', abort, { once: true })
  })
}
export function createPhotonProvider(fetcher: typeof fetch = (...args: Parameters<typeof fetch>) => fetch(...args), now: () => number = () => Date.now(), options: { timeoutMs?: number } = {}): PlaceProvider {
  let nextRequestAt = 0
  let cooldownUntil = 0
  const cache = new Map<string, { at: number; results: PlaceSuggestion[] }>()
  return {
    async search(query, signal) {
      const q = query.trim()
      if (q.length < PLACE_MIN_LENGTH || q.length > PLACE_MAX_LENGTH) return []
      if (signal.aborted) throw cancelled()
      const key = q.toLocaleLowerCase('fr')
      const cached = cache.get(key)
      if (cached && now() >= cached.at && now() - cached.at < 300000) return cached.results.map((item) => ({ ...item }))
      if (now() < cooldownUntil) throw new Error('Service temporairement limité. Réessaie plus tard ; la saisie manuelle reste disponible.')
      while (now() < nextRequestAt) await wait(nextRequestAt - now(), signal)
      if (signal.aborted) throw cancelled()
      // Another in-flight request may have imposed a server cooldown.
      if (now() < cooldownUntil) throw new Error('Service temporairement limité. Réessaie plus tard.')
      nextRequestAt = now() + 1500
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, Math.max(1, Math.min(10000, options.timeoutMs ?? 10000)))
      try {
        const url = new URL('https://photon.komoot.io/api/')
        url.searchParams.set('q', q); url.searchParams.set('lang', 'fr'); url.searchParams.set('limit', '5')
        const response = await fetcher(url.href, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { Accept: 'application/json' } })
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')
          const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN
          const retryAt = Number.isFinite(seconds) && seconds >= 0 ? now() + seconds * 1000 : retryAfter ? Date.parse(retryAfter) : NaN
          cooldownUntil = Math.max(now() + 60000, Number.isFinite(retryAt) ? retryAt : 0)
          throw new Error('Service temporairement limité. Attends avant de réessayer.')
        }
        if (!response.ok || response.redirected) throw new Error(`Service de recherche indisponible (HTTP ${response.status}).`)
        if (!/^application\/(?:json|geo\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Le service a renvoyé une réponse non JSON.')
        const text = await response.text()
        if (text.length > 131072) throw new Error('Réponse de recherche trop volumineuse.')
        let data: unknown
        try { data = JSON.parse(text) } catch { throw new Error('Réponse JSON du service invalide.') }
        const results = parsePhotonResults(data)
        if (signal.aborted) throw cancelled()
        cache.set(key, { at: now(), results })
        if (cache.size > 20) cache.delete(cache.keys().next().value!)
        return results.map((item) => ({ ...item }))
      } catch (error) {
        if (signal.aborted) throw cancelled()
        if (timedOut) throw new Error('Le service de recherche ne répond pas. Réessaie plus tard.')
        if (error instanceof TypeError) throw new Error('Recherche inaccessible : vérifie la connexion. La saisie manuelle reste disponible.')
        throw error
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    },
  }
}
// Shared across components in this tab. No persistent cache or background request.
export const photonProvider = createPhotonProvider()
