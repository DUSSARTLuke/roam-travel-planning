import type { TripMapNavigation } from './tripMapNavigation'

export type TripMapCamera = { longitude: number; latitude: number; zoom: number }
export type TripMapView = { filterKey: string; camera?: TripMapCamera; selection: string[]; transferSelection: string[]; expanded: boolean }
export type TripMapOptions = { camera?: TripMapCamera; onCameraChange?: (camera: TripMapCamera) => void }
export function mapFilterKey(navigation: TripMapNavigation): string { return navigation.mode === 'all' ? 'all' : `day:${navigation.selectedDate}` }
export function validMapCamera(camera: TripMapCamera | undefined): camera is TripMapCamera {
  return Boolean(camera && Number.isFinite(camera.longitude) && Number.isFinite(camera.latitude) && Math.abs(camera.latitude) <= 85.051129 && Number.isFinite(camera.zoom) && camera.zoom >= -2 && camera.zoom <= 18)
}
// Session-only view state; never written to IndexedDB or backup archives.
export function initialMapView(navigation: TripMapNavigation, previous?: TripMapView): TripMapView {
  const filterKey = mapFilterKey(navigation)
  return previous?.filterKey === filterKey ? { ...previous, selection: [...previous.selection], transferSelection: [...previous.transferSelection], camera: validMapCamera(previous.camera) ? { ...previous.camera } : undefined }
    : { filterKey, selection: [], transferSelection: [], expanded: false }
}

// Cooperative gestures leave one-finger page scrolling to the browser.
// Bound GPU resolution/cache and cancel obsolete zoom tile requests on phones.
export function tripMapInteractionOptions(pixelRatio: number) {
  return { cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, scrollZoom: false, doubleClickZoom: false,
    maxTileCacheSize: 32, cancelPendingTileRequestsWhileZooming: true,
    pixelRatio: Number.isFinite(pixelRatio) ? Math.max(1, Math.min(2, pixelRatio)) : 1 } as const
}
