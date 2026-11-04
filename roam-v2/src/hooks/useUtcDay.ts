import { useSyncExternalStore } from 'react'

// Local clock only: no network polling. The stable snapshot changes at UTC
// midnight (within one minute), even when a settings panel stays open.
let utcDay = new Date().toISOString().slice(0, 10)
const dayListeners = new Set<() => void>()
let dayTimer: ReturnType<typeof setInterval> | undefined
function tickDay() {
  const next = new Date().toISOString().slice(0, 10)
  if (next !== utcDay) { utcDay = next; for (const listener of dayListeners) listener() }
}
function subscribeDay(listener: () => void) {
  dayListeners.add(listener)
  tickDay()
  dayTimer ??= setInterval(tickDay, 60000)
  return () => { dayListeners.delete(listener); if (!dayListeners.size) { clearInterval(dayTimer); dayTimer = undefined } }
}
const getDay = () => utcDay

export function useUtcDay() { return useSyncExternalStore(subscribeDay, getDay, getDay) }
