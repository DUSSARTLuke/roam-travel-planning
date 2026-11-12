import { boundedJson, RoutingError, retrySeconds, validateRoutingEstimate, validateRoutingRequest, type RoutingRequest, type RoutingEstimate } from './estimateModel'
export type RoutingProvider = { namespace: string; scope?: () => string; route: (input: RoutingRequest, signal: AbortSignal) => Promise<RoutingEstimate> }
export function safeRelayUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname || /(?:openrouteservice|api\.heigit)\./i.test(url.hostname)) throw new RoutingError('disabled')
  return url.href
}
export function createRelayProvider(url: string, token: () => string | undefined, options: { fetcher?: typeof fetch; now?: () => number; scope?: () => string; timeoutMs?: number } = {}): RoutingProvider {
  const endpoint = safeRelayUrl(url), fetcher = options.fetcher ?? ((...args) => fetch(...args)), now = options.now ?? Date.now
  return { namespace: endpoint, scope: options.scope, async route(input, signal) {
    const request = validateRoutingRequest(input), accessToken = token()
    if (!accessToken) throw new RoutingError('auth')
    const controller = new AbortController(); let timedOut = false
    const abort = () => controller.abort(); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs ?? 10_000)
    try {
      const response = await fetcher(endpoint, { method: 'POST', signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(request) })
      if (response.status === 401 || response.status === 403) throw new RoutingError('auth')
      if (response.status === 429) throw new RoutingError('quota', retrySeconds(response, now()))
      if (response.status === 404 || response.status === 422) throw new RoutingError('no-route')
      if (!response.ok) throw new RoutingError('unavailable')
      return validateRoutingEstimate(await boundedJson(response), request)
    } catch (error) {
      if (signal.aborted) throw new DOMException('Calcul annulé.', 'AbortError')
      if (timedOut) throw new RoutingError('timeout')
      if (error instanceof RoutingError) throw error
      throw new RoutingError('unavailable')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  } }
}
