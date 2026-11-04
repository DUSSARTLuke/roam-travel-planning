// ZIP method 0 (STORE), UTF-8 names, CRC-32 and central directory.
// Specification: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
export type ZipEntry = { path: string; blob: Blob }
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

export async function createStoredZip(entries: ZipEntry[]): Promise<Blob> {
  if (entries.length >= 65535) throw new Error('Trop de fichiers pour le format ZIP pris en charge.')
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const directory: BlobPart[] = []
  const names = new Set<string>()
  let offset = 0
  let directorySize = 0
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some((part) => part === '..' || part === '.' || !part) || names.has(entry.path)) {
      throw new Error('Chemin ZIP invalide ou dupliqué.')
    }
    names.add(entry.path)
    const name = encoder.encode(entry.path)
    if (name.length > 65535 || entry.blob.size >= 0xffffffff) throw new Error('Fichier trop volumineux pour ce format ZIP.')
    const checksum = crc32(new Uint8Array(await entry.blob.arrayBuffer()))
    const local = new Uint8Array(30)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true)
    l.setUint16(12, 33, true) // 1980-01-01; original dates live in JSON.
    l.setUint32(14, checksum, true); l.setUint32(18, entry.blob.size, true); l.setUint32(22, entry.blob.size, true)
    l.setUint16(26, name.length, true)
    const central = new Uint8Array(46)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true)
    c.setUint16(8, 0x800, true); c.setUint16(14, 33, true); c.setUint32(16, checksum, true)
    c.setUint32(20, entry.blob.size, true); c.setUint32(24, entry.blob.size, true); c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    parts.push(local, name, entry.blob)
    directory.push(central, name)
    offset += local.length + name.length + entry.blob.size
    directorySize += central.length + name.length
    if (offset + directorySize + 22 >= 0xffffffff) throw new Error('Cette sauvegarde dépasse la limite ZIP de 4 Gio. Aucun fichier produit.')
  }
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true)
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end], { type: 'application/zip' })
}
