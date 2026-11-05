import { readBackupZip } from '../src/backup/readZip'
import { createStoredZip } from '../src/backup/zip'
import { sha256 } from '../src/backup/sha256'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { createDocumentRepository } from '../src/db/documents'
import { createTripLibraryReader } from '../src/db/tripLibrary'
import { validateActivity, type TripActivity } from '../src/db/activityModel'
import { buildTripLibrary, filterTripLibrary, initialLibraryFilters, reservationGroup, hasReservationInformation } from '../src/reservations/library'
import { initialActivityValues, activityFormInput } from '../src/components/program/activityFormModel'
import { TripLibrary } from '../src/components/reservations/TripLibrary'
import { readExportSnapshot, buildExportArchive } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { timedFixture } from './dayPlanning.core'
import { connection } from '../src/pwa/connection'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Accès ou type de réservation invalide accepté.') }
export async function testTripLibrary(report: (message: string) => void) {
  const trip: Trip = { id: 'library', destination: 'Test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '' }
  const hotel: TripActivity = { ...timedFixture('hotel', '15:00', '16:00'), tripId: trip.id, date: trip.startDate, title: 'Hôtel Été', category: 'other', reservationType: 'accommodation', reservationReference: 'ABC-123', reservationNotes: 'Arrivée tardive', notes: 'Note originale', address: 'Rue de la Gare', estimatedCost: 100, paidAmount: 0, currency: 'EUR' }
  const flight = { ...hotel, id: 'flight', title: 'Vol', category: 'transport' as const, reservationType: undefined, reservationStatus: 'confirmed' as const }
  const visit = { ...timedFixture('visit', '09:00', '10:00'), tripId: trip.id, date: trip.startDate, title: 'Visite' }
  const foreign = { ...hotel, id: 'foreign', tripId: 'foreign' }
  const metadata = { id: 'doc', activityId: visit.id, name: 'Billet été.pdf', mime: 'application/pdf' as const, size: 12, importedAt: '2026-11-05T12:00:00.000Z' }
  const original = JSON.stringify([hotel, flight, visit, metadata])
  const entries = buildTripLibrary(trip.id, [visit, flight, hotel, foreign], [metadata, metadata, { ...metadata, id: 'foreign-doc', activityId: foreign.id }])
  assert(entries.length === 3 && entries.reduce((sum, row) => sum + row.documents.length, 0) === 1, 'Réservations/docs dupliqués ou fuite entre voyages.')
  assert(reservationGroup(hotel) === 'accommodation' && reservationGroup(flight) === 'transport' && reservationGroup({ ...hotel, reservationType: undefined }) === 'other', 'Hébergement inventé à partir du titre ou type explicite perdu.')
  assert(!hasReservationInformation(visit) && entries.find((entry) => entry.activity.id === visit.id)?.reservation === false, 'Document assimilé à une réservation.')
  assert(filterTripLibrary(entries, { ...initialLibraryFilters, query: 'ETE' }).length === 2 && filterTripLibrary(entries, { ...initialLibraryFilters, query: 'abc-123 gare' }).length === 2, 'Recherche code/accents/adresse erronée.')
  assert(filterTripLibrary(entries, { ...initialLibraryFilters, type: 'accommodation' }).length === 1 && filterTripLibrary(entries, { ...initialLibraryFilters, status: 'unknown' }).length === 2 && filterTripLibrary(entries, { ...initialLibraryFilters, documents: 'with' }).length === 1, 'Filtres/type/statut inventé.')
  await rejects(() => validateActivity({ ...hotel, reservationType: 'fake' as never }))
  const initial = initialActivityValues({ ...hotel, reservationType: undefined }, hotel.date, trip.startDate)
  assert(initial.reservationType === '' && initialActivityValues(hotel, hotel.date, trip.startDate).reservationType === 'accommodation', 'Ancien type rempli ou type existant perdu.')
  assert(activityFormInput({ ...initial, notes: 'Nouvelle note' }, hotel, initial).reservationType === 'accommodation', 'Modification simple écrase un type concurrent.')
  assert(JSON.stringify([hotel, flight, visit, metadata]) === original, 'Projection modifie les données sources.')

  const database = new RoamDatabase(`roam-v2-test-library-${crypto.randomUUID()}`), target = new RoamDatabase(`roam-v2-test-library-restore-${crypto.randomUUID()}`)
  const activities = createActivityRepository(database), documents = createDocumentRepository(database), read = createTripLibraryReader(database)
  const host = document.createElement('div'); host.className = 'trip-dashboard'; document.body.append(host)
  const root = createRoot(host), offline = connection.getSnapshot().offline
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL, originalClick = HTMLAnchorElement.prototype.click
  const created: string[] = [], revoked: string[] = [], downloads: { name: string; url: string }[] = []
  URL.createObjectURL = (blob) => { const url = originalCreate.call(URL, blob); created.push(url); return url }
  URL.revokeObjectURL = (url) => { revoked.push(url); originalRevoke.call(URL, url) }
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, url: this.href }) }
  let payloadReads = 0, reads = 0
  const countPayload = (value: unknown) => { payloadReads++; return value }
  database.activityDocumentBlobs.hook('reading', countPayload)
  const readLibrary = async (id: string) => { reads++; return read(id) }
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((done) => setTimeout(done, 20)); assert(condition(), 'Espace réservations non actualisé.') }
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === name)!
  const setSearch = (value: string) => flushSync(() => { const input = host.querySelector<HTMLInputElement>('input[type="search"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const render = (current = trip) => flushSync(() => root.render(<TripLibrary key={current.id} trip={current} readLibrary={readLibrary} readDocument={documents.getDocument} onClose={() => {}} />))
  try {
    await database.trips.add(trip); await database.trips.add({ ...trip, id: 'foreign' }); await database.trips.add({ ...trip, id: 'copy', destination: 'Test (copie)' })
    let storedHotel = await activities.createActivity(trip.id, hotel)
    await activities.createActivity(trip.id, flight)
    const storedVisit = await activities.createActivity(trip.id, visit), storedForeign = await activities.createActivity('foreign', foreign)
    const file = new File(['%PDF-1.7\nTest binaire original\n%%EOF'], 'Réservation Hôtel.pdf', { type: 'application/pdf' })
    const [doc] = await documents.importDocuments(trip.id, storedHotel.id, [file])
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
    canvas.getContext('2d')!.fillRect(0, 0, 1, 1)
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
    await documents.importDocuments(trip.id, storedVisit.id, [new File([png], 'Visite.png', { type: 'image/png' })])
    await documents.importDocuments('foreign', storedForeign.id, [file])
    const snapshot = await read(trip.id)
    assert(payloadReads === 0 && snapshot.documents.length === 2 && !snapshot.activities.some((activity) => activity.tripId !== trip.id), 'Liste lit les Blob ou des données étrangères.')
    await rejects(() => documents.getDocument('foreign', storedHotel.id, doc.id))
    const copy = await read('copy'); assert(copy.activities.length === 0 && copy.documents.length === 0, 'Copie du voyage montre les documents originaux sans activités copiées.')
    // Partial updates retain the optional classification and every binary.
    storedHotel = await activities.updateActivity(trip.id, storedHotel.id, { title: storedHotel.title, category: storedHotel.category, date: storedHotel.date, scheduleType: 'exact', startTime: '15:00', period: null, notes: 'Mise à jour' })
    assert(storedHotel.reservationType === 'accommodation' && storedHotel.paidAmount === 0, 'Mise à jour simple perd classification/montants.')
    payloadReads = 0
    window.dispatchEvent(new Event('offline')); render()
    await wait(() => host.querySelectorAll('.library-entry').length === 3)
    assert(payloadReads === 0 && host.textContent?.includes('Hébergement') && host.textContent.includes('Non renseigné') && !host.textContent.includes('foreign'), 'Classement/statut/lecture initiale incorrects.')
    const initialReads = reads
    setSearch('hôtel')
    assert(host.querySelectorAll('.library-entry').length === 1 && reads === initialReads && payloadReads === 0, 'Recherche relit la base ou charge les Blob.')
    const openDocument = () => host.querySelector<HTMLButtonElement>('[aria-label="Ouvrir ou télécharger Réservation Hôtel.pdf"]')!
    openDocument().focus(); flushSync(() => openDocument().click())
    await wait(() => Boolean(button('Télécharger')))
    assert(payloadReads === 1 && host.querySelectorAll('dialog[open]').length === 1 && document.body.style.overflow === 'hidden', 'Plusieurs fichiers chargés/panneaux superposés/défilement non bloqué.')
    flushSync(() => button('Télécharger').click())
    assert(downloads.length === 1 && downloads[0].name === file.name && downloads[0].url.startsWith('blob:'), 'Nom/téléchargement original perdu.')
    assert(await (await fetch(downloads[0].url)).text() === await file.text(), 'Fichier binaire modifié à la consultation/téléchargement.')
    flushSync(() => button('Fermer').click())
    assert(revoked.includes(downloads[0].url) && document.activeElement === openDocument() && host.querySelector<HTMLInputElement>('input[type="search"]')!.value === 'hôtel', 'Fermeture perd URL/focus/recherche.')
    // Missing payload remains visible as metadata; the viewer reports the real error.
    await database.activityDocumentBlobs.delete(doc.id)
    flushSync(() => openDocument().click())
    await wait(() => host.querySelector('dialog [role="alert"]')?.textContent?.includes('manquant') === true)
    assert(!button('Télécharger'), 'Fichier manquant présenté téléchargeable.')
    flushSync(() => button('Fermer').click()); await database.activityDocumentBlobs.add({ id: doc.id, blob: file })
    flushSync(() => button('Voir l’activité d’origine').click())
    await wait(() => Boolean(host.querySelector('dialog h2')))
    assert(host.querySelector('dialog h2')?.textContent === storedHotel.title, 'Mauvaise activité source ouverte.')
    storedHotel = await activities.updateActivity(trip.id, storedHotel.id, { ...storedHotel, title: 'Hôtel modifié' })
    await wait(() => host.querySelector('dialog h2')?.textContent === 'Hôtel modifié')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    flushSync(() => button('Modifier à la source').click())
    await wait(() => Boolean(host.querySelector('dialog form')))
    assert(host.querySelectorAll('dialog[open]').length === 1 && host.textContent?.includes('Type de réservation'), 'Édition source non réutilisée.')
    flushSync(() => button('Annuler').click())
    assert(!host.querySelector('dialog[open]'), 'Annulation directe ne revient pas à la liste.')
    setSearch('introuvable'); assert(host.textContent?.includes('Aucun résultat'), 'État recherche vide absent.')
    setSearch('')
    const typeSelect = host.querySelectorAll<HTMLSelectElement>('.library-filters select')[0]
    flushSync(() => { typeSelect.value = 'accommodation'; typeSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    assert(host.querySelectorAll('.library-entry').length === 1 && payloadReads === 2, 'Filtre incorrect ou relit les fichiers.')
    flushSync(() => button('Réinitialiser la recherche et les filtres').click())
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); assert(host.scrollWidth <= host.clientWidth + 1, 'Réservations débordent sur mobile.') }
    const imageButton = host.querySelector<HTMLButtonElement>('[aria-label="Ouvrir ou télécharger Visite.png"]')!
    flushSync(() => imageButton.click())
    await wait(() => Boolean(host.querySelector('.document-image-scroll img')))
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Agrandir l’image"]')!.click())
    assert(host.querySelector<HTMLImageElement>('.document-image-scroll img')!.style.width === '150%', 'Zoom image existant perdu.')
    flushSync(() => button('Télécharger').click())
    assert(downloads.at(-1)?.name === 'Visite.png', 'Téléchargement image incorrect.')
    flushSync(() => button('Fermer').click())
    setSearch('hôtel'); flushSync(() => openDocument().click()); await wait(() => Boolean(button('Télécharger')))
    const lastUrl = created.at(-1)!
    await database.activityDocuments.delete(doc.id)
    await wait(() => !host.querySelector('dialog[open]'))
    assert(revoked.includes(lastUrl) && host.textContent?.includes('n’est plus disponible'), 'Document supprimé reste ouvert ou URL fuit.')
    await database.activityDocuments.add(doc)
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared = await prepareRestore(archive.blob); await restoreBackup(prepared, await previewRestore(prepared, target), target)
    const badSnapshot = await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database)
    badSnapshot.activities[0].reservationType = 'invalid' as never
    await rejects(() => buildExportArchive(badSnapshot))
    const zipFiles = await readBackupZip(archive.blob), invalidActivities = JSON.parse(await zipFiles.get('data/activities.json')!.text())
    invalidActivities[0].reservationType = 'invalid'
    const changedJson = new Blob([JSON.stringify(invalidActivities)])
    zipFiles.set('data/activities.json', changedJson)
    const manifest = JSON.parse(await zipFiles.get('manifest.json')!.text()), inventory = manifest.inventory.find((item: { path: string }) => item.path === 'data/activities.json')
    inventory.size = changedJson.size; inventory.sha256 = await sha256(changedJson)
    zipFiles.set('manifest.json', new Blob([JSON.stringify(manifest)]))
    await rejects(async () => prepareRestore(await createStoredZip([...zipFiles].map(([path, blob]) => ({ path, blob })))))
    const restored = await createTripLibraryReader(target)(trip.id)
    assert(restored.activities.find((activity) => activity.id === storedHotel.id)?.reservationType === 'accommodation' && restored.documents.length === 2, 'ZIP perd réservation/type/documents.')
    assert(await (await createDocumentRepository(target).getDocument(trip.id, storedHotel.id, doc.id)).blob.text() === await file.text(), 'ZIP/restauration altère les octets.')
    setSearch('')
    flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Ouvrir ou télécharger Visite.png"]')!.click())
    await wait(() => Boolean(host.querySelector('.document-image-scroll img')))
    await activities.deleteActivity(trip.id, storedVisit.id)
    await wait(() => !host.querySelector('dialog[open]') && !host.querySelector(`[data-library-activity="${storedVisit.id}"]`))
    assert(created.every((url) => revoked.includes(url)), 'URL temporaire non libérée après fermeture ou suppression.')
    render({ ...trip, id: 'copy' }); await wait(() => host.textContent?.includes('Aucune réservation renseignée ni pièce jointe') === true)
    assert(!host.querySelector('.library-entry'), 'Changement de voyage fuit des réservations.')
    const failed = async () => { throw new Error('Stockage indisponible') }
    flushSync(() => root.render(<TripLibrary trip={trip} readLibrary={failed} onClose={() => {}} />))
    await wait(() => host.textContent?.includes('Réessayer cet espace') === true)
    assert(!host.textContent?.includes('Aucune réservation renseignée ni pièce jointe'), 'Erreur masquée en liste vide.')
    report('Réservations/documents : classement explicite/historique sans statut inventé, recherche/filtres, lecture légère unique, isolation/doublons, fiche/édition source/réactivité, PDF/PNG/Blob à la demande/téléchargement intact/URL révoquée, manquant/supprimé, duplication/ZIP, mobile et offline.')
  } finally { flushSync(() => root.unmount()); host.remove(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalClick; database.activityDocumentBlobs.hook('reading').unsubscribe(countPayload); await database.delete(); await target.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
