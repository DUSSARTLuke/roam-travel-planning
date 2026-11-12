import Dexie, { type Table } from 'dexie'
import { estimateFresh, routingInputKey, RoutingError, validateRoutingEstimate, type RoutingEstimate, type RoutingRequest } from './estimateModel'
import type { RoutingProvider } from './routingProvider'

type Entry = { key: string; estimate?: RoutingEstimate; noRouteUntil?: number; used: number }
type Gate = { key: string; next: number }
/** Deliberately outside RoamDatabase: neither journalled nor exported in ZIP backups. */
export class RoutingCache extends Dexie {
  entries!: Table<Entry, string>
  gates!: Table<Gate, string>
  constructor(name = 'roam-routing-cache-v1') { super(name); this.version(1).stores({ entries: 'key,used', gates: 'key' }) }
}
export function createRoutingService(provider: RoutingProvider, cache: RoutingCache, options: { now?: () => number; online?: () => boolean; spacingMs?: number } = {}) {
  const now = options.now ?? Date.now, online = options.online ?? (() => navigator.onLine)
  const pending = new Map<string, { promise: Promise<RoutingEstimate>; controller: AbortController; users: number }>()
  async function store(entry: Entry) {
    await cache.entries.put(entry)
    const excess = await cache.entries.count() - 1000
    if (excess > 0) await cache.entries.bulkDelete((await cache.entries.orderBy('used').limit(excess).toArray()).map(row => row.key))
  }
  async function calculate(tripId: string, request: RoutingRequest, signal?: AbortSignal): Promise<RoutingEstimate> {
    signal?.throwIfAborted()
    const scope = provider.scope?.() ?? 'local', key = JSON.stringify([provider.namespace, scope, tripId, routingInputKey(request)])
    const read = async () => {
      const row = await cache.entries.get(key)
      if (row?.estimate) {
        try { const value = validateRoutingEstimate(row.estimate, request); if (estimateFresh(value, now())) { await cache.entries.update(key, { used: now() }); return value } } catch { /* discard corrupt cache */ }
      }
      if (row?.noRouteUntil && row.noRouteUntil > now()) throw new RoutingError('no-route')
    }
    const hit = await read(); if (hit) return hit
    if (!online()) throw new RoutingError('offline')
    const controller = pending.get(key)?.controller ?? new AbortController()
    const run = async () => {
      controller.signal.throwIfAborted()
      const secondHit = await read(); if (secondHit) return secondHit
      // Global across tabs of this origin. Server also enforces account-wide quotas.
      const gateKey = provider.namespace
      const delay = await cache.transaction('rw', cache.gates, async () => {
        const next = (await cache.gates.get(gateKey))?.next ?? 0
        if (next - now() > 30_000) throw new RoutingError('quota', Math.ceil((next - now()) / 1000))
        await cache.gates.put({ key: gateKey, next: Math.max(next, now()) + (options.spacingMs ?? 2100) })
        return Math.max(0, next - now())
      })
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      controller.signal.throwIfAborted()
      if (!online()) throw new RoutingError('offline')
      try {
        const estimate = validateRoutingEstimate(await provider.route(request, controller.signal), request)
        if (!estimateFresh(estimate, now())) throw new RoutingError('invalid')
        await store({ key, estimate, used: now() })
        return estimate
      } catch (error) {
        if (error instanceof RoutingError && error.code === 'no-route') await store({ key, noRouteUntil: now() + 300_000, used: now() })
        if (error instanceof RoutingError && error.code === 'quota') await cache.gates.put({ key: gateKey, next: now() + (error.retryAfterSeconds ?? 60) * 1000 })
        throw error
      }
    }
    signal?.throwIfAborted()
    if (!pending.has(key)) {
      const work = typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(`roam-routing:${key}`, { signal: controller.signal }, run) : run()
      pending.set(key, { promise: work.finally(() => pending.delete(key)), controller, users: 0 })
    }
    const job = pending.get(key)!; job.users++
    return new Promise<RoutingEstimate>((resolve, reject) => {
      let finished = false
      const finish = () => { if (finished) return false; finished = true; signal?.removeEventListener('abort', abort); if (--job.users === 0) job.controller.abort(); return true }
      const abort = () => { if (finish()) reject(new DOMException('Calcul annulé.', 'AbortError')) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      job.promise.then(value => { if (finish()) resolve(value) }, reason => { if (finish()) reject(reason) })
    })
  }
  return { calculate }
}
export type RoutingService = ReturnType<typeof createRoutingService>
