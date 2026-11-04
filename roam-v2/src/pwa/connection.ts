export type ConnectionSnapshot = { offline: boolean; returned: boolean }
export function createConnectionMonitor(environment: {
  online: () => boolean
  listen: (type: 'online' | 'offline', callback: () => void) => () => void
  timer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}) {
  let snapshot: ConnectionSnapshot = { offline: !environment.online(), returned: false }
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  function publish(next: ConnectionSnapshot) { snapshot = next; for (const listener of listeners) listener() }
  const stopOnline = environment.listen('online', () => {
    const returned = snapshot.offline
    if (!returned) return
    if (timer !== null) environment.clear(timer)
    publish({ offline: false, returned: true })
    timer = environment.timer(() => { timer = null; publish({ offline: false, returned: false }) }, 6000)
  })
  const stopOffline = environment.listen('offline', () => {
    if (timer !== null) environment.clear(timer)
    timer = null
    publish({ offline: true, returned: false })
  })
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot() { return snapshot },
    stop() { stopOnline(); stopOffline(); if (timer !== null) environment.clear(timer) },
  }
}

export const connection = createConnectionMonitor({
  online: () => navigator.onLine !== false,
  listen(type, callback) { window.addEventListener(type, callback); return () => window.removeEventListener(type, callback) },
  timer: (callback, delay) => setTimeout(callback, delay), clear: (timer) => clearTimeout(timer),
})
if (import.meta.hot) import.meta.hot.dispose(() => connection.stop())
