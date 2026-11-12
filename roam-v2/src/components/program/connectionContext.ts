import { createContext, useContext, type ReactNode } from 'react'
import type { TripActivity } from '../../db/activityModel'
export type ConnectionContextValue = { hiddenIds: Set<string>; hiddenLegacyIds: Set<string>; filter: string; render: (activity: TripActivity) => ReactNode }
export const ConnectionContext = createContext<ConnectionContextValue | null>(null)
export const useConnectionContext = () => useContext(ConnectionContext)
