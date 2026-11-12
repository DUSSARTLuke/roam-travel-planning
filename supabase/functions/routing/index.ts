// Optional deployment source, never executed by Roam or its test suite.
// The gateway must permit preflight; this handler independently verifies every JWT.
import { routingHandler } from '../_shared/routing.ts'
const env = (name: string) => Deno.env.get(name) ?? ''
const base = env('SUPABASE_URL').replace(/\/$/, '')
const secret = env('SUPABASE_SERVICE_ROLE_KEY'), ors = env('ORS_API_KEY')
const users = env('ROUTING_ALLOWED_USER_IDS').split(',').map(value => value.trim()).filter(Boolean)
const origins = env('ROUTING_ALLOWED_ORIGINS').split(',').map(value => value.trim()).filter(value => /^https:\/\//.test(value) && new URL(value).origin === value)
const ready = !!(base.startsWith('https://') && secret && ors && users.length && origins.length)
Deno.serve(routingHandler({
  origins: ready ? origins : [],
  async authenticate(token) {
    const response = await fetch(`${base}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (!response.ok) return undefined
    const user = await response.json()
    return typeof user.id === 'string' && users.includes(user.id) ? user.id : undefined
  },
  async reserve(user) {
    const response = await fetch(`${base}/rest/v1/rpc/reserve_routing_call`, { method: 'POST', headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ caller: user }), signal: AbortSignal.timeout(5000), redirect: 'error' })
    return response.ok && await response.json() === true
  },
  directions: (request, signal) => fetch(`https://api.heigit.org/openrouteservice/v2/directions/${request.profile}/json`, { method: 'POST', headers: { Authorization: ors, 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: request.coordinates, geometry: false, instructions: false }), signal, redirect: 'error' }),
}))
