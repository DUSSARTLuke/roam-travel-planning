export type ProgramNavigation = { mode: 'day' | 'multi' | 'calendar' | 'ideas'; selectedDate: string; month: string }
export function initialProgramNavigation(startDate: string): ProgramNavigation {
  return { mode: 'day', selectedDate: startDate, month: startDate.slice(0, 7) }
}
// Calendar dates are local YYYY-MM-DD strings, never timezone-shifted instants.
export function normalizeProgramNavigation(state: ProgramNavigation, days: readonly string[], months: readonly string[]): ProgramNavigation {
  const selectedDate = days.includes(state.selectedDate) ? state.selectedDate : days[0] ?? state.selectedDate
  const month = months.includes(state.month) ? state.month : selectedDate.slice(0, 7)
  return { ...state, selectedDate, month }
}
export function multiDayGroup(days: readonly string[], selectedDate: string) {
  const index = Math.max(0, days.indexOf(selectedDate))
  const start = Math.floor(index / 3) * 3
  return { days: days.slice(start, start + 3), start,
    previous: start > 0 ? days[start - 3] : undefined,
    next: start + 3 < days.length ? days[start + 3] : undefined }
}
