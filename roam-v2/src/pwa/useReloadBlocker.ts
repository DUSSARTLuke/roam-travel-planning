import { useEffect } from 'react'
import { trackReloadBlocker } from './reloadSafety'

export function useReloadBlocker(active: boolean, reason: string) {
  useEffect(() => {
    if (active) return trackReloadBlocker(reason)
  }, [active, reason])
}
