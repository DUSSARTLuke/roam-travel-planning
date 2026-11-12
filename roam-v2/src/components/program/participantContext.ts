import { createContext } from 'react'
import type { TripParticipant } from '../../money/expenseSharing'
export const ParticipantContext = createContext<readonly TripParticipant[]>([])
