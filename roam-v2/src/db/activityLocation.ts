export type ActivityCoordinates = { latitude?: number; longitude?: number }

export function validateCoordinates(latitude: unknown, longitude: unknown): ActivityCoordinates {
  if (latitude === undefined && longitude === undefined) return {}
  if (latitude === undefined || longitude === undefined) throw new Error('Renseigne ensemble la latitude et la longitude, ou efface les deux.')
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('La latitude doit être un nombre compris entre −90 et 90.')
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('La longitude doit être un nombre compris entre −180 et 180.')
  return { latitude, longitude }
}
// Keep raw text in the form until submission; accept French decimals and the
// scientific notation produced by String(number) for very small stored values.
export function coordinateInput(value: string, label: string): number | undefined {
  const text = value.trim()
  if (!text) return undefined
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error(`${label} : utilise un nombre décimal avec un point ou une virgule.`)
  const number = Number(text.replace(',', '.'))
  if (!Number.isFinite(number)) throw new Error(`${label} doit être un nombre fini.`)
  return number
}

// Input syntax only: incomplete drafts are allowed; business validation stays
// in coordinateInput/validateCoordinates at submission time.
export function isCoordinateDraft(value: string): boolean {
  return /^-?[0-9]*(?:[.,][0-9]*)?$/.test(value) && !/\s/.test(value)
}

// Expand scientific notation without rounding, so existing small coordinates
// remain editable with the same digits-only input syntax.
export function coordinateFormValue(value: number | undefined): string {
  if (value === undefined) return ''
  const text = String(value)
  if (!/[eE]/.test(text)) return text
  const [coefficient, exponent] = text.toLowerCase().split('e')
  const sign = coefficient.startsWith('-') ? '-' : ''
  const unsigned = coefficient.replace('-', '')
  const [whole, fraction = ''] = unsigned.split('.')
  const digits = whole + fraction
  const position = whole.length + Number(exponent)
  if (position <= 0) return `${sign}0.${'0'.repeat(-position)}${digits}`
  if (position >= digits.length) return sign + digits + '0'.repeat(position - digits.length)
  return `${sign}${digits.slice(0, position)}.${digits.slice(position)}`
}
