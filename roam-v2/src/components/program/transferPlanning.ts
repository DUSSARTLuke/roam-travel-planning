import type { TripActivity } from '../../db/activityModel'
import type { ManualTransfer } from '../../db/transferModel'
import { buildDayPlanning } from './dayPlanning'

export function transferPlacement(transfer: ManualTransfer, activities: readonly TripActivity[]): { day: string | null; warning?: string } {
  const from = activities.find((item) => item.id === transfer.fromActivityId)
  const to = activities.find((item) => item.id === transfer.toActivityId)
  if (!from || !to) return { day: null, warning: 'Une activité liée est introuvable. Corrige ou supprime ce déplacement.' }
  if (from.date === null || to.date === null || from.date !== to.date) return { day: null, warning: 'Les activités ne sont plus dans la même journée datée. Corrige ou supprime ce déplacement.' }
  const plan = buildDayPlanning(activities.filter((item) => item.date === from.date))
  const ordered = [...plan.timed.map((item) => item.activity), ...plan.toOrganize]
  const departure = ordered.findIndex((item) => item.id === from.id)
  const arrival = ordered.findIndex((item) => item.id === to.id)
  return { day: from.date, ...(arrival < departure ? { warning: 'L’arrivée apparaît avant le départ dans le planning. Vérifie ce lien ; ses activités n’ont pas été inversées.' }
    : arrival > departure + 1 ? { warning: 'D’autres activités apparaissent entre le départ et l’arrivée. Ce déplacement conserve ses deux activités liées.' } : {}) }
}
