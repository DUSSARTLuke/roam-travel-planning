import { activityVersion } from '../src/db/activityRevision'
import { createTransferRepository } from '../src/db/transfers'
import { transferKey } from '../src/db/transferModel'
import { createAutomaticRateService } from '../src/db/automaticRates'
import { createUpdateCoordinator, type UpdateMessage } from '../src/pwa/updateCoordinator'
import Dexie from 'dexie'
import { createId } from '../src/utils/createId'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createDocumentRepository } from '../src/db/documents'
import type { TripActivityInput } from '../src/db/activityModel'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function failure(action: () => unknown | Promise<unknown>): Promise<Error> {
  try { await action() } catch (error) { assert(error instanceof Error, 'Exception sans diagnostic.'); return error }
  throw new Error('Une opération invalide a réussi.')
}
function pdf() { return new File(['%PDF-1.7\nTest local'], 'test-local.pdf', { type: 'application/pdf' }) }
export async function testActivitySave(report: (message: string) => void) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const fixed = '11111111-1111-4111-8111-111111111111'
  assert(createId({ randomUUID: () => fixed }) === fixed, 'Voie native non conservée.')
  const zero = createId({ getRandomValues(array) { (array as Uint8Array).fill(0); return array } })
  assert(zero === '00000000-0000-4000-8000-000000000000' && uuid.test(zero), 'Bits version/variant UUID v4 incorrects.')
  await failure(() => createId({}))
  const nativeFailure = await failure(() => createId({ randomUUID() { throw new Error('Échec natif') }, getRandomValues() { throw new Error('Fallback incorrect') } }))
  assert(nativeFailure.message === 'Échec natif', 'Erreur native masquée par un repli silencieux.')

  const database = new RoamDatabase(`roam-v2-test-activity-save-${createId()}`)
  const docs = createDocumentRepository(database)
  const trip: Trip = { id: 'save-trip', destination: 'Test HTTP', country: 'Test', startDate: '2027-01-01', endDate: '2027-01-02', travelers: 1, image: '' }
  const input: TripActivityInput = { title: 'Activité locale', category: 'visit', date: trip.startDate, scheduleType: 'unscheduled', period: null,
    estimatedCost: 0, paidAmount: 12, currency: 'EUR', latitude: 0, longitude: -0.5, notes: 'À conserver' }
  const uuidDescriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID')
  const randomDescriptor = Object.getOwnPropertyDescriptor(crypto, 'getRandomValues')
  const scopes: string[] = []
  const captureScope = () => { scopes.push([...Dexie.currentTransaction!.storeNames].sort().join(',')) }
  const restoreRandom = () => { if (randomDescriptor) Object.defineProperty(crypto, 'getRandomValues', randomDescriptor); else Reflect.deleteProperty(crypto, 'getRandomValues') }
  async function fingerprint() {
    const rows = await database.transaction('r', database.tables, async () => ({
      activities: await database.activities.toArray(), documents: await database.activityDocuments.toArray(),
      blobs: await database.activityDocumentBlobs.toArray(), trips: await database.trips.toArray(), metadata: await database.metadata.toArray(),
    }))
    const blobs = await Promise.all(rows.blobs.map(async (row) => [row.id, row.blob.type, Array.from(new Uint8Array(await row.blob.arrayBuffer()))]))
    return JSON.stringify({ ...rows, blobs })
  }
  try {
    await database.trips.add(trip)
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    const ids = new Set(Array.from({ length: 100 }, () => createId()))
    assert(ids.size === 100 && [...ids].every((id) => uuid.test(id)), 'UUID de repli invalides ou réutilisés.')
    database.activities.hook('creating', captureScope)
    const created = await docs.saveActivityWithDocuments(trip.id, input, null, [])
    database.activities.hook('creating').unsubscribe(captureScope)
    assert(uuid.test(created.id) && scopes.at(-1) === 'activities,trips', 'Création sans document touche les tables de pièces jointes.')
    const attached = await docs.saveActivityWithDocuments(trip.id, { ...input, title: 'Avec PDF' }, null, [pdf()])
    const metadata = await docs.listDocuments(trip.id, attached.id)
    assert(metadata.length === 1 && uuid.test(metadata[0].id), 'Import PDF sans randomUUID impossible.')
    database.activities.hook('updating', captureScope)
    let edited = await docs.saveActivityWithDocuments(trip.id, { ...attached, title: 'Modification sans fichier' }, attached.id, [])
    database.activities.hook('updating').unsubscribe(captureScope)
    assert(edited.id === attached.id && edited.createdAt === attached.createdAt && scopes.at(-1) === 'activities,trips', 'Modification sans document ne préserve pas son identité ou son scope.')
    assert(JSON.stringify(await docs.listDocuments(trip.id, attached.id)) === JSON.stringify(metadata), 'Pièce jointe existante modifiée sans nouvel import.')
    edited = await docs.saveActivityWithDocuments(trip.id, { ...edited, title: 'Modification et nouveau PDF' }, edited.id, [pdf()])
    assert((await docs.listDocuments(trip.id, attached.id)).length === 2, 'Ajout à une activité existante non atomique/incomplet.')
    const before = await fingerprint()
    const quota = new DOMException('Quota simulé', 'QuotaExceededError')
    const failBlob = () => { throw quota }
    database.activityDocumentBlobs.hook('creating', failBlob)
    try {
      for (const id of [null, attached.id]) {
        const error = await failure(() => docs.saveActivityWithDocuments(trip.id, { ...input, title: 'À annuler' }, id, [pdf()], id === null ? undefined : activityVersion(edited)))
        assert(error.message.includes('Espace de stockage local insuffisant') && error.cause !== undefined, 'Quota masqué ou cause perdue.')
        assert(await fingerprint() === before, 'Sauvegarde partielle après échec d’écriture du Blob.')
      }
    } finally { database.activityDocumentBlobs.hook('creating').unsubscribe(failBlob) }
    const technical = new TypeError('Échec technique simulé')
    const failMetadata = () => { throw technical }
    database.activityDocuments.hook('creating', failMetadata)
    try {
      const error = await failure(() => docs.saveActivityWithDocuments(trip.id, input, attached.id, [pdf()], activityVersion(edited)))
      assert(error.message.includes('l’activité et ses documents') && error.message.includes('TypeError') && error.cause === technical, 'Erreur technique masquée ou contexte trompeur.')
      assert(await fingerprint() === before, 'Modification partielle après échec des métadonnées.')
    } finally { database.activityDocuments.hook('creating').unsubscribe(failMetadata) }
    const abort = new DOMException('Transaction interrompue', 'AbortError')
    const failActivity = () => { throw abort }
    database.activities.hook('updating', failActivity)
    try {
      const error = await failure(() => docs.saveActivityWithDocuments(trip.id, input, attached.id, [], activityVersion(edited)))
      assert(error.message.includes('l’activité') && !error.message.includes('documents') && error.cause !== undefined, 'Erreur sans fichier attribuée aux documents.')
      assert(await fingerprint() === before, 'Modification partielle après abort.')
    } finally { database.activities.hook('updating').unsubscribe(failActivity) }
    const premature = () => { throw new DOMException('Transaction déjà finie', 'TransactionInactiveError') }
    database.activities.hook('updating', premature)
    try {
      const error = await failure(() => docs.saveActivityWithDocuments(trip.id, input, attached.id, [], activityVersion(edited)))
      assert(error.message.includes('Vérifie la liste') && !error.message.includes('Aucun changement enregistré'), 'Rollback affirmé sans certitude pour une transaction terminée.')
    } finally { database.activities.hook('updating').unsubscribe(premature) }
    const unreadable = pdf()
    Object.defineProperty(unreadable, 'slice', { value() { throw new DOMException('Lecture impossible', 'NotReadableError') } })
    const readError = await failure(() => docs.saveActivityWithDocuments(trip.id, input, null, [unreadable]))
    assert(readError.message.includes('ne peut pas être lu') && readError.cause !== undefined && await fingerprint() === before, 'Lecture de fichier en erreur : diagnostic/atomicité incorrects.')
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: undefined })
    try {
      await failure(() => docs.saveActivityWithDocuments(trip.id, input, null, []))
      await failure(() => docs.saveActivityWithDocuments(trip.id, input, attached.id, [pdf()], activityVersion(edited)))
      assert(await fingerprint() === before, 'Données modifiées après échec de génération d’identifiant.')
      await docs.saveActivityWithDocuments(trip.id, { ...edited, title: 'Édition sans nouvel identifiant' }, attached.id, [])
    } finally { restoreRandom() }
    database.close(); await database.open()
    assert((await docs.listDocuments(trip.id, attached.id)).length === 2 && (await docs.getDocument(trip.id, attached.id, metadata[0].id)).blob.size === pdf().size, 'Pièces jointes perdues/corrompues après réouverture.')
    assert((await database.activities.get(attached.id))!.paidAmount === 12 && (await database.activities.get(attached.id))!.longitude === -0.5, 'Autres champs perdus.')
    // Exercise remaining production consumers with native randomUUID disabled.
    const transfers = createTransferRepository(database)
    const destination = await docs.saveActivityWithDocuments(trip.id, { ...input, title: 'Arrivée' }, null, [])
    let transfer = await transfers.saveTransfer(trip.id, { fromActivityId: created.id, toActivityId: destination.id, mode: 'walk', currency: 'EUR', durationMinutes: 0 })
    assert(uuid.test(transfer.id), 'Création de déplacement HTTP impossible.')
    const firstId = transfer.id
    transfer = await transfers.saveTransfer(trip.id, { ...transfer, mode: 'bus', durationMinutes: 15 }, transfer.id, transferKey(transfer))
    assert(transfer.id === firstId && transfer.mode === 'bus', 'Modification du déplacement change son identité.')
    const beforeMissingRandom = await fingerprint()
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: undefined })
    try {
      const error = await failure(() => transfers.saveTransfer(trip.id, { fromActivityId: created.id, toActivityId: destination.id, mode: 'train', currency: 'EUR' }))
      assert(error.message.includes('identifiant fiable') && await fingerprint() === beforeMissingRandom, 'Échec RNG du déplacement modifie les données ou masque la cause.')
    } finally { restoreRandom() }
    await transfers.deleteTransfer(trip.id, transfer.id, transferKey(transfer))
    assert((await database.trips.get(trip.id))?.manualTransfers?.length === 0, 'Suppression du déplacement HTTP impossible.')

    await docs.saveActivityWithDocuments(trip.id, { ...input, title: 'Prix JPY', currency: 'JPY' }, null, [])
    let receivedToken = '', requests = 0
    const rates = createAutomaticRateService(database, {
      online: () => true, now: () => '2026-11-05T12:00:00.000Z',
      fetcher: async (url) => {
        requests++
        receivedToken = (await database.trips.get(trip.id))?.automaticExchangeRates?.refresh?.id ?? ''
        const source = String(url).split('/').at(-2)
        return new Response(JSON.stringify({ date: '2026-11-05', base: source, quote: 'EUR', rate: source === 'JPY' ? 0.0056294 : 1 }), { headers: { 'content-type': 'application/json' } })
      },
      // Intentionally no injected token: exercise the production default.
    })
    const refreshed = await rates.refresh(trip.id)
    assert(refreshed.fetched === 1 && uuid.test(receivedToken) && requests === 1, 'Actualisation HTTP échoue avant le fetch ou token invalide.')
    assert((await rates.refresh(trip.id)).status === 'cached' && requests === 1, 'Garde quotidienne des taux perdue.')

    // Same shared generator as App creation/duplication; no user DB is opened.
    const newTripId = createId(), duplicateId = createId()
    await database.trips.add({ ...trip, id: newTripId })
    await database.trips.add({ ...trip, id: duplicateId, destination: `${trip.destination} (copie)` })
    assert(uuid.test(newTripId) && uuid.test(duplicateId) && newTripId !== duplicateId, 'Identifiants voyage/copie non indépendants en HTTP.')
    const messages: UpdateMessage[] = []
    const worker = { postMessage(message: UpdateMessage) { messages.push(message) } }
    const coordinator = createUpdateCoordinator({ reason: () => null, reserve: () => true, release() {}, reload() { throw new Error('Rechargement interdit dans ce test') }, token: createId,
      timer: (callback, delay) => setTimeout(callback, delay), clear: (timer) => clearTimeout(timer) })
    coordinator.setWaiting(worker); coordinator.request()
    const request = messages[0]
    assert(request.type === 'ROAM_REQUEST_UPDATE' && uuid.test(request.id!), 'Token du protocole PWA incompatible avec HTTP.')
    coordinator.message({ type: 'ROAM_UPDATE_RELEASE', id: request.id }, worker)
    assert(!coordinator.hasReservation(), 'Réservation de test PWA non libérée.')
    report('Actions HTTP sans UUID natif : déplacements création/modification/suppression et rollback RNG, token réel des taux (réponse simulée)/cache, identifiants voyage/copie et protocole PWA sans activation.')
    report('Sauvegarde activité HTTP : UUID v4 natif/repli fiable, création/édition avec ou sans fichiers, documents existants préservés, scopes réduits, quota/abort/erreur technique/lecture/RNG et rollback intégral, persistance.')
  } finally {
    restoreRandom()
    if (uuidDescriptor) Object.defineProperty(crypto, 'randomUUID', uuidDescriptor); else Reflect.deleteProperty(crypto, 'randomUUID')
    await database.delete()
  }
}
