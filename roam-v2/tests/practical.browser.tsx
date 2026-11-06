import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createPracticalRepository, copyPracticalRecords } from '../src/db/practical'
import { createActivityRepository } from '../src/db/activities'
import { phoneLink, emailLink, addressLink, validatePracticalRecords, buildPracticalEntries, searchPracticalEntries, practicalCopyText, type PracticalRecord } from '../src/practical/model'
import { copyPracticalText } from '../src/practical/clipboard'
import { PracticalNotebook } from '../src/components/practical/PracticalNotebook'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'
import { readBackupZip } from '../src/backup/readZip'
import { createStoredZip } from '../src/backup/zip'
import { sha256 } from '../src/backup/sha256'
import { timedFixture } from './dayPlanning.core'
import { connection } from '../src/pwa/connection'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Fiche ou lien invalide accepté.') }
const stamp = '2026-11-05T12:00:00.000Z'
export async function testPractical(report: (message: string) => void) {
  const trip: Trip = { id: 'practical', destination: 'Carnet test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 2, image: '' }
  const record: PracticalRecord = { id: 'contact', kind: 'contact', title: 'Réception test', category: 'accommodation', phone: '+33 (1) 23-45.67.89', email: 'test+demo@example.invalid', notes: 'Consigne de test', createdAt: stamp, updatedAt: stamp }
  assert(phoneLink(record.phone!) === 'tel:+33123456789' && emailLink(record.email!).startsWith('mailto:test%2Bdemo@'), 'Liens téléphone/e-mail incorrects.')
  assert(new URL(addressLink('Rue A & B ? Londres')).searchParams.get('query') === 'Rue A & B ? Londres', 'Adresse mal échappée.')
  assert(addressLink('javascript:alert(1)').startsWith('https://www.google.com/maps/search/?api=1&query='), 'Adresse transformée en URL exécutable.')
  for (const bad of ['javascript:alert(1)', '12?x=1', '12\n34', '++123', '+']) await rejects(() => phoneLink(bad))
  for (const bad of ['test', 'a@example.invalid?subject=x', 'a%0d%0abcc@example.invalid', 'a@bad/path.invalid', 'a@example.invalid\nBcc:evil@example.invalid']) await rejects(() => emailLink(bad))
  for (const bad of [null, [record, record], [{ ...record, category: 'bad' }], [{ ...record, kind: 'bad' }], [{ ...record, title: '' }], [{ ...record, kind: 'note', phone: undefined, email: undefined, notes: '' }], [{ ...record, notes: 'x'.repeat(5001) }], [{ ...record, createdAt: 'invalid' }]]) await rejects(() => validatePracticalRecords(bad))
  await rejects(() => validatePracticalRecords(Array.from({ length: 301 }, (_, index) => ({ ...record, id: String(index) }))))
  assert(validatePracticalRecords(undefined).length === 0 && copyPracticalRecords(undefined).practicalRecords === undefined, 'Anciennes données peuplées automatiquement.')
  assert(validatePracticalRecords([{ ...record, phone: undefined, email: undefined }]).length === 1, 'Contact aux coordonnées facultatives vides refusé.')
  const copied = copyPracticalRecords([record]).practicalRecords![0]
  assert(copied.id !== record.id && copied.phone === record.phone && copied.notes === record.notes, 'Duplication perd contenu ou conserve identifiant.')
  const address: PracticalRecord = { id: 'address', kind: 'address', title: 'Hôtel', category: 'accommodation', address: '1 Rue Test', createdAt: stamp, updatedAt: stamp }
  const activity = { ...timedFixture('a', '09:00', '10:00'), tripId: trip.id, address: '1 Rue Test', location: 'Lieu test', reservationType: 'accommodation' as const }
  const before = JSON.stringify([record, address, activity])
  const entries = buildPracticalEntries(trip.id, [record, address], [activity, { ...activity, id: 'b' }, { ...activity, id: 'foreign', tripId: 'other' }])
  assert(entries.length === 2 && entries.find((entry) => entry.record?.id === 'address')?.activities.length === 2, 'Adresses non réutilisées/regroupées ou fuite entre voyages.')
  assert(searchPracticalEntries(entries, 'RECEPTION').length === 1 && searchPracticalEntries(entries, '', 'transport').length === 0 && practicalCopyText(entries.find((entry) => entry.record?.id === 'contact')!).includes(record.email!), 'Recherche/catégorie/copie incorrecte.')
  assert(JSON.stringify([record, address, activity]) === before, 'Projection modifie les sources.')
  let copiedText = ''
  assert(await copyPracticalText('texte', { writeText: async (value) => { copiedText = value } }) === 'copied' && copiedText === 'texte', 'Copie automatique incorrecte.')
  assert(await copyPracticalText('texte', { writeText: async () => { throw new Error('Refus') } }) === 'manual' && await copyPracticalText('texte', {} as Clipboard) === 'manual', 'Échec de copie masqué comme un succès.')

  const database = new RoamDatabase(`roam-v2-test-practical-${crypto.randomUUID()}`), second = new RoamDatabase(database.name), target = new RoamDatabase(`roam-v2-test-practical-restore-${crypto.randomUUID()}`)
  const repo = createPracticalRepository(database), other = createPracticalRepository(second), activities = createActivityRepository(database)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), offline = connection.getSnapshot().offline
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((done) => setTimeout(done, 20)); assert(condition(), 'Carnet pratique non actualisé.') }
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === name)!
  const setInput = (input: HTMLInputElement, value: string) => flushSync(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  const setText = (area: HTMLTextAreaElement, value: string) => flushSync(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value); area.dispatchEvent(new Event('input', { bubbles: true })) })
  try {
    await database.trips.add(trip); await database.trips.add({ ...trip, id: 'other' }); await second.open()
    let contact = await repo.save(trip.id, record), savedAddress = await repo.save(trip.id, address)
    let note = await repo.save(trip.id, { kind: 'note', category: 'other', title: 'Note test', notes: 'Consigne' })
    const old = contact
    contact = await other.save(trip.id, { ...contact, title: 'Réception modifiée' }, contact.id, JSON.stringify(contact))
    await rejects(() => repo.remove(trip.id, old.id, JSON.stringify(old)))
    await rejects(() => repo.save('other', old, old.id, JSON.stringify(old)))
    await rejects(() => repo.save(trip.id, { kind: 'note', category: 'other', title: 'Conversion', notes: 'Refus' }, contact.id, JSON.stringify(contact)))
    await Promise.all([repo.save(trip.id, { ...contact, notes: 'Nouvelles notes' }, contact.id, JSON.stringify(contact)), other.save(trip.id, { ...note, title: 'Autre note' }, note.id, JSON.stringify(note)), database.trips.update(trip.id, { country: 'Préservé' })])
    const latest = await repo.read(trip.id)
    assert(latest.records.length === 3 && latest.trip.country === 'Préservé' && latest.records.some((item) => item.title === 'Autre note'), 'Concurrence écrase d’autres champs/fiches.')
    savedAddress = await repo.save(trip.id, { ...savedAddress, notes: 'À effacer' }, savedAddress.id, JSON.stringify(savedAddress))
    savedAddress = await repo.save(trip.id, { ...savedAddress, notes: undefined }, savedAddress.id, JSON.stringify(savedAddress))
    assert(savedAddress.notes === undefined, 'Effacement de note échoué.')
    const beforeFailure = JSON.stringify((await repo.read(trip.id)).trip)
    const failure = () => { throw new Error('Quota simulé') }; database.trips.hook('updating', failure)
    await rejects(() => repo.remove(trip.id, savedAddress.id, JSON.stringify(savedAddress)))
    database.trips.hook('updating').unsubscribe(failure)
    assert(JSON.stringify((await repo.read(trip.id)).trip) === beforeFailure, 'Échec laisse une écriture partielle.')
    await activities.createActivity(trip.id, activity)
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database))
    const prepared = await prepareRestore(archive.blob); await restoreBackup(prepared, await previewRestore(prepared, target), target)
    assert(JSON.stringify((await target.trips.get(trip.id))!.practicalRecords) === JSON.stringify((await database.trips.get(trip.id))!.practicalRecords), 'ZIP perd le carnet.')
    const invalidSnapshot = await readExportSnapshot({ mode: 'trip', tripId: trip.id }, database)
    invalidSnapshot.trips[0].practicalRecords![0] = { ...old, phone: 'javascript:alert(1)' }
    await rejects(() => buildExportArchive(invalidSnapshot))
    const files = await readBackupZip(archive.blob), trips = JSON.parse(await files.get('data/trips.json')!.text())
    trips[0].practicalRecords[0].phone = 'javascript:alert(1)'
    const changed = new Blob([JSON.stringify(trips)]); files.set('data/trips.json', changed)
    const manifest = JSON.parse(await files.get('manifest.json')!.text()), item = manifest.inventory.find((entry: { path: string }) => entry.path === 'data/trips.json')
    item.size = changed.size; item.sha256 = await sha256(changed); files.set('manifest.json', new Blob([JSON.stringify(manifest)]))
    await rejects(async () => prepareRestore(await createStoredZip([...files].map(([path, blob]) => ({ path, blob })))))
    database.close(); await database.open(); assert((await repo.read(trip.id)).records.length === 3, 'Carnet perdu après réouverture.')
    await database.trips.add({ ...trip, id: 'copy', ...copyPracticalRecords((await repo.read(trip.id)).trip.practicalRecords) })
    assert((await repo.read('copy')).records.every((entry) => !(latest.records.some((oldEntry) => oldEntry.id === entry.id))), 'Copie non indépendante.')
    await database.trips.update(trip.id, { archived: true }); await rejects(() => repo.read(trip.id)); await rejects(() => repo.save(trip.id, record))
    await database.trips.update(trip.id, { archived: false }); await updateTripTrash(trip.id, 'trash', undefined, database); await rejects(() => repo.save(trip.id, record)); await updateTripTrash(trip.id, 'restore', undefined, database)

    // Actual isolated UI writes; never use the system clipboard or external apps.
    const uiTrip = { ...trip, id: 'ui' }; await database.trips.add(uiTrip)
    let mode: 'manual' | 'copied' = 'manual'
    const copyText = async (text: string) => { copiedText = text; return mode }
    const render = (current = uiTrip) => flushSync(() => root.render(<PracticalNotebook key={current.id} trip={current} repository={repo} copyText={copyText} onClose={() => {}} />))
    window.dispatchEvent(new Event('offline')); render()
    await wait(() => host.textContent?.includes('Aucune information pratique') === true)
    assert((await database.trips.get(uiTrip.id))!.practicalRecords === undefined && host.textContent?.includes('non chiffrés'), 'Population automatique ou avertissement absent.')
    flushSync(() => button('Ajouter une information').click())
    setInput(host.querySelector('dialog input')!, 'Réception UI')
    setInput(host.querySelector('dialog input[type="tel"]')!, '+33 1 23 45 67 89')
    setInput(host.querySelector('dialog input[type="email"]')!, 'demo@example.invalid')
    flushSync(() => { const form = host.querySelector('dialog form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await wait(() => !host.querySelector('dialog[open]') && Boolean(host.querySelector('a[href^="tel:"]')))
    assert((await repo.read(uiTrip.id)).records.length === 1 && host.querySelector('a[href^="mailto:"]')?.getAttribute('href') === 'mailto:demo@example.invalid', 'Double soumission ou liens UI incorrects.')
    flushSync(() => button('Copier l’information').click())
    await wait(() => Boolean(host.querySelector('.practical-copy-text')))
    const copyArea = host.querySelector<HTMLTextAreaElement>('.practical-copy-text')!
    assert(copyArea.readOnly && copyArea.value.includes('demo@example.invalid') && !host.textContent?.includes('Information copiée dans'), 'Copie manuelle annoncée automatiquement réussie.')
    flushSync(() => button('Sélectionner le texte').click()); assert(copyArea.selectionStart === 0 && copyArea.selectionEnd === copyArea.value.length, 'Sélection manuelle inutilisable.')
    flushSync(() => button('Fermer la copie manuelle').click())
    mode = 'copied'; flushSync(() => button('Copier l’information').click()); await wait(() => host.textContent?.includes('Information copiée dans') === true)
    assert(copiedText.includes('Réception UI'), 'Copie perd le titre.')
    flushSync(() => button('Modifier').click()); setInput(host.querySelector('dialog input')!, 'Réception corrigée')
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    assert(host.querySelector('.sharing-discard'), 'Échap perd les modifications.')
    flushSync(() => button('Continuer la saisie').click())
    database.trips.hook('updating', failure); flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => host.querySelector('dialog [role="alert"]')?.textContent === 'Quota simulé'); database.trips.hook('updating').unsubscribe(failure)
    assert(host.querySelector<HTMLInputElement>('dialog input')!.value === 'Réception corrigée', 'Erreur perd la saisie.')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Réception corrigée') === true)
    const derived = await activities.createActivity(uiTrip.id, { ...activity, title: 'Source adresse' })
    await wait(() => host.textContent?.includes('Source adresse') === true)
    assert(host.querySelector('a.practical-link')?.getAttribute('rel') === 'noopener noreferrer', 'Lien externe non sécurisé.')
    flushSync(() => button('Source adresse').click()); await wait(() => Boolean(host.querySelector('dialog h2')))
    await activities.updateActivity(uiTrip.id, derived.id, { ...derived, address: 'Adresse actualisée' })
    await wait(() => host.querySelector('dialog')?.textContent?.includes('Adresse actualisée') === true)
    flushSync(() => host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })))
    setInput(host.querySelector('input[type="search"]')!, 'RECEPTION')
    assert(host.querySelectorAll('.practical-card').length === 1, 'Recherche accents/casse UI incorrecte.')
    setInput(host.querySelector('input[type="search"]')!, '')
    for (const width of [320, 375, 1100]) { host.style.width = `${width}px`; await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); assert(host.scrollWidth <= host.clientWidth + 1, 'Carnet déborde sur mobile.') }
    flushSync(() => button('Supprimer').click()); assert((await repo.read(uiTrip.id)).records.length === 1, 'Suppression sans confirmation.')
    flushSync(() => button('Confirmer la suppression').click()); await wait(() => host.querySelectorAll('.practical-card').length === 1 && !host.querySelector('dialog[open]'))
    assert((await repo.read(uiTrip.id)).records.length === 0 && (await repo.read(uiTrip.id)).activities.length === 1 && document.activeElement === button('Ajouter une information'), 'Suppression efface la source ou perd le focus.')
    // Address/note editors exercise conditional fields, categories and source reuse.
    flushSync(() => button('Ajouter une information').click())
    let kindSelect = host.querySelector<HTMLSelectElement>('dialog select')!
    flushSync(() => { kindSelect.value = 'address'; kindSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    setInput(host.querySelector('dialog input')!, 'Rendez-vous UI')
    setText(host.querySelector('dialog textarea')!, 'Adresse actualisée')
    let categorySelect = host.querySelectorAll<HTMLSelectElement>('dialog select')[1]
    flushSync(() => { categorySelect.value = 'appointments'; categorySelect.dispatchEvent(new Event('change', { bubbles: true })) })
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Rendez-vous UI') === true)
    assert(host.querySelectorAll('.practical-card').length === 1 && host.textContent?.includes('Adresse également renseignée'), 'Adresse manuelle crée un doublon de la source.')
    flushSync(() => button('Ajouter une information').click())
    kindSelect = host.querySelector<HTMLSelectElement>('dialog select')!
    flushSync(() => { kindSelect.value = 'note'; kindSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    setInput(host.querySelector('dialog input')!, 'Consigne UI')
    setText(host.querySelector('dialog textarea')!, 'Coordonnées à vérifier dans les documents.')
    categorySelect = host.querySelectorAll<HTMLSelectElement>('dialog select')[1]
    flushSync(() => { categorySelect.value = 'health'; categorySelect.dispatchEvent(new Event('change', { bubbles: true })) })
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.querySelectorAll('.practical-card').length === 2)
    const filter = host.querySelector<HTMLSelectElement>('.practical-filters select')!
    flushSync(() => { filter.value = 'health'; filter.dispatchEvent(new Event('change', { bubbles: true })) })
    assert(host.querySelectorAll('.practical-card').length === 1 && host.querySelector('.practical-card')?.textContent?.includes('Consigne UI'), 'Filtre de catégorie UI incorrect.')
    flushSync(() => { filter.value = 'all'; filter.dispatchEvent(new Event('change', { bubbles: true })) })
    setInput(host.querySelector('input[type="search"]')!, 'RENDEZ-VOUS')
    flushSync(() => button('Supprimer').click()); flushSync(() => button('Confirmer la suppression').click())
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Aucune information ne correspond') === true)
    assert((await repo.read(uiTrip.id)).records.length === 1 && (await repo.read(uiTrip.id)).activities.length === 1, 'Suppression d’adresse fusionnée efface la source.')
    setInput(host.querySelector('input[type="search"]')!, '')
    assert(host.textContent?.includes('Depuis les activités'), 'Adresse source masquée après retrait de la fiche manuelle.')
    render({ ...trip, id: 'other' }); await wait(() => host.textContent?.includes('Aucune information pratique') === true)
    const failed = { ...repo, read: async () => { throw new Error('Lecture refusée') } }
    flushSync(() => root.render(<PracticalNotebook trip={trip} repository={failed} onClose={() => {}} />)); await wait(() => host.textContent?.includes('Réessayer le carnet') === true)
    assert(!host.textContent?.includes('Aucune information pratique'), 'Erreur présentée comme liste vide.')
    report('Infos pratiques : CRUD/types/catégories/recherche, tel/mailto/adresse échappés, copie simulée/refus/HTTP manuel, sources réutilisées sans écriture, concurrence/rollback/deux connexions, duplication/ZIP/persistance, avertissement, focus, offline et 320/375/desktop.')
  } finally { flushSync(() => root.unmount()); host.remove(); second.close(); await database.delete(); await target.delete(); window.dispatchEvent(new Event(offline ? 'offline' : 'online')) }
}
