import { sha256 as hash } from './sha256'
import { validateTripTransfers } from '../db/transferModel'
import { validateAutomaticCache } from '../money/automaticRates'
import { validateManualRates } from '../money/manualRates'
import { validateCurrency } from '../db/currency'
import { isActivityDate, validateActivity, type TripActivity } from '../db/activityModel'
import type { Trip } from '../db/database'
import { detectDocumentMime, MAX_ACTIVITY_DOCUMENTS, type ActivityDocument, type ActivityDocumentBlob } from '../db/documentModel'
import { parseBackupJson } from './safeJson'
import { readBackupZip, RESTORE_LIMITS } from './readZip'

export type RestoreMetadata = Record<string, unknown> & { key: string }
export type ValidatedRestore = {
  trips: Trip[]; activities: TripActivity[]; documents: ActivityDocument[]
  payloads: ActivityDocumentBlob[]; metadata: RestoreMetadata[]
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} : objet attendu.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`${label} : texte invalide.`)
}
function id(value: unknown): asserts value is string {
  text(value, 'Identifiant')
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Identifiant invalide.')
}
function timestamp(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) || !isActivityDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) throw new Error('Date ISO invalide dans la sauvegarde.')
}
function rows(value: unknown, key: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > RESTORE_LIMITS.records) throw new Error('Liste de données invalide ou excessive.')
  const ids = new Set<string>()
  return value.map((item) => {
    const row = record(item, 'Enregistrement')
    const identity = row[key]
    id(identity)
    if (ids.has(identity)) throw new Error('Identifiant dupliqué dans la sauvegarde.')
    ids.add(identity)
    return row
  })
}


export async function validateRestoreArchive(archive: Blob, progress: (message: string) => void = () => {}): Promise<ValidatedRestore> {
  const files = await readBackupZip(archive, progress)
  async function json(path: string): Promise<unknown> {
    const blob = files.get(path)
    if (!blob) throw new Error(`Fichier requis absent : ${path}`)
    return parseBackupJson(new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer()))
  }
  const manifest = record(await json('manifest.json'), 'Manifeste')
  if (manifest.format !== 'roam-v2-backup' || manifest.formatVersion !== 1 || manifest.databaseVersion !== 4 || manifest.encrypted !== false) throw new Error('Format, version ou chiffrement de sauvegarde incompatible.')
  timestamp(manifest.exportedAt); timestamp(manifest.snapshotAt)
  const scope = record(manifest.scope, 'Périmètre')
  if (scope.mode !== 'full' && scope.mode !== 'trip') throw new Error('Périmètre de sauvegarde invalide.')
  if (scope.mode === 'trip') id(scope.tripId)
  if (!Array.isArray(manifest.inventory) || manifest.inventory.length !== files.size - 1) throw new Error('Inventaire incomplet ou incohérent.')
  const inventory = new Map<string, { blob: Blob; documentId?: string }>()
  const documentReferences = new Set<string>()
  for (const [index, raw] of manifest.inventory.entries()) {
    const entry = record(raw, 'Entrée d’inventaire')
    text(entry.path, 'Chemin')
    const blob = files.get(entry.path)
    if (!blob || entry.path === 'manifest.json' || inventory.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size !== blob.size || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Inventaire de fichier invalide.')
    if (entry.path.startsWith('documents/')) {
      id(entry.documentId)
      if (documentReferences.has(entry.documentId)) throw new Error('Document référencé plusieurs fois.')
      documentReferences.add(entry.documentId)
    } else if (entry.documentId !== undefined) throw new Error('Référence documentaire inattendue.')
    if (await hash(blob) !== entry.sha256) throw new Error(`Le fichier « ${entry.path} » est corrompu (SHA-256).`)
    inventory.set(entry.path, { blob, ...(typeof entry.documentId === 'string' ? { documentId: entry.documentId } : {}) })
    if (index % 10 === 0) progress(`Vérification des empreintes : ${index + 1}/${manifest.inventory.length}`)
  }
  if ([...files.keys()].some((path) => path !== 'manifest.json' && !inventory.has(path))) throw new Error('Fichier hors inventaire.')
  const tripRows = rows(await json('data/trips.json'), 'id')
  if (tripRows.length > RESTORE_LIMITS.trips) throw new Error('La sauvegarde dépasse la limite de 5 000 voyages.')
  const activityRows = rows(await json('data/activities.json'), 'id')
  const documentRows = rows(await json('data/documents.json'), 'id')
  const metadataRows = rows(await json('data/metadata.json'), 'key')
  const counts = record(manifest.counts, 'Compteurs')
  for (const [key, length] of Object.entries({ trips: tripRows.length, activities: activityRows.length, documents: documentRows.length, metadata: metadataRows.length })) {
    if (counts[key] !== length) throw new Error('Compteurs incohérents dans le manifeste.')
  }
  if (scope.mode === 'trip' && (tripRows.length !== 1 || tripRows[0].id !== scope.tripId || metadataRows.length !== 0)) throw new Error('L’export individuel contient des données hors de son périmètre.')
  const tripIds = new Set(tripRows.map((trip) => trip.id))
  for (const trip of tripRows) {
    text(trip.destination, 'Destination'); text(trip.country, 'Pays'); text(trip.image, 'Photo', true)
    if (!isActivityDate(trip.startDate) || !isActivityDate(trip.endDate) || trip.endDate < trip.startDate || !Number.isSafeInteger(trip.travelers) || (trip.travelers as number) < 1 || (trip.archived !== undefined && typeof trip.archived !== 'boolean')) throw new Error('Voyage invalide dans la sauvegarde.')
    validateAutomaticCache(trip.automaticExchangeRates)
    validateManualRates(trip.manualExchangeRates)
    if (trip.referenceCurrency !== undefined) validateCurrency(trip.referenceCurrency)
    if (trip.deletedAt !== undefined) timestamp(trip.deletedAt)
  }
  const activityIds = new Set(activityRows.map((activity) => activity.id))
  for (const activity of activityRows) {
    id(activity.tripId)
    if (!tripIds.has(activity.tripId)) throw new Error('Activité sans voyage parent.')
    timestamp(activity.createdAt); timestamp(activity.updatedAt)
    if (activity.currency !== undefined && (typeof activity.currency !== 'string' || !/^[A-Za-z]{3}$/.test(activity.currency))) throw new Error('Code devise invalide.')
    // Validate without normalizing the saved record. Existing three-letter legacy
    // currencies remain accepted, just as during an unchanged activity edit.
    validateActivity(activity as unknown as TripActivity, activity as unknown as TripActivity)
  }
  const transferActivities = new Map(activityRows.map((activity) => [activity.id as string, activity as unknown as TripActivity]))
  for (const trip of tripRows) validateTripTransfers(trip.manualTransfers, trip.id as string, transferActivities)
  const perActivity = new Map<string, number>()
  const payloads: ActivityDocumentBlob[] = []
  const extension: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
  const byId = new Map([...inventory.entries()].filter(([, entry]) => entry.documentId !== undefined).map(([path, entry]) => [entry.documentId!, { path, blob: entry.blob }] as const))
  if (byId.size !== documentRows.length) throw new Error('Correspondance documents/fichiers incomplète.')
  for (const document of documentRows) {
    id(document.activityId); text(document.name, 'Nom du document'); timestamp(document.importedAt)
    if (!activityIds.has(document.activityId)) throw new Error('Document sans activité parent.')
    const count = (perActivity.get(document.activityId) ?? 0) + 1
    perActivity.set(document.activityId, count)
    if (count > MAX_ACTIVITY_DOCUMENTS || typeof document.mime !== 'string' || !Object.hasOwn(extension, document.mime) || !Number.isSafeInteger(document.size) || (document.size as number) < 1 || (document.size as number) > RESTORE_LIMITS.documentBytes) throw new Error('Limites ou métadonnées du document invalides.')
    const entry = byId.get(document.id as string)
    if (!entry || !entry.path.endsWith(`.${extension[document.mime]}`) || entry.blob.size !== document.size || detectDocumentMime(new Uint8Array(await entry.blob.slice(0, 32).arrayBuffer())) !== document.mime) throw new Error('Signature, taille ou référence de document invalide.')
    payloads.push({ id: document.id as string, blob: entry.blob.slice(0, entry.blob.size, document.mime) })
  }
  for (const metadata of metadataRows) {
    if ((metadata.initialized !== undefined && typeof metadata.initialized !== 'boolean') || (metadata.key === 'initialization' && metadata.initialized !== true)) throw new Error('Métadonnées d’initialisation invalides.')
  }
  return { trips: tripRows as unknown as Trip[], activities: activityRows as unknown as TripActivity[], documents: documentRows as unknown as ActivityDocument[], payloads, metadata: metadataRows as unknown as RestoreMetadata[] }
}
