import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

const publicFiles = ['manifest.webmanifest', 'favicon.svg', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png']

export function roamPwa(): Plugin {
  return {
    name: 'roam-v2-production-precache', apply: 'build', enforce: 'post',
    // Vite may still rewrite preload imports in normal generateBundle hooks.
    // Hash only after those hooks have finalized HTML, JavaScript and CSS.
    generateBundle: { order: 'post', handler(_options, bundle) {
      const template = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8')
      const files = new Map<string, string | Uint8Array>()
      for (const [path, file] of Object.entries(bundle)) {
        // Optional online map is fetched only when a geolocated activity opens.
        if (/^assets\/(?:maplibrePreview|maplibre-gl-worker)[-.]/.test(path)) continue
        if (path === 'index.html' || (/^assets\//.test(path) && /\.(js|css|svg|png|jpe?g|webp|woff2?|ttf|otf)$/.test(path))) {
          files.set(path, file.type === 'chunk' ? file.code : file.source)
        }
      }
      if (!files.has('index.html')) throw new Error('PWA: index.html absent du build ; précache refusé.')
      for (const path of publicFiles) files.set(path, readFileSync(new URL(`../public/${path}`, import.meta.url)))
      const precache = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({
        path, sha256: createHash('sha256').update(content).digest('hex'),
      }))
      const buildId = createHash('sha256').update(JSON.stringify(precache)).update(template).digest('hex').slice(0, 24)
      const source = template.replace('const PRECACHE = []', `const PRECACHE = ${JSON.stringify(precache)}`)
        .replace("const BUILD_ID = ''", `const BUILD_ID = ${JSON.stringify(buildId)}`)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify({ buildId, entries: precache }, null, 2) })
    } },
  }
}
