const blockers = new Map<symbol, string>()
let reservation: { id: string; root: HTMLElement | null; inert: boolean; focus: Element | null } | null = null

export function reloadBlockReason(): string | null {
  const first = blockers.values().next().value
  if (first) return first
  if (typeof document !== 'undefined' && document.querySelector('#roam-app dialog[open], #roam-app [aria-busy="true"]')) {
    return 'Ferme les panneaux et termine les opérations en cours avant de recharger.'
  }
  return null
}
export function trackReloadBlocker(reason: string): () => void {
  const key = Symbol(reason)
  blockers.set(key, reason)
  return () => { blockers.delete(key) }
}
export function beginSensitiveOperation(reason: string): () => void {
  if (reservation) throw new Error('Une mise à jour est en cours. Réessaie après son activation.')
  return trackReloadBlocker(reason)
}
export function reserveReload(id: string): boolean {
  if ((reservation && reservation.id !== id) || reloadBlockReason()) return false
  if (!reservation) {
    const root = typeof document === 'undefined' ? null : document.getElementById('roam-app')
    reservation = { id, root, inert: root?.inert ?? false, focus: typeof document === 'undefined' ? null : document.activeElement }
    if (root) root.inert = true
  }
  return true
}
export function releaseReload(id: string) {
  if (reservation?.id !== id) return
  const previous = reservation
  reservation = null
  if (previous.root) previous.root.inert = previous.inert
  if (typeof HTMLElement !== 'undefined' && previous.focus instanceof HTMLElement && previous.focus.isConnected) previous.focus.focus()
}

export async function withSensitiveOperation<T>(reason: string, operation: () => Promise<T>): Promise<T> {
  const release = beginSensitiveOperation(reason)
  try { return await operation() } finally { release() }
}
