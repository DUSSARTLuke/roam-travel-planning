export type ActivityCategory = 'visit' | 'meal' | 'transport' | 'outing' | 'rest' | 'other'
export type ActivityPeriod = 'morning' | 'afternoon' | 'evening'
export type ReservationStatus = 'not_required' | 'to_book' | 'pending' | 'confirmed' | 'cancelled'

export type ActivityLink = { id: string; title: string; url: string }

export const advancedActivityKeys = [
  'estimatedCost', 'paidAmount', 'currency', 'reservationStatus', 'reservationReference',
  'reservationProvider', 'reservationPeople', 'reservationDeadline', 'reservationNotes', 'url', 'links',
] as const

export function isSafeActivityUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

export type ActivitySchedule =
  | { scheduleType: 'exact'; startTime: string; endTime?: string; period: null }
  | { scheduleType: 'period'; period: ActivityPeriod; startTime?: never; endTime?: never }
  | { scheduleType: 'unscheduled'; period: null; startTime?: never; endTime?: never }

export type TripActivityInput = ActivitySchedule & {
  title: string
  category: ActivityCategory
  // A local calendar date, never converted to the browser's time zone.
  date: string | null
  location?: string
  notes?: string
  paidAmount?: number
  reservationReference?: string
  reservationProvider?: string
  reservationPeople?: number
  reservationDeadline?: string
  reservationNotes?: string
  links?: ActivityLink[]
  estimatedCost?: number
  currency?: string
  reservationStatus?: ReservationStatus
  url?: string
  sortOrder: number
}

export type TripActivity = TripActivityInput & {
  id: string
  tripId: string
  createdAt: string
  updatedAt: string
}

export function isActivityDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} doit être du texte.`)
  return value.trim() || undefined
}

// Rebuild an allowlisted object: callers cannot overwrite identity or timestamps.
export function validateActivity(input: TripActivityInput, existing?: TripActivity): TripActivityInput {
  if (!input || typeof input !== 'object') throw new Error('Activité invalide.')
  const title = optionalText(input.title, 'Le titre')
  if (!title) throw new Error("Le titre de l'activité est obligatoire.")
  if (!['visit', 'meal', 'transport', 'outing', 'rest', 'other'].includes(input.category)) {
    throw new Error("La catégorie de l'activité est invalide.")
  }
  if (input.date !== null && !isActivityDate(input.date)) {
    throw new Error('La date doit être une date valide au format YYYY-MM-DD, ou null.')
  }
  if (typeof input.sortOrder !== 'number' || !Number.isFinite(input.sortOrder)) {
    throw new Error("L'ordre de classement doit être un nombre fini.")
  }
  if (input.estimatedCost !== undefined &&
      (typeof input.estimatedCost !== 'number' || !Number.isFinite(input.estimatedCost) || input.estimatedCost < 0)) {
    throw new Error('Le coût estimé doit être un montant non négatif.')
  }
  if (input.paidAmount !== undefined && (typeof input.paidAmount !== 'number' || !Number.isFinite(input.paidAmount) || input.paidAmount < 0)) {
    throw new Error('Le montant payé doit être non négatif.')
  }
  const currency = optionalText(input.currency, 'La devise')?.toUpperCase()
  if (currency !== undefined && input.currency !== existing?.currency &&
      !Intl.supportedValuesOf('currency').includes(currency)) {
    throw new Error('Utilise un code devise ISO reconnu, comme EUR, GBP ou USD.')
  }
  if (input.reservationPeople !== undefined && (!Number.isSafeInteger(input.reservationPeople) || input.reservationPeople <= 0)) {
    throw new Error('Le nombre de personnes doit être un entier strictement positif.')
  }
  if (input.reservationDeadline !== undefined && !isActivityDate(input.reservationDeadline)) {
    throw new Error('La date limite de réservation doit être une date valide au format YYYY-MM-DD.')
  }
  const reservationReference = optionalText(input.reservationReference, 'La référence')
  const reservationProvider = optionalText(input.reservationProvider, 'Le prestataire')
  const reservationNotes = optionalText(input.reservationNotes, 'Les notes de réservation')
  let links: ActivityLink[] | undefined
  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) throw new Error('La liste des liens est invalide.')
    const ids = new Set<string>()
    links = input.links.map((link) => {
      if (!link || typeof link !== 'object') throw new Error('Lien invalide.')
      const id = optionalText(link.id, 'L’identifiant du lien')
      const title = optionalText(link.title, 'Le titre du lien')
      const url = optionalText(link.url, 'L’URL du lien')
      if (!id || ids.has(id) || !title || !url || !isSafeActivityUrl(url)) {
        throw new Error('Chaque lien doit avoir un identifiant unique, un titre et une URL HTTP/HTTPS valide.')
      }
      ids.add(id)
      return { id, title, url }
    })
  }
  if (input.reservationStatus !== undefined &&
      !['not_required', 'to_book', 'pending', 'confirmed', 'cancelled'].includes(input.reservationStatus)) {
    throw new Error('Le statut de réservation est invalide.')
  }
  const url = optionalText(input.url, 'Le lien')
  if (url !== undefined && !isSafeActivityUrl(url)) {
    throw new Error('Le lien doit être une URL HTTP ou HTTPS valide.')
  }

  let schedule: ActivitySchedule
  if (input.scheduleType === 'exact') {
    if (!isTime(input.startTime) || (input.endTime !== undefined && !isTime(input.endTime))) {
      throw new Error('Les horaires doivent respecter HH:mm ; une heure de début est obligatoire.')
    }
    if (input.endTime !== undefined && input.endTime < input.startTime) {
      throw new Error("L'heure de fin doit être après l'heure de début sur la même journée.")
    }
    if (input.period !== null) throw new Error('Une activité à heure précise ne peut pas avoir de créneau.')
    schedule = { scheduleType: 'exact', startTime: input.startTime, period: null,
      ...(input.endTime !== undefined ? { endTime: input.endTime } : {}) }
  } else if (input.scheduleType === 'period' || input.scheduleType === 'unscheduled') {
    if (input.startTime !== undefined || input.endTime !== undefined) throw new Error('Ce mode ne doit pas comporter d’horaires précis.')
    if (input.scheduleType === 'period') {
      if (!['morning', 'afternoon', 'evening'].includes(input.period)) throw new Error('Le créneau est obligatoire et doit être valide.')
      schedule = { scheduleType: 'period', period: input.period }
    } else {
      if (input.period !== null) throw new Error('Une activité sans horaire ne peut pas avoir de créneau.')
      schedule = { scheduleType: 'unscheduled', period: null }
    }
  } else {
    throw new Error('Le mode de planification est invalide.')
  }

  return {
    ...schedule, title, category: input.category, date: input.date, sortOrder: input.sortOrder,
    location: optionalText(input.location, 'Le lieu'), notes: optionalText(input.notes, 'Les notes'),
    estimatedCost: input.estimatedCost, paidAmount: input.paidAmount, currency, reservationStatus: input.reservationStatus, url,
    reservationReference, reservationProvider, reservationPeople: input.reservationPeople,
    reservationDeadline: input.reservationDeadline, reservationNotes, links,
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// Dated activities first, then ideas; within a day: mode, manual order,
// time/period, creation and unique ID as deterministic tie breakers.
export function compareActivities(a: TripActivity, b: TripActivity): number {
  const scheduleRank = { exact: 0, period: 1, unscheduled: 2 }
  const periodRank = { morning: 0, afternoon: 1, evening: 2 }
  return compareText(a.date ?? '\uffff', b.date ?? '\uffff') ||
    scheduleRank[a.scheduleType] - scheduleRank[b.scheduleType] ||
    a.sortOrder - b.sortOrder ||
    compareText(a.startTime ?? '', b.startTime ?? '') ||
    (a.period === null ? 0 : periodRank[a.period]) - (b.period === null ? 0 : periodRank[b.period]) ||
    compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id)
}
