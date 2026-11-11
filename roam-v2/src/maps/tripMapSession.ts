import type { TripMapOptions } from './tripMapView'
import type { MapLink } from './tripMapTransfers'
import type { TripMapPoint } from './tripMapModel'
import type { MapPreviewState } from './previewSession'
export type TripMapState = MapPreviewState & { interactive?: boolean }
export type TripMapHandle = { update: (points: readonly TripMapPoint[]) => void; recenter: () => void; resize?: () => void; select?: (id: string | null) => void; transfers?: (links: readonly MapLink[], selected: string | null) => void; dispose: () => void }
export type TripMapModule = { mountTripMap: (container: HTMLElement, points: readonly TripMapPoint[], notify: (state: TripMapState) => void, onSelect?: (ids: string[]) => void, onTransferSelect?: (ids: string[]) => void, options?: TripMapOptions) => TripMapHandle }
export type TripMapLoader = () => Promise<TripMapModule>
// Same lazy adapter/worker as the individual preview; no eager MapLibre import.
export const loadTripMap: TripMapLoader = () => import('./maplibrePreview')
export function startTripMap(container: HTMLElement, initial: readonly TripMapPoint[], notify: (state: TripMapState) => void, load: TripMapLoader = loadTripMap, timeoutMs = 20000, onSelect?: (ids: string[]) => void, onTransferSelect?: (ids: string[]) => void, options?: TripMapOptions): TripMapHandle {
  let links: readonly MapLink[] = []; let selectedTransfer: string | null = null
  let selected: string | null = null
  let points = initial; let live = true; let expired = false; let handle: TripMapHandle | null = null
  let timer: ReturnType<typeof setTimeout>
  function report(state: TripMapState) { if (!live || expired) return; if (state.phase !== 'loading') clearTimeout(timer); notify(state) }
  function arm() {
    clearTimeout(timer)
    timer = setTimeout(() => { if (!live) return; expired = true; handle?.dispose(); handle = null
      notify({ phase: 'error', interactive: false, message: 'La carte ne répond pas. La liste des lieux reste disponible.' }) }, timeoutMs)
  }
  arm(); report({ phase: 'loading', message: 'Chargement de la carte du voyage…' })
  void load().then((module) => {
    if (!live || expired) return
    try { handle = module.mountTripMap(container, points, report, (ids) => { if (live && !expired) onSelect?.(ids) }, (ids) => { if (live && !expired) onTransferSelect?.(ids) }, options); handle.select?.(selected); handle.transfers?.(links, selectedTransfer) }
    catch { container.replaceChildren(); report({ phase: 'error', interactive: false, message: 'La carte ne peut pas s’afficher (WebGL ou ressources indisponibles). La liste reste accessible.' }) }
  }, () => report({ phase: 'error', interactive: false, message: 'Le module cartographique ne peut pas être chargé. La liste des lieux reste accessible.' }))
  return {
    update(next) { points = next; if (!live || expired) return; try { handle?.update(next) } catch { report({ phase: 'error', interactive: false, message: 'Impossible d’actualiser les marqueurs. La liste des lieux reste disponible.' }) } },
    transfers(next, id) { links = next; selectedTransfer = id; if (live && !expired) handle?.transfers?.(next, id) },
    resize() { if (live && !expired) handle?.resize?.() },
    select(id) { selected = id; if (live && !expired) handle?.select?.(id) },
    recenter() { if (!live || expired || !handle) return; arm(); try { handle.recenter() } catch { report({ phase: 'error', interactive: false, message: 'Impossible de recentrer la carte.' }) } },
    dispose() { if (!live) return; live = false; clearTimeout(timer); handle?.dispose(); handle = null },
  }
}
