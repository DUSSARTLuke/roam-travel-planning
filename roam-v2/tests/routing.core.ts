import assert from 'node:assert/strict'
import { activityRoutingRequest, boundedJson, estimateFresh, estimatedMinutes, makeRoutingEstimate, profileForMode, ROUTING_TTL, routingInputKey, RoutingError, validateRoutingEstimate, validateRoutingRequest } from '../src/routing/estimateModel'
import { createRelayProvider, safeRelayUrl } from '../src/routing/routingProvider'
import { createRoutingAuth } from '../src/routing/routingAuth'
import { readFileSync } from 'node:fs'
import { routingHandler } from '../../supabase/functions/_shared/routing.ts'
import { assertJourney } from '../src/evolution/v21/contracts'
import { connectionActivity, connectionJourney } from './activityConnections.core'

const request = validateRoutingRequest({ version: 1, profile: 'foot-walking', coordinates: [[2, 48], [2.1, 48.1]] })
const now = Date.now(), estimate = makeRoutingEstimate(request, 601, 1234, now)
assert.equal(estimatedMinutes(estimate), 11)
assert(estimateFresh(estimate, now)); assert(!estimateFresh(estimate, now + ROUTING_TTL)); assert(!estimateFresh(estimate, now - 1))
assert.notEqual(routingInputKey(request), routingInputKey({ ...request, coordinates: [...request.coordinates].reverse() }))
for (const mode of ['taxi', 'public_transport', 'train', 'plane', 'other']) assert.equal(profileForMode(mode as never), undefined)
assert.equal(profileForMode('bicycle'), 'cycling-regular'); assert.equal(profileForMode('car'), 'driving-car')
for (const bad of [{ ...request, profile: 'train' }, { ...request, url: 'https://private.invalid' }, { ...request, coordinates: [[181, 1], [0, 0]] }, { ...request, coordinates: [[0, NaN], [0, 0]] }]) assert.throws(() => validateRoutingRequest(bad))
for (const bad of [{ ...estimate, durationSeconds: -1 }, { ...estimate, distanceMeters: Infinity }, { ...estimate, calculatedAt: 'bad' }, { ...estimate, expiresAt: new Date(now + ROUTING_TTL + 1).toISOString() }, { ...estimate, licence: 'wrong' }, { ...estimate, token: 'forbidden' }]) assert.throws(() => validateRoutingEstimate(bad))
assert.throws(() => validateRoutingEstimate(estimate, { ...request, profile: 'driving-car' }))
const a = { ...connectionActivity('a'), longitude: 2, latitude: 48 }, b = { ...connectionActivity('b', '10:30'), longitude: 2.1, latitude: 48.1 }
assert.deepEqual(activityRoutingRequest(a, b, 'walk'), request)
assert.throws(() => activityRoutingRequest(connectionActivity('missing'), b, 'walk'))
const journey = connectionJourney(a, b, ['alice']); journey.segments[0].routingEstimate = estimate
assertJourney(journey); assert.equal(journey.segments[0].durationMinutes, 15)
const automatic = structuredClone(journey); automatic.segments[0].durationSource = 'automatic'; automatic.segments[0].durationMinutes = 11; assertJourney(automatic)
automatic.stops[0].place.longitude = 3; assert.throws(() => assertJourney(automatic))
for (const url of ['http://relay.invalid/x', 'https://secret@relay.invalid/x', 'https://relay.invalid/x?key=secret', 'https://api.heigit.org/x', 'https://api.openrouteservice.org/x']) assert.throws(() => safeRelayUrl(url))
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
await assert.rejects(() => boundedJson(response('x'.repeat(40)), 20))
let calls = 0
const provider = createRelayProvider('https://relay.invalid/routing', () => 'test-session', { now: () => now, fetcher: async (url, init) => {
  calls++; assert.equal(url, 'https://relay.invalid/routing'); assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-session'); assert.deepEqual(JSON.parse(String(init?.body)), request)
  return response(estimate)
} })
assert.deepEqual(await provider.route(request, new AbortController().signal), estimate); assert.equal(calls, 1)
await assert.rejects(() => createRelayProvider('https://relay.invalid/x', () => undefined, { fetcher: async () => { throw Error('Must not fetch') } }).route(request, new AbortController().signal), (e: RoutingError) => e.code === 'auth')
for (const [status, code] of [[401, 'auth'], [403, 'auth'], [404, 'no-route'], [422, 'no-route'], [429, 'quota'], [503, 'unavailable']] as const) {
  await assert.rejects(() => createRelayProvider('https://relay.invalid/x', () => 'session', { fetcher: async () => new Response('', { status, headers: { 'Retry-After': '120' } }) }).route(request, new AbortController().signal), (e: RoutingError) => e.code === code && (status !== 429 || e.retryAfterSeconds === 120))
}
await assert.rejects(() => createRelayProvider('https://relay.invalid/x', () => 'session', { timeoutMs: 5, fetcher: async (_, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(Error('aborted')))) }).route(request, new AbortController().signal), (e: RoutingError) => e.code === 'timeout')
const abort = new AbortController()
const aborted = createRelayProvider('https://relay.invalid/x', () => 'session', { fetcher: async (_, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(Error('aborted')))) }).route(request, abort.signal)
abort.abort(); await assert.rejects(() => aborted, { name: 'AbortError' })
let reservations = 0, upstream = 0, authorized = true, quota = true, status = 200
const handler = routingHandler({ origins: ['https://roam.invalid'], now: () => now, authenticate: async token => token === 'session' && authorized ? 'user-test' : undefined, reserve: async () => { reservations++; return quota }, directions: async (body) => { upstream++; assert.deepEqual(body, request); return response(status === 200 ? { routes: [{ summary: { duration: 601, distance: 1234 } }] } : { private: 'never expose' }, status) } })
const call = (changes: { origin?: string; token?: string; method?: string; body?: unknown } = {}) => handler(new Request('https://relay.invalid/routing', { method: changes.method ?? 'POST', headers: { Origin: changes.origin ?? 'https://roam.invalid', Authorization: `Bearer ${changes.token ?? 'session'}`, 'Content-Type': 'application/json' }, ...((changes.method ?? 'POST') === 'POST' ? { body: JSON.stringify(changes.body ?? request) } : {}) }))
assert.equal((await call({ method: 'OPTIONS' })).status, 204)
assert.equal((await call({ origin: 'https://evil.invalid' })).status, 403)
assert.equal((await call({ token: 'bad' })).status, 403)
assert.equal((await call({ body: { ...request, url: 'private' } })).status, 400)
assert.equal(upstream, 0); assert.equal(reservations, 0)
const ok = await call(); assert.deepEqual(await ok.json(), estimate); assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://roam.invalid')
quota = false; assert.equal((await call()).status, 429); assert.equal(upstream, 1); quota = true
for (const code of [404, 422, 429, 500]) { status = code; const result = await call(); assert.equal(result.status, code === 404 ? 422 : code === 500 ? 503 : code); assert(!JSON.stringify(await result.json()).includes('private')) }
authorized = false; assert.equal((await call()).status, 403)
console.log('PASS B2: contracts/profiles/coordinates/freshness/manual priority; relay auth/CORS/quota/sanitization; provider timeout/cancellation/429; no external request')
let authClock = now
const auth = createRoutingAuth('https://auth.invalid', 'public-test', async (url, init) => { assert.equal(url, 'https://auth.invalid/auth/v1/token?grant_type=password'); assert.equal(new Headers(init?.headers).get('apikey'), 'public-test'); assert.deepEqual(JSON.parse(String(init?.body)), { email: 'temporary@example.invalid', password: 'fake-test-password' }); return response({ access_token: 'fake-access', user: { id: 'temporary-user' }, expires_in: 60, refresh_token: 'must-not-retain' }) }, () => authClock)
assert.equal(auth.token(), undefined); await auth.signIn('temporary@example.invalid', 'fake-test-password'); assert.equal(auth.scope(), 'temporary-user'); assert.equal(auth.token(), 'fake-access')
assert(!JSON.stringify(auth).includes('fake-access')); authClock += 60_000; assert.equal(auth.token(), undefined); auth.signOut(); assert.equal(auth.scope(), 'signed-out')
await assert.rejects(() => createRoutingAuth('https://auth.invalid', 'public-test', async () => response({}, 401)).signIn('', ''))
const sql = readFileSync(new URL('../../supabase/migrations/202611120001_routing_quota.sql', import.meta.url), 'utf8')
for (const required of ['pg_advisory_xact_lock', "interval '24 hours'", "interval '1 minute'", '>= 30', '>= 1800', '>= 300', 'enable row level security', 'from public, anon, authenticated', 'to service_role']) assert(sql.includes(required), `SQL guard missing ${required}`)
console.log('PASS B2: optional auth mocked, session expiry/sign-out/no persistent tokens; SQL security guards inspected (not a PostgreSQL execution)')
