import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createPracticalRepository, copyPracticalRecords } from '../src/db/practical'
import { contactFieldErrors, phoneLink, emailLink, normalizePracticalInput } from '../src/practical/model'
import { PracticalNotebook } from '../src/components/practical/PracticalNotebook'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown) { let failed = false; try { await action() } catch { failed = true }; assert(failed, 'Coordonnée invalide enregistrée.') }
export async function testContactValidation(report: (message: string) => void) {
  for (const phone of ['+33 1 23 45 67 89', '+1 (202) 555-0100', '01 23 45 67 89', '123', '+44\u00a020\u202f1234-5678']) assert(!contactFieldErrors(phone, '').phone && phoneLink(phone).startsWith('tel:'), 'Téléphone international/local plausible refusé.')
  for (const phone of ['1', '12', '+123', '+01234567', '1234567890123456', '12abc34567', '++33123456789', '33+12345678', '(0123456789', '01)23456789', '((01))23456789', '+33 () 123456789', '123\n456']) assert(Boolean(contactFieldErrors(phone, '').phone), `Téléphone invalide accepté : ${phone}`)
  for (const phone of ['+33612345678', '0612345678', '0033 6 12 34 56 78', '+33 (6) 12-34.56.78', '06 12 34 56 78', '+44 20 1234 5678', '0044 20 1234 5678']) assert(!contactFieldErrors(phone, '').phone && phoneLink(phone).startsWith('tel:'), 'Numéro français/international valide refusé.')
  for (const phone of ['+336666699', '00336666699', '06666699', '+330612345678', '00330612345678', '001', '0001234567', '001234567890123456', '06123456789']) {
    assert(Boolean(contactFieldErrors(phone, '').phone), `Téléphone incomplet accepté : ${phone}`)
    await rejects(() => phoneLink(phone))
    await rejects(() => normalizePracticalInput({ kind: 'contact', title: 'Test', category: 'other', phone }))
  }
  assert(phoneLink('0033 6 12 34 56 78') === 'tel:+33612345678', 'Préfixe international 0033 mal construit.')
  for (const email of ['a@example.invalid', 'first.last+tag@example.invalid', '  a@example.invalid  ']) assert(!contactFieldErrors('', email).email && emailLink(email).startsWith('mailto:'), 'E-mail raisonnable refusé.')
  for (const email of ['a b@example.invalid', 'a@example .invalid', 'a..b@example.invalid', '.a@example.invalid', 'a.@example.invalid', 'a@@example.invalid', 'a@', 'a@invalid', 'a'.repeat(65) + '@example.invalid', 'a@' + 'b'.repeat(64) + '.invalid', 'a'.repeat(250) + '@example.invalid']) assert(Boolean(contactFieldErrors('', email).email), 'Format/longueur e-mail non vérifié.')
  assert(!Object.keys(contactFieldErrors('', '   ')).length, 'Champs facultatifs vides refusés.')
  const empty = normalizePracticalInput({ kind: 'contact', title: 'Nom seul', category: 'other', phone: '', email: '  ' })
  assert(empty.kind === 'contact' && empty.phone === undefined && empty.email === undefined, 'Champs vides stockés comme faux contacts.')
  const trip: Trip = { id: 'contacts', destination: 'Contacts test', country: 'Test', startDate: '2026-12-31', endDate: '2027-01-02', travelers: 1, image: '' }
  const stamp = '2026-11-05T12:00:00.000Z'
  const legacy = { id: 'legacy', title: 'Ancien contact', kind: 'contact' as const, category: 'other' as const, phone: '+336666699', email: 'ancien e mail invalide', createdAt: stamp, updatedAt: stamp }
  const database = new RoamDatabase(`roam-v2-test-contact-validation-${crypto.randomUUID()}`), repo = createPracticalRepository(database)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const wait = async (condition: () => boolean) => { const end = performance.now() + 5000; while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20)); assert(condition(), 'Validation des contacts non actualisée.') }
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label)!
  const set = (selector: string, value: string) => flushSync(() => { const input = host.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  try {
    await database.trips.add({ ...trip, practicalRecords: [legacy] })
    await database.trips.add({ ...trip, id: 'legacy-delete', practicalRecords: [legacy] })
    const removable = (await repo.read('legacy-delete')).records[0]
    await repo.remove('legacy-delete', removable.id, JSON.stringify(removable))
    assert((await repo.read('legacy-delete')).records.length === 0, 'Ancien contact invalide impossible à supprimer.')
    const snapshot = await repo.read(trip.id)
    assert(snapshot.records[0].kind === 'contact' && snapshot.records[0].phone === legacy.phone, 'Ancien contact bloque la lecture ou est transformé.')
    const clone = copyPracticalRecords(snapshot.records).practicalRecords![0]
    assert(clone.kind === 'contact' && clone.phone === legacy.phone && clone.email === legacy.email, 'Duplication efface des données historiques.')
    await repo.save(trip.id, { kind: 'note', category: 'other', title: 'Autre fiche', notes: 'Sans toucher au contact' })
    assert((await database.trips.get(trip.id))!.practicalRecords![0].kind === 'contact' && (await repo.read(trip.id)).records[0].id === legacy.id, 'Autre fiche bloquée par le contact ancien.')
    const before = JSON.stringify((await database.trips.get(trip.id))!.practicalRecords)
    for (const input of [{ kind: 'contact' as const, title: 'Invalid phone', category: 'other' as const, phone: '+336666699' }, { kind: 'contact' as const, title: 'Invalid email', category: 'other' as const, email: 'a..b@example.invalid' }]) await rejects(() => repo.save(trip.id, input))
    assert(JSON.stringify((await database.trips.get(trip.id))!.practicalRecords) === before, 'Refus de validation a écrit des données.')
    flushSync(() => root.render(<PracticalNotebook trip={trip} repository={repo} onClose={() => {}} />))
    await wait(() => host.textContent?.includes('Ancien contact') === true)
    assert(host.textContent?.includes('Téléphone à vérifier') && host.textContent.includes('E-mail à vérifier') && !host.querySelector('a[href^="tel:"]') && !host.querySelector('a[href^="mailto:"]'), 'Anciennes valeurs invalides créent des liens ou bloquent l’affichage.')
    const card = host.querySelector(`[data-practical-key="record:${legacy.id}"]`)!
    flushSync(() => [...card.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Modifier')!.click())
    await wait(() => Boolean(host.querySelector('dialog input[type="tel"]')))
    assert(host.querySelector<HTMLInputElement>('dialog input[type="tel"]')!.value === legacy.phone && host.querySelector<HTMLInputElement>('dialog input[type="email"]')!.value === legacy.email, 'Édition efface les valeurs anciennes.')
    const storedBeforeInvalidSubmit = JSON.stringify(await database.trips.get(trip.id))
    assert(host.querySelector<HTMLFormElement>('dialog form')!.noValidate, 'Le navigateur peut masquer les messages sous les champs.')
    flushSync(() => button('Enregistrer la fiche').click())
    assert(document.activeElement === host.querySelector('dialog input[type="tel"]'), 'Le premier champ invalide ne reçoit pas le focus.')
    for (const type of ['tel', 'email']) {
      const input = host.querySelector<HTMLInputElement>(`dialog input[type="${type}"]`)!
      const id = input.getAttribute('aria-describedby')
      assert(input.getAttribute('aria-invalid') === 'true' && id && host.querySelector(`[id="${id}"]`)?.textContent, 'Erreur sous le champ non reliée/accessibilité absente.')
    }
    assert((await repo.read(trip.id)).records.length === 2 && JSON.stringify(await database.trips.get(trip.id)) === storedBeforeInvalidSubmit, 'Formulaire invalide enregistré.')
    set('dialog input[type="email"]', 'nom@example.invalid')
    flushSync(() => button('Enregistrer la fiche').click())
    assert(host.textContent?.includes('Numéro français incomplet') && JSON.stringify(await database.trips.get(trip.id)) === storedBeforeInvalidSubmit, 'Numéro français incomplet enregistré ou diagnostic absent.')
    set('dialog input[type="tel"]', '+33 (1) 23-45-67-89'); set('dialog input[type="email"]', 'nom+test@example.invalid')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && Boolean(host.querySelector('a[href="tel:+33123456789"]')))
    assert(host.querySelector('a[href^="mailto:nom%2Btest@"]'), 'Valeur corrigée ne produit pas de lien sûr.')
    flushSync(() => button('Ajouter une information').click()); set('dialog input', 'Sans coordonnées')
    flushSync(() => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await wait(() => !host.querySelector('dialog[open]') && host.textContent?.includes('Sans coordonnées') === true)
    assert((await repo.read(trip.id)).records.length === 3, 'Contact sans coordonnées refusé.')
    const saved = (await repo.read(trip.id)).records.find((item) => item.id === legacy.id)!
    await repo.remove(trip.id, legacy.id, JSON.stringify(saved))
    assert((await repo.read(trip.id)).records.length === 2, 'Suppression de contact impossible après correction.')
    report('Contacts : formats/longueurs/espaces, téléphone international souple/parenthèses/chiffres plausibles, facultatifs vides, repository strict sans écriture invalide, ancien contact lisible/copiable/corrigeable sans liens dangereux, erreurs sous champs et ARIA.')
  } finally { flushSync(() => root.unmount()); host.remove(); await database.delete() }
}
