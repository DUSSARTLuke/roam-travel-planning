import { crc32 } from './zip'

export const RESTORE_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  entries: 10000,
  jsonBytes: 16 * 1024 * 1024,
  documentBytes: 15 * 1024 * 1024,
  records: 100000,
  trips: 5000,
} as const

const jsonPaths = new Set(['manifest.json', 'data/trips.json', 'data/activities.json', 'data/documents.json', 'data/metadata.json'])
const extraJsonPaths = new Set(['data/journeys.json', 'data/accommodations.json'])
function fail(): never { throw new Error('ZIP malformé ou non compatible avec les sauvegardes Roam V2 aux formats 1 et 2.') }

// Deliberately accepts only the ZIP STORE subset written by createStoredZip.
// No decompression, ZIP64, comments, symlinks, descriptors or extra fields.
export async function readBackupZip(archive: Blob, progress: (message: string) => void = () => {}): Promise<Map<string, Blob>> {
  if (!(archive instanceof Blob) || archive.size < 22 || archive.size > RESTORE_LIMITS.archiveBytes) {
    throw new Error('Archive invalide ou supérieure à la limite de restauration de 512 Mio.')
  }
  const end = new DataView(await archive.slice(archive.size - 22).arrayBuffer())
  if (end.getUint32(0, true) !== 0x06054b50 || end.getUint16(4, true) !== 0 || end.getUint16(6, true) !== 0 || end.getUint16(20, true) !== 0) fail()
  const count = end.getUint16(10, true)
  const directorySize = end.getUint32(12, true)
  const directoryOffset = end.getUint32(16, true)
  if (count < 5 || count > RESTORE_LIMITS.entries || count !== end.getUint16(8, true) || directoryOffset + directorySize !== archive.size - 22 || directorySize > RESTORE_LIMITS.jsonBytes) fail()
  const directory = new Uint8Array(await archive.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer())
  const central = new DataView(directory.buffer)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const entries = new Map<string, Blob>()
  let cursor = 0
  let expectedOffset = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > directory.length || central.getUint32(cursor, true) !== 0x02014b50) fail()
    const nameSize = central.getUint16(cursor + 28, true)
    const size = central.getUint32(cursor + 24, true)
    const localOffset = central.getUint32(cursor + 42, true)
    if (central.getUint16(cursor + 4, true) !== 20 || central.getUint16(cursor + 6, true) !== 20 || central.getUint16(cursor + 8, true) !== 0x800 || central.getUint16(cursor + 10, true) !== 0 ||
      central.getUint32(cursor + 20, true) !== size || central.getUint16(cursor + 30, true) !== 0 || central.getUint16(cursor + 32, true) !== 0 ||
      central.getUint16(cursor + 34, true) !== 0 || central.getUint16(cursor + 36, true) !== 0 || central.getUint32(cursor + 38, true) !== 0 ||
      nameSize === 0 || cursor + 46 + nameSize > directory.length || localOffset !== expectedOffset) fail()
    const name = decoder.decode(directory.slice(cursor + 46, cursor + 46 + nameSize))
    const isJson = jsonPaths.has(name) || extraJsonPaths.has(name)
    if ((!isJson && !/^documents\/\d{6}\.(pdf|jpg|png|webp)$/.test(name)) || entries.has(name) || (index === 0 && name !== 'manifest.json')) {
      throw new Error('Chemin ZIP dangereux, inattendu ou dupliqué. Aucun import effectué.')
    }
    if (size > (isJson ? RESTORE_LIMITS.jsonBytes : RESTORE_LIMITS.documentBytes) || localOffset + 30 > directoryOffset) fail()
    const localBytes = new Uint8Array(await archive.slice(localOffset, localOffset + 30 + nameSize).arrayBuffer())
    if (localBytes.length !== 30 + nameSize) fail()
    const local = new DataView(localBytes.buffer)
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(4, true) !== 20 || local.getUint16(6, true) !== 0x800 || local.getUint16(8, true) !== 0 ||
      local.getUint16(10, true) !== central.getUint16(cursor + 12, true) || local.getUint16(12, true) !== central.getUint16(cursor + 14, true) ||
      local.getUint32(14, true) !== central.getUint32(cursor + 16, true) || local.getUint32(18, true) !== size || local.getUint32(22, true) !== size ||
      local.getUint16(26, true) !== nameSize || local.getUint16(28, true) !== 0 || decoder.decode(localBytes.slice(30)) !== name) fail()
    const start = localOffset + 30 + nameSize
    if (start + size > directoryOffset) fail()
    const blob = archive.slice(start, start + size, isJson ? 'application/json' : '')
    if (crc32(new Uint8Array(await blob.arrayBuffer())) !== central.getUint32(cursor + 16, true)) throw new Error(`Le fichier « ${name} » est corrompu (CRC).`)
    entries.set(name, blob)
    expectedOffset = start + size
    cursor += 46 + nameSize
    if (index % 25 === 0) progress(`Vérification du ZIP : ${index + 1}/${count}`)
  }
  if (cursor !== directory.length || expectedOffset !== directoryOffset || [...jsonPaths].some((path) => !entries.has(path))) fail()
  return entries
}
