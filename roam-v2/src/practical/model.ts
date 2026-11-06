import type { TripActivity } from '../db/activityModel'
export const practicalKinds = { contact: 'Contact', address: 'Adresse', note: 'Note' } as const
export const practicalCategories = { accommodation: 'Hébergement', transport: 'Transport', health: 'Santé et urgences', appointments: 'Rendez-vous', other: 'Autres' } as const
export type PracticalCategory = keyof typeof practicalCategories
export type PracticalInput = { title: string; category: PracticalCategory; notes?: string } & (
  | { kind: 'contact'; phone?: string; email?: string }
  | { kind: 'address'; address: string }
  | { kind: 'note'; notes: string })
export type PracticalRecord = PracticalInput & { id: string; createdAt: string; updatedAt: string }
export const MAX_PRACTICAL_RECORDS = 300
function text(value: unknown, label: string, limit: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} : texte invalide ou trop long (${limit} caractères maximum).`)
  return value.trim() || undefined
}
export function phoneLink(value: string): string {
  if (typeof value !== 'string' || value.length > 80) throw new Error('Le téléphone est limité à 80 caractères.')
  const trimmed = value.trim()
  if (!/^\+?[0-9 () .\u00a0\u202f-]+$/.test(trimmed)) throw new Error('Utilise des chiffres, espaces, tirets, points, parenthèses et un + au début uniquement.')
  let parenthesis = false
  for (const char of trimmed) {
    if (char === '(') { if (parenthesis) throw new Error('Vérifie les parenthèses du téléphone.'); parenthesis = true }
    if (char === ')') { if (!parenthesis) throw new Error('Vérifie les parenthèses du téléphone.'); parenthesis = false }
  }
  if (parenthesis || /\(\s*\)/.test(trimmed)) throw new Error('Vérifie les parenthèses du téléphone.')
  let number = trimmed.replace(/[ ().\u00a0\u202f-]/g, '')
  // 00 is an explicit international prefix; never guess a country for other numbers.
  if (number.startsWith('00')) number = '+' + number.slice(2)
  const frenchInternational = number.startsWith('+33')
  const frenchDomestic = number.startsWith('0')
  if (frenchInternational || frenchDomestic) {
    const valid = frenchInternational ? /^\+33[1-9]\d{8}$/.test(number) : /^0[1-9]\d{8}$/.test(number)
    if (!valid) throw new Error('Numéro français incomplet ou invalide : indique 10 chiffres (ex. 0612345678), ou +33 / 0033 suivi de 9 chiffres sans le 0 initial.')
  }
  if (number.startsWith('+') ? !/^\+[1-9]\d{6,14}$/.test(number) : !/^\d{3,15}$/.test(number)) throw new Error('Renseigne 3 à 15 chiffres, ou 7 à 15 avec un préfixe international +.')
  return `tel:${number}`
}
export function emailLink(value: string): string {
  if (typeof value !== 'string' || value.length > 254) throw new Error('L’e-mail est limité à 254 caractères.')
  const parts = value.trim().split('@')
  if (parts.length !== 2 || parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..') || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(parts[1]) || /%0[ad]/i.test(parts[0])) throw new Error('Saisis un e-mail de la forme nom@exemple.fr, sans espace à l’intérieur.')
  return 'mailto:' + parts.map(encodeURIComponent).join('@')
}
export function contactFieldErrors(phone: unknown, email: unknown): { phone?: string; email?: string } {
  const errors: { phone?: string; email?: string } = {}
  for (const [key, value, validate] of [['phone', phone, phoneLink], ['email', email, emailLink]] as const) {
    if (value === undefined || typeof value === 'string' && value.trim() === '') continue
    try { validate(value as string) } catch (error) { errors[key] = error instanceof Error ? error.message : 'Coordonnée invalide.' }
  }
  return errors
}
export function addressLink(value: string): string {
  const address = text(value, 'Adresse', 1000)
  if (!address) throw new Error('L’adresse est obligatoire.')
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address)
}
export function normalizePracticalInput(input: PracticalInput): PracticalInput {
  if (!input || typeof input !== 'object') throw new Error('Fiche pratique invalide.')
  const title = text(input.title, 'Nom ou titre', 200), notes = text(input.notes, 'Notes', 5000)
  if (!title) throw new Error('Le nom ou titre est obligatoire.')
  if (!Object.hasOwn(practicalCategories, input.category)) throw new Error('Catégorie pratique invalide.')
  const base = { title, category: input.category, ...(notes ? { notes } : {}) }
  if (input.kind === 'contact') {
    const phone = text(input.phone, 'Téléphone', 80), email = text(input.email, 'E-mail', 254)
    if (phone) phoneLink(phone)
    if (email) emailLink(email)
    return { ...base, kind: 'contact', ...(phone ? { phone } : {}), ...(email ? { email } : {}) }
  }
  if (input.kind === 'address') {
    const address = text(input.address, 'Adresse', 1000)
    if (!address) throw new Error('L’adresse est obligatoire.')
    return { ...base, kind: 'address', address }
  }
  if (input.kind !== 'note') throw new Error('Type de fiche pratique invalide.')
  if (!notes) throw new Error('Le contenu de la note est obligatoire.')
  return { ...base, kind: 'note', notes }
}
function timestamp(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Date de fiche pratique invalide.') }
export function validatePracticalRecords(value: unknown, options: { allowInvalidContacts?: boolean } = {}): PracticalRecord[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PRACTICAL_RECORDS) throw new Error('Le carnet est limité à 300 fiches.')
  const ids = new Set<string>()
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Fiche pratique invalide.')
    if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 512 || [...raw.id].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || ids.has(raw.id)) throw new Error('Identifiant de fiche invalide ou dupliqué.')
    ids.add(raw.id); timestamp(raw.createdAt); timestamp(raw.updatedAt)
    const legacyContact = options.allowInvalidContacts && raw.kind === 'contact'
    const fields = normalizePracticalInput(legacyContact ? { ...raw, phone: undefined, email: undefined } : raw)
    if (legacyContact) {
      for (const key of ['phone', 'email'] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error('Coordonnée de contact non textuelle.')
        if (raw[key] !== undefined) Object.assign(fields, { [key]: raw[key] })
      }
    }
    for (const key of ['title', 'notes', 'phone', 'email', 'address'] as const) if ((fields as unknown as Record<string, unknown>)[key] !== raw[key]) throw new Error('Champs incompatibles ou fiche pratique non normalisée.')
    return { ...fields, id: raw.id, createdAt: raw.createdAt, updatedAt: raw.updatedAt }
  })
}
export type PracticalEntry = { key: string; record?: PracticalRecord; title: string; kind: PracticalInput['kind']; category: PracticalCategory; address?: string; activities: TripActivity[] }
const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim()
const addressKey = (value: string) => value.normalize('NFC').toLocaleLowerCase('fr-FR').replace(/\s+/g, ' ').trim()
export function buildPracticalEntries(tripId: string, records: readonly PracticalRecord[], activities: readonly TripActivity[]): PracticalEntry[] {
  const entries: PracticalEntry[] = records.map((record) => ({ key: 'record:' + record.id, record, title: record.title, kind: record.kind, category: record.category, ...(record.kind === 'address' ? { address: record.address } : {}), activities: [] }))
  const places = new Map<string, PracticalEntry>()
  for (const entry of entries) if (entry.address && !places.has(addressKey(entry.address))) places.set(addressKey(entry.address), entry)
  const seen = new Set<string>()
  for (const activity of activities) {
    if (activity.tripId !== tripId || seen.has(activity.id)) continue
    seen.add(activity.id)
    const address = (typeof activity.address === 'string' ? activity.address.trim() : '') || (typeof activity.location === 'string' ? activity.location.trim() : '')
    if (!address) continue
    const key = addressKey(address), previous = places.get(key)
    if (previous) { previous.activities.push(activity); continue }
    const category: PracticalCategory = activity.reservationType === 'accommodation' ? 'accommodation' : activity.category === 'transport' ? 'transport' : 'other'
    const entry: PracticalEntry = { key: 'activity:' + activity.id, title: typeof activity.location === 'string' && activity.location.trim() ? activity.location : activity.title, kind: 'address', category, address, activities: [activity] }
    places.set(key, entry); entries.push(entry)
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }) || a.key.localeCompare(b.key))
}
export function searchPracticalEntries(entries: readonly PracticalEntry[], query: string, category: PracticalCategory | 'all' = 'all') {
  const words = normalized(query).split(' ').filter(Boolean)
  return entries.filter((entry) => {
    if (category !== 'all' && entry.category !== category) return false
    const record = entry.record
    const content = normalized([entry.title, entry.address, record?.notes, record?.kind === 'contact' ? record.phone : '', record?.kind === 'contact' ? record.email : '', practicalCategories[entry.category], practicalKinds[entry.kind], ...entry.activities.map((activity) => `${activity.title} ${activity.location ?? ''} ${activity.address ?? ''}`)].filter(Boolean).join(' '))
    return words.every((word) => content.includes(word))
  })
}
export function practicalCopyText(entry: PracticalEntry): string {
  const record = entry.record
  return [entry.title, record?.kind === 'contact' ? record.phone : undefined, record?.kind === 'contact' ? record.email : undefined, entry.address, record?.notes].filter(Boolean).join('\n')
}
