type IdentifierCrypto = Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>>

// randomUUID is HTTPS/localhost-only in browsers. getRandomValues remains
// available on LAN HTTP and provides the same cryptographic entropy for UUID v4.
// Never fall back to Math.random, a timestamp, or a predictable counter.
export function createId(source: IdentifierCrypto | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') throw new Error('Impossible de créer un identifiant fiable dans ce navigateur. Aucun nouvel élément enregistré ; utilise un navigateur compatible ou une adresse HTTPS.')
  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
