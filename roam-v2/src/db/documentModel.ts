export const MAX_ACTIVITY_DOCUMENTS = 5
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
export type DocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
export type ActivityDocument = {
  id: string
  // Legacy UI facade: non-activity owners are accessed through the V6 repository.
  activityId: string
  tripId?: string
  owner?: import('../evolution/v21/contracts').Owner
  name: string
  mime: DocumentMime
  size: number
  importedAt: string
}
export type ActivityDocumentBlob = { id: string; blob: Blob }
export type PreparedDocument = { name: string; mime: DocumentMime; size: number; blob: Blob }

export function detectDocumentMime(bytes: Uint8Array): DocumentMime | null {
  const matches = (signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte)
  if (matches([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (matches([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8) && bytes.length >= 12) return 'image/webp'
  return null
}

// All-or-nothing validation, outside the IndexedDB transaction: Blob reads
// must not allow its transaction to become inactive. Headers are not a full parser.
export async function prepareDocuments(files: readonly File[]): Promise<PreparedDocument[]> {
  if (files.length > MAX_ACTIVITY_DOCUMENTS) throw new Error('Maximum 5 documents par activité. Aucun fichier de cette sélection n’a été ajouté.')
  const prepared: PreparedDocument[] = []
  for (const file of files) {
    if (!(file instanceof Blob) || typeof file.name !== 'string') throw new Error('Fichier invalide.')
    if (file.size === 0) throw new Error(`« ${file.name} » est vide. Aucun fichier de cette sélection n’a été ajouté.`)
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error(`« ${file.name} » dépasse 15 Mo. Aucun fichier de cette sélection n’a été ajouté.`)
    const mime = detectDocumentMime(new Uint8Array(await file.slice(0, 32).arrayBuffer()))
    if (!mime || (file.type !== '' && file.type.toLowerCase() !== mime)) {
      throw new Error(`« ${file.name} » : format interdit ou signature incompatible. Formats acceptés : PDF, JPEG, PNG, WebP. Aucun fichier de cette sélection n’a été ajouté.`)
    }
    prepared.push({ name: file.name, mime, size: file.size, blob: file.slice(0, file.size, mime) })
  }
  return prepared
}

export function documentSizeLabel(size: number): string {
  return size < 1024 ? `${size} octets` : size < 1024 * 1024 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(size / 1024)} Ko`
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} Mo`
}
