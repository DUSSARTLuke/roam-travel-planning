import { activityMapPoint, type MapPoint } from '../src/maps/mapPoint'
import { startMapPreview, type MapPreviewModule, type MapPreviewState } from '../src/maps/previewSession'
import { osmRasterStyle, osmMapRequest, OSM_TILE_URL } from '../src/maps/osmRaster'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
export async function testMapPreviewCore(report: (message: string) => void) {
  const zero = activityMapPoint({ latitude: 0, longitude: 0 })
  assert(zero && zero.latitude === 0 && zero.longitude === 0, 'Zéro exclu de la carte.')
  const negative = activityMapPoint({ latitude: -33.86, longitude: 151.2, location: 'Lieu test' })
  assert(negative?.latitude === -33.86 && negative.longitude === 151.2, 'Coordonnées négatives incorrectes.')
  for (const value of [{}, { latitude: 1 }, { longitude: 1 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }]) assert(activityMapPoint(value) === null, 'Carte créée sans paire valide.')
  const style = osmRasterStyle()
  const source = style.sources.osm
  assert(source.type === 'raster' && source.tiles?.[0] === OSM_TILE_URL && source.maxzoom === 19 && source.tileSize === 256, 'Fond OSM incorrect.')
  const request = osmMapRequest('https://tile.openstreetmap.org/14/1/2.png')
  assert(request.referrerPolicy === 'strict-origin-when-cross-origin' && request.cache === undefined && request.headers === undefined, 'Politique Referer/cache OSM contournée.')
  const states: MapPreviewState[] = []
  let cleanups = 0
  const container = { replaceChildren() { cleanups++ } } as unknown as HTMLElement
  let mounts = 0
  let disposed = 0
  const updates: MapPoint[] = []
  let ready!: (module: MapPreviewModule) => void
  const module: MapPreviewModule = { mountMapPreview(_container, point, notify) {
    mounts++; updates.push(point); notify({ phase: 'ready', message: 'Test' })
    return { update(next) { updates.push(next) }, dispose() { disposed++ } }
  } }
  const initial = { latitude: 51.5, longitude: -0.12, name: 'Initial' }
  const preview = startMapPreview(container, initial, (state) => states.push(state), () => new Promise((resolve) => { ready = resolve }))
  assert(states[0].phase === 'loading' && mounts === 0, 'Chargement différé incorrect.')
  preview.update({ ...initial, name: 'Avant chargement', latitude: 0, longitude: 0 })
  ready(module); await settle()
  assert(Number(mounts) === 1 && updates[0].latitude === 0 && updates[0].longitude === 0 && states.at(-1)?.phase === 'ready', 'Chargement a utilisé une ancienne localisation.')
  preview.update({ ...initial, name: 'Après chargement' })
  assert(updates.at(-1)?.name === 'Après chargement' && Number(mounts) === 1, 'Mise à jour recrée ou perd la carte.')
  preview.dispose(); preview.dispose(); preview.update(initial)
  assert(disposed === 1, 'Nettoyage non idempotent.')
  const oldMounts = mounts
  let late!: (module: MapPreviewModule) => void
  const closed = startMapPreview(container, initial, () => {}, () => new Promise((resolve) => { late = resolve }))
  closed.dispose(); late(module); await settle()
  assert(mounts === oldMounts, 'Carte créée après démontage.')
  const errors: MapPreviewState[] = []
  const failure = startMapPreview(container, initial, (state) => errors.push(state), () => Promise.reject(new Error('Import simulé')))
  await settle(); assert(errors.at(-1)?.phase === 'error', 'Import en erreur masqué.'); failure.dispose()
  const unsupported = startMapPreview(container, initial, (state) => errors.push(state), async () => ({ mountMapPreview() { throw new Error('WebGL simulé') } }))
  await settle(); assert(errors.at(-1)?.phase === 'error' && cleanups === 1, 'Échec WebGL non nettoyé.'); unsupported.dispose()
  let timeoutDisposals = 0
  const timeout = startMapPreview(container, initial, (state) => errors.push(state), async () => ({ mountMapPreview() { return { update() {}, dispose() { timeoutDisposals++ } } } }), 1)
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert(errors.at(-1)?.phase === 'error' && timeoutDisposals === 1, 'Tuiles sans réponse : timeout/nettoyage incorrect.'); timeout.dispose()
  let neverReady!: (module: MapPreviewModule) => void
  const slow = startMapPreview(container, initial, (state) => errors.push(state), () => new Promise((resolve) => { neverReady = resolve }), 1)
  await new Promise((resolve) => setTimeout(resolve, 10)); neverReady(module); await settle(); slow.dispose()
  assert(mounts === oldMounts, 'Import tardif créé après timeout.')
  report('Carte : coordonnées/absence/zéro/négatifs, fond OSM, cache/Referer, chargement différé, mise à jour, erreurs, timeout et nettoyage (sans réseau/WebGL).')
}
