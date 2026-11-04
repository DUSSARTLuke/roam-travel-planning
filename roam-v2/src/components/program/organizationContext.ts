import { createContext } from 'react'
import type { TripActivity } from '../../db/activityModel'
import type { OrderDirection } from '../../db/activityOrganization'

export const OrganizationContext = createContext<{
  activities: TripActivity[]; busy: boolean
  open: (activity: TripActivity, mode: 'date' | 'time', trigger: HTMLButtonElement) => void
  reorder: (activity: TripActivity, direction: OrderDirection) => void
} | null>(null)

