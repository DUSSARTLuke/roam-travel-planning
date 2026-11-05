import type { ActivityCategory } from '../db/activityModel'

// Presentation groups only: no change to stored activity categories or backups.
export const budgetCategories = [
  { id: 'accommodation', label: 'Hébergement', color: '#c084fc', supported: false },
  { id: 'transport', label: 'Transport', color: '#60a5fa', supported: true },
  { id: 'food', label: 'Restauration', color: '#fbbf24', supported: true },
  { id: 'activities', label: 'Activités', color: '#34d399', supported: true },
  { id: 'other', label: 'Autres', color: '#fb923c', supported: true },
] as const
export type BudgetCategory = typeof budgetCategories[number]['id']
const activityGroups: Record<ActivityCategory, BudgetCategory> = {
  visit: 'activities', outing: 'activities', meal: 'food', transport: 'transport', rest: 'other', other: 'other',
}
export function activityBudgetCategory(category: ActivityCategory): BudgetCategory {
  return Object.hasOwn(activityGroups, category) ? activityGroups[category] : 'other'
}
