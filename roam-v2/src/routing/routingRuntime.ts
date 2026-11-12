import { createRelayProvider, safeRelayUrl } from './routingProvider'
import { createRoutingService, RoutingCache } from './routingService'
import { RoutingError } from './estimateModel'
import { createRoutingAuth } from './routingAuth'

// All VITE values are public. ORS/service-role secrets must never be VITE variables.
const env = import.meta.env
let auth: ReturnType<typeof createRoutingAuth> | undefined
function authentication() { return auth ??= createRoutingAuth(env.VITE_ROUTING_AUTH_URL, env.VITE_ROUTING_PUBLISHABLE_KEY) }
let runtime: ReturnType<typeof createRoutingService> | undefined
export function routingConfigured(): boolean {
  try { return !!(safeRelayUrl(env.VITE_ROUTING_RELAY_URL ?? '') && safeRelayUrl(env.VITE_ROUTING_AUTH_URL ?? '') && env.VITE_ROUTING_PUBLISHABLE_KEY) } catch { return false }
}
export async function routingSignIn(email: string, password: string): Promise<void> {
  if (!routingConfigured()) throw new RoutingError('disabled')
  await authentication().signIn(email, password)
}
export function routingSignOut() { auth?.signOut() }
export function routingAuthenticated() { return auth?.authenticated() ?? false }
export function configuredRoutingService() {
  if (!routingConfigured()) return undefined
  return runtime ??= createRoutingService(createRelayProvider(env.VITE_ROUTING_RELAY_URL, () => authentication().token(), { scope: () => authentication().scope() }), new RoutingCache())
}
