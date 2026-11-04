import type { MapPoint } from './mapPoint'

export type MapPreviewState = { phase: 'loading' | 'ready' | 'error'; message: string }
export type MapPreviewHandle = { update: (point: MapPoint) => void; dispose: () => void }
export type MapPreviewModule = { mountMapPreview: (container: HTMLElement, point: MapPoint, notify: (state: MapPreviewState) => void) => MapPreviewHandle }
export type MapPreviewLoader = () => Promise<MapPreviewModule>
export const loadMapPreview: MapPreviewLoader = () => import('./maplibrePreview')

// Does not own React or IndexedDB; inject a renderer to test lifecycle without
// WebGL or real tile requests. A disposed/expired session never mounts late code.
export function startMapPreview(container: HTMLElement, initialPoint: MapPoint, notify: (state: MapPreviewState) => void, load: MapPreviewLoader = loadMapPreview, timeoutMs = 20000): MapPreviewHandle {
  let point = initialPoint
  let live = true
  let expired = false
  let handle: MapPreviewHandle | null = null
  let timer: ReturnType<typeof setTimeout>
  function arm() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!live) return
      expired = true
      handle?.dispose(); handle = null
      notify({ phase: 'error', message: 'La carte ne répond pas. Les informations de localisation restent disponibles ci-dessus.' })
    }, timeoutMs)
  }
  arm()
  function report(state: MapPreviewState) {
    if (!live || expired) return
    if (state.phase !== 'loading') clearTimeout(timer)
    notify(state)
  }
  notify({ phase: 'loading', message: 'Chargement de la carte…' })
  void load().then((module) => {
    if (!live || expired) return
    try { handle = module.mountMapPreview(container, point, report) }
    catch { container.replaceChildren(); report({ phase: 'error', message: 'La carte ne peut pas s’afficher (WebGL ou ressources indisponibles). Les coordonnées restent lisibles.' }) }
  }, () => report({ phase: 'error', message: 'Le module cartographique ne peut pas être chargé. Les coordonnées restent lisibles.' }))
  return {
    update(next) {
      const moved = next.latitude !== point.latitude || next.longitude !== point.longitude
      point = next
      if (!live || expired) return
      if (moved) arm()
      try { handle?.update(next) } catch { report({ phase: 'error', message: 'La carte ne peut pas afficher ce lieu. Les coordonnées restent disponibles.' }) }
    },
    dispose() { if (!live) return; live = false; clearTimeout(timer); handle?.dispose(); handle = null },
  }
}
