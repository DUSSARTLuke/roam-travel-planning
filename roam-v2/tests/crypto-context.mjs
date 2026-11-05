// Run from roam-v2: node tests/crypto-context.mjs
// Guard every production source, not just the action that failed on LAN HTTP.
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const root = new URL('../src/', import.meta.url)
async function check(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder)
    if (entry.isDirectory()) await check(url)
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && url.href !== new URL('utils/createId.ts', root).href) {
      assert.doesNotMatch(await readFile(url, 'utf8'), /\brandomUUID\b/, `Native UUID access outside the HTTP-compatible helper: ${url.pathname}`)
    }
  }
}
await check(root)
for (const file of ['App.tsx', 'db/transfers.ts', 'db/automaticRates.ts', 'pwa/updates.ts', 'db/activities.ts', 'db/documents.ts', 'components/program/ActivityAdvancedFields.tsx']) {
  assert.match(await readFile(new URL(file, root), 'utf8'), /import \{ createId \} from /, `Missing shared generator: ${file}`)
}
console.log('Crypto context audit passed: all production UUID consumers use createId; no native UUID access remains outside its feature detection.')
