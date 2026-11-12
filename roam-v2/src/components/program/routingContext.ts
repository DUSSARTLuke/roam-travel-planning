import { createContext } from 'react'
import type { RoutingService } from '../../routing/routingService'
export const RoutingServiceContext = createContext<RoutingService | undefined>(undefined)
