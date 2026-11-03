const DAY_MS = 24 * 60 * 60 * 1000

export function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

export function getTripDays(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!start || !end || start > end) return []
  const days: string[] = []
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10))
  }
  return days
}

export function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(parseDate(value)!)
}

export function getTripMonths(startDate: string, endDate: string): string[] {
  const cursor = parseDate(`${startDate.slice(0, 7)}-01`)
  const end = parseDate(`${endDate.slice(0, 7)}-01`)
  if (!cursor || !end || cursor > end) return []
  const months: string[] = []
  while (cursor <= end) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

export function getMonthCells(month: string): (string | null)[] {
  const first = parseDate(`${month}-01`)
  if (!first) return []
  const next = new Date(first)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const last = new Date(next.getTime() - DAY_MS)
  const cells: (string | null)[] = Array.from({ length: (first.getUTCDay() + 6) % 7 }, () => null)
  for (let day = 1; day <= last.getUTCDate(); day++) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
