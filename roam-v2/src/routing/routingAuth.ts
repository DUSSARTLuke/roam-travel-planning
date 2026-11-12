import { boundedJson, RoutingError } from './estimateModel'
import { safeRelayUrl } from './routingProvider'
/** Optional Supabase session; no storage, refresh token, sign-up or background refresh. */
export function createRoutingAuth(baseUrl: string, publishableKey: string, fetcher: typeof fetch = (...args) => fetch(...args), now = Date.now) {
  const base = safeRelayUrl(baseUrl).replace(/\/$/, '')
  let session: { token: string; user: string; expires: number } | undefined
  const authenticated = () => !!session && session.expires > now()
  return {
    authenticated,
    token: () => authenticated() ? session?.token : undefined,
    scope: () => session?.user ?? 'signed-out',
    signOut: () => { session = undefined },
    async signIn(email: string, password: string) {
      const response = await fetcher(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { apikey: publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      if (!response.ok) throw new RoutingError('auth')
      const data = await boundedJson(response) as { access_token?: string; expires_in?: number; user?: { id?: string } }
      if (typeof data.access_token !== 'string' || !data.access_token || typeof data.user?.id !== 'string' || !data.user.id || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new RoutingError('auth')
      session = { token: data.access_token, user: data.user.id, expires: now() + data.expires_in * 1000 }
    },
  }
}
