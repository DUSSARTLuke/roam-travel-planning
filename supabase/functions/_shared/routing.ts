import { boundedJson, makeRoutingEstimate, retrySeconds, RoutingError, validateRoutingRequest, type RoutingRequest } from '../../../roam-v2/src/routing/estimateModel.ts'

export type RelayDependencies = {
  origins: string[]
  authenticate: (token: string) => Promise<string | undefined>
  reserve: (user: string) => Promise<boolean>
  directions: (request: RoutingRequest, signal: AbortSignal) => Promise<Response>
  now?: () => number
  timeoutMs?: number
}
/** No logging of coordinates, credentials, provider bodies or account identifiers. */
export function routingHandler(deps: RelayDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? '', allowed = deps.origins.includes(origin)
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' })
    if (allowed) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Access-Control-Allow-Headers', 'authorization,content-type'); headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS'); headers.set('Access-Control-Expose-Headers', 'Retry-After') }
    const reply = (status: number, code: string) => new Response(JSON.stringify({ error: code }), { status, headers })
    if (!allowed) return reply(403, 'forbidden')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return reply(405, 'method')
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415, 'content-type')
    const token = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!token) return reply(401, 'auth')
    try {
      const user = await deps.authenticate(token)
      if (!user) return reply(403, 'auth')
      const input = validateRoutingRequest(await boundedJson(new Response(request.body, { headers: request.headers }), 2048))
      if (!await deps.reserve(user)) { headers.set('Retry-After', '60'); return reply(429, 'quota') }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8000)
      try {
        const result = await deps.directions(input, controller.signal)
        if (result.status === 429) { headers.set('Retry-After', String(retrySeconds(result, (deps.now ?? Date.now)()))); return reply(429, 'quota') }
        if (result.status === 404 || result.status === 422) return reply(422, 'no-route')
        if (!result.ok) return reply(503, 'unavailable')
        const body = await boundedJson(result) as { routes?: { summary?: { duration?: number; distance?: number } }[] }
        const summary = body.routes?.[0]?.summary
        if (!summary || typeof summary.duration !== 'number' || typeof summary.distance !== 'number') return reply(502, 'invalid')
        return new Response(JSON.stringify(makeRoutingEstimate(input, summary.duration, summary.distance, (deps.now ?? Date.now)())), { status: 200, headers })
      } finally { clearTimeout(timer) }
    } catch (reason) { return reply(reason instanceof RoutingError ? 400 : 503, reason instanceof RoutingError ? 'invalid' : 'unavailable') }
  }
}
