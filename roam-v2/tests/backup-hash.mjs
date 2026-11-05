// Run: node tests/backup-hash.mjs (Node 24 supports TypeScript directly).
import { createHash, webcrypto } from 'node:crypto'
import assert from 'node:assert/strict'
import { sha256 } from '../src/backup/sha256.ts'
for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 262143, 262144, 262145, 1000000]) {
  const bytes = Uint8Array.from({ length }, (_, i) => (i * 37) % 256)
  const blob = new Blob([bytes])
  const expected = createHash('sha256').update(bytes).digest('hex')
  assert.equal(await sha256(blob, null), expected, `HTTP fallback length ${length}`)
  assert.equal(await sha256(blob, webcrypto.subtle), expected, `Web Crypto length ${length}`)
}
assert.equal(await sha256(new Blob(['abc']), null), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
const original = new Error('digest failure')
await assert.rejects(sha256(new Blob(['test']), { digest: async () => { throw original } }), error => error === original)
const broken = new Blob(['test'])
broken.slice = () => { throw original }
await assert.rejects(sha256(broken, null), error => error === original)
const damaged = await sha256(new Blob(['abd']), null)
assert.notEqual(damaged, await sha256(new Blob(['abc']), null))
console.log('SHA-256: native and HTTP fallback match independent Node oracle, padding/chunk boundaries, binary/empty/1MB, corruption and failures passed.')
