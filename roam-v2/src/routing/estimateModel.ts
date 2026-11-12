export const ROUTING_TTL = 7 * 24 * 60 * 60 * 1000
export const ROUTING_ATTRIBUTION = '© openrouteservice by HeiGIT | Data from OpenStreetMap'
export type RoutingProfile = 'foot-walking' | 'cycling-regular' | 'driving-car'
export type RoutingRequest = { version: 1; profile: RoutingProfile; coordinates: [[number, number], [number, number]] }
export type RoutingEstimate = {
  version: 1; provider: 'openrouteservice'; profile: RoutingProfile; inputKey: string
  durationSeconds: number; distanceMeters: number; calculatedAt: string; expiresAt: string; licence: 'CC-BY-SA-4.0'
}
export type RoutingErrorCode = 'disabled' | 'unsupported' | 'coordinates' | 'offline' | 'auth' | 'quota' | 'unavailable' | 'no-route' | 'invalid' | 'timeout'
export class RoutingError extends Error {
  readonly code: RoutingErrorCode
  readonly retryAfterSeconds?: number
  constructor(code: RoutingErrorCode, retryAfterSeconds?: number) { super(code); this.name = 'RoutingError'; this.code = code; this.retryAfterSeconds = retryAfterSeconds }
}
export function profileForMode(mode: string): RoutingProfile | undefined {
  return mode === 'walk' ? 'foot-walking' : mode === 'bicycle' ? 'cycling-regular' : mode === 'car' ? 'driving-car' : undefined
}
export function validateRoutingRequest(value: unknown): RoutingRequest {
  const input = value as RoutingRequest
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['version', 'profile', 'coordinates'].includes(key)) || input.version !== 1 || !['foot-walking', 'cycling-regular', 'driving-car'].includes(input.profile)) throw new RoutingError('invalid')
  if (!Array.isArray(input.coordinates) || input.coordinates.length !== 2 || input.coordinates.some(point => !Array.isArray(point) || point.length !== 2 || point.some(number => typeof number !== 'number' || !Number.isFinite(number)) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) throw new RoutingError('coordinates')
  return { version: 1, profile: input.profile, coordinates: input.coordinates.map(point => [...point]) as RoutingRequest['coordinates'] }
}
export function routingInputKey(input: RoutingRequest): string { return JSON.stringify(validateRoutingRequest(input)) }
export function activityRoutingRequest(from: { latitude?: number; longitude?: number }, to: { latitude?: number; longitude?: number }, mode: string): RoutingRequest {
  const profile = profileForMode(mode)
  if (!profile) throw new RoutingError('unsupported')
  if (from.latitude === undefined || from.longitude === undefined || to.latitude === undefined || to.longitude === undefined) throw new RoutingError('coordinates')
  return validateRoutingRequest({ version: 1, profile, coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]] })
}
export function validateRoutingEstimate(value: unknown, request?: RoutingRequest): RoutingEstimate {
  const estimate = value as RoutingEstimate
  if (!estimate || typeof estimate !== 'object' || Object.keys(estimate).some(key => !['version', 'provider', 'profile', 'inputKey', 'durationSeconds', 'distanceMeters', 'calculatedAt', 'expiresAt', 'licence'].includes(key)) || estimate.version !== 1 || estimate.provider !== 'openrouteservice' || estimate.licence !== 'CC-BY-SA-4.0' || typeof estimate.inputKey !== 'string' || estimate.inputKey.length > 500) throw new RoutingError('invalid')
  let input: RoutingRequest
  try { input = validateRoutingRequest(JSON.parse(estimate.inputKey)) } catch { throw new RoutingError('invalid') }
  if (estimate.inputKey !== routingInputKey(input) || estimate.profile !== input.profile || request && estimate.inputKey !== routingInputKey(request)) throw new RoutingError('invalid')
  for (const number of [estimate.durationSeconds, estimate.distanceMeters]) if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100_000_000) throw new RoutingError('invalid')
  for (const timestamp of [estimate.calculatedAt, estimate.expiresAt]) if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) throw new RoutingError('invalid')
  const ttl = Date.parse(estimate.expiresAt) - Date.parse(estimate.calculatedAt)
  if (ttl <= 0 || ttl > ROUTING_TTL) throw new RoutingError('invalid')
  return { ...estimate }
}
export function makeRoutingEstimate(request: RoutingRequest, seconds: number, meters: number, now: number): RoutingEstimate {
  return validateRoutingEstimate({ version: 1, provider: 'openrouteservice', profile: request.profile, inputKey: routingInputKey(request), durationSeconds: seconds, distanceMeters: meters, calculatedAt: new Date(now).toISOString(), expiresAt: new Date(now + ROUTING_TTL).toISOString(), licence: 'CC-BY-SA-4.0' }, request)
}
export function estimateFresh(estimate: RoutingEstimate, now: number): boolean { return now >= Date.parse(estimate.calculatedAt) && now < Date.parse(estimate.expiresAt) }
export const estimatedMinutes = (estimate: RoutingEstimate) => Math.ceil(estimate.durationSeconds / 60)

export async function boundedJson(response: Response, limit = 32_768): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit || !response.body) throw new RoutingError('invalid')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new RoutingError('invalid'); chunks.push(value) }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length }
  try { return JSON.parse(new TextDecoder().decode(all)) } catch { throw new RoutingError('invalid') }
}
export function retrySeconds(response: Response, now: number): number {
  const value = response.headers.get('retry-after') ?? '', numeric = Number(value)
  const seconds = value.trim() && Number.isFinite(numeric) ? numeric : (Date.parse(value) - now) / 1000
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : 60
}
