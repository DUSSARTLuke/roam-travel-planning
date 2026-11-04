import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { coordinateFormValue, coordinateInput, isCoordinateDraft, validateCoordinates } from '../src/db/activityLocation'
import { validateActivity, type TripActivityInput } from '../src/db/activityModel'
import { RoamDatabase } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { activityFormInput, initialActivityValues } from '../src/components/program/activityFormModel'
import { ActivityLocationDetails } from '../src/components/program/ActivityLocationDetails'
import { ActivityLocationFields } from '../src/components/program/ActivityLocationFields'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function assertFormField(name: string, actual: unknown, expected: unknown) {
  const describe = (value: unknown) => `${typeof value === 'string' ? JSON.stringify(value) : String(value)} (${typeof value})`
  assert(actual === expected, `Formulaire non normalisé — ${name} : attendu ${describe(expected)}, reçu ${describe(actual)}.`)
}
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Localisation invalide acceptée.')
}
const input: TripActivityInput = { title: 'Test lieu', category: 'visit', date: null, scheduleType: 'unscheduled', period: null, sortOrder: 0 }
export async function testActivityLocation(report: (message: string) => void) {
  for (const value of ['', '-', '.', ',', '-.', '-,', '51,', '-0.', '51,5074', '-0.1278', '0']) assert(isCoordinateDraft(value), `Saisie intermédiaire refusée : ${value}`)
  for (const value of ['test', '51a', '+1', '1-2', '--1', '1.2,3', '1,,2', '1e-7', ' 1', '1 ', '1\n', '1\t', '１２']) assert(!isCoordinateDraft(value), `Caractères interdits acceptés : ${JSON.stringify(value)}`)
  for (const value of [0, -0.1278, 51.5074, 1e-7, -1.23456789e-12, Number.MIN_VALUE]) {
    const text = coordinateFormValue(value)
    assert(isCoordinateDraft(text) && coordinateInput(text, 'Test') === value, 'Affichage décimal a altéré une coordonnée existante.')
  }
  assert(coordinateFormValue(undefined) === '', 'Coordonnée absente devenue zéro.')

  for (const [text, expected] of [['51,5194', 51.5194], ['-0.1270', -0.127], [' 0 ', 0], ['1e-7', 0.0000001]] as const) assert(coordinateInput(text, 'Test') === expected, 'Coordonnée décimale incorrecte.')
  assert(coordinateInput('', 'Test') === undefined && coordinateInput('  ', 'Test') === undefined, 'Coordonnée vide devenue zéro.')
  for (const text of ['NaN', 'Infinity', '1,2.3', '1 000', '12xyz', '1e999']) await rejects(() => coordinateInput(text, 'Test'))
  for (const [lat, lon] of [[90, 180], [-90, -180], [0, 0], [51.5194, -0.127]]) {
    const result = validateCoordinates(lat, lon)
    assert(result.latitude === lat && result.longitude === lon, 'Coordonnées valides refusées.')
  }
  for (const [lat, lon] of [[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity], [null, 0], ['1', 2], [1, undefined], [undefined, 2]]) await rejects(() => validateCoordinates(lat, lon))
  assert(validateActivity(input).latitude === undefined, 'Coordonnées ajoutées à un ancien objet.')
  const form = initialActivityValues(null, null, '2028-01-01')
  form.title = 'Lieu'; form.location = 'Musée'; form.address = 'Rue test'; form.latitude = '51,5194'; form.longitude = '-0,1270'
  const formInput = activityFormInput(form, null)
  assertFormField('address avant validation', formInput.address, 'Rue test')
  const parsed = validateActivity(formInput)
  assertFormField('location', parsed.location, 'Musée')
  assertFormField('address après validation', parsed.address, 'Rue test')
  assertFormField('latitude', parsed.latitude, 51.5194)
  assertFormField('longitude', parsed.longitude, -0.127)
  // Keep the exact failing fixture above; exercise both decimal separators,
  // whitespace and zero through the full form -> validator pipeline as well.
  for (const [latitude, longitude, expectedLatitude, expectedLongitude] of [
    ['51,5194', '-0,1270', 51.5194, -0.127],
    [' 51.5194 ', ' -0.1270 ', 51.5194, -0.127],
    ['0', '0', 0, 0],
  ] as const) {
    const draft = { ...form, location: ' Musée ', address: ' Rue test ', latitude, longitude }
    const before = JSON.stringify(draft)
    const normalized = validateActivity(activityFormInput(draft, null))
    assertFormField('location', normalized.location, 'Musée')
    assertFormField('address', normalized.address, 'Rue test')
    assertFormField('latitude', normalized.latitude, expectedLatitude)
    assertFormField('longitude', normalized.longitude, expectedLongitude)
    assert(JSON.stringify(draft) === before, 'La normalisation a modifié le brouillon.')
  }
  const legacyForm = initialActivityValues(null, null, '2028-01-01')
  legacyForm.title = 'Ancien lieu'; legacyForm.location = 'Lieu historique'
  const legacyInput = validateActivity(activityFormInput(legacyForm, null))
  assertFormField('location historique', legacyInput.location, 'Lieu historique')
  assertFormField('address absente', legacyInput.address, undefined)
  assertFormField('latitude absente', legacyInput.latitude, undefined)
  assertFormField('longitude absente', legacyInput.longitude, undefined)
  const host = document.createElement('div')
  document.body.append(host)
  const previousFocus = document.activeElement
  const root = createRoot(host)
  function Fields() {
    const [values, setValues] = useState({ ...form, latitude: '', longitude: '' })
    return <ActivityLocationFields form={values} onChange={setValues} />
  }
  try {
    flushSync(() => root.render(<Fields />))
    host.querySelector('details')!.open = true
    const inputs = host.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    function propose(input: HTMLInputElement, value: string, inputType = 'insertText') {
      flushSync(() => {
        setter.call(input, value)
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
      })
    }
    for (const input of inputs) {
      assert(input.type === 'text' && input.inputMode === 'decimal', 'Clavier mobile/type modifié.')
      for (const value of ['-', '-0.', '-0.1278', '51,', '51,5074']) {
        propose(input, value)
        assert(input.value === value, 'Valeur intermédiaire non conservée.')
      }
      for (const value of ['test', '51,5074x', '1.2,3', '+1']) {
        propose(input, value, 'insertFromPaste')
        assert(input.value === '51,5074', 'Collage invalide accepté ou ancienne valeur perdue.')
      }
      propose(input, '-0,1278', 'insertFromPaste')
      assert(input.value === '-0,1278', 'Collage décimal français refusé.')
      input.focus(); input.setSelectionRange(1, 4, 'backward')
      flushSync(() => input.dispatchEvent(new Event('select', { bubbles: true })))
      flushSync(() => input.dispatchEvent(new Event('paste', { bubbles: true })))
      propose(input, '-test1278', 'insertFromPaste')
      assert(input.value === '-0,1278' && input.selectionStart === 1 && input.selectionEnd === 4 && input.selectionDirection === 'backward', 'Sélection perdue après rejet du collage.')
      const shortcut = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
      input.dispatchEvent(shortcut)
      assert(!shortcut.defaultPrevented, 'Raccourci clavier bloqué.')
      propose(input, '0')
      assert(String(input.value) === '0', 'Remplacement de sélection valide refusé.')
    }
  } finally {
    flushSync(() => root.unmount())
    host.remove()
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
  }
  const renderedForm = renderToStaticMarkup(<ActivityLocationFields form={form} onChange={() => { throw new Error('Mutation au rendu') }} />)
  assert(renderedForm.includes('Latitude') && renderedForm.includes('Longitude') && renderedForm.includes('Effacer la localisation'), 'Champs de lieu absents.')
  const database = new RoamDatabase(`roam-v2-test-location-${crypto.randomUUID()}`)
  const restored = new RoamDatabase(`roam-v2-test-location-restored-${crypto.randomUUID()}`)
  try {
    await database.open(); await restored.open()
    // Both isolated databases are seeded with london-2026. Use a distinct
    // parent so restoration imports our fixtures instead of skipping them.
    const tripId = 'location-test-trip'
    await database.trips.add({ id: tripId, destination: 'Test localisation', country: 'Test',
      startDate: '2028-01-01', endDate: '2028-01-02', travelers: 1, image: '' })
    assert(!await restored.trips.get(tripId), 'Le voyage de test existe déjà dans la cible.')
    const repository = createActivityRepository(database)
    const old = await repository.createActivity(tripId, { ...input, location: 'Lieu historique' })
    assert(old.address === undefined && old.latitude === undefined, 'Lieu historique modifié.')
    const located = await repository.createActivity(tripId, parsed)
    const html = renderToStaticMarkup(<ActivityLocationDetails activity={located} />)
    assert(html.includes('Musée') && html.includes('Rue test') && html.includes('51,5194') && html.includes('-0,127'), 'Fiche localisation incomplète.')
    assert(renderToStaticMarkup(<ActivityLocationDetails activity={{ ...old, location: undefined }} />) === '', 'Section vide affichée.')
    const copied = await repository.createActivity(tripId, { ...located, title: 'Copie test' })
    assert(copied.id !== located.id && copied.latitude === located.latitude && copied.address === located.address, 'Création depuis une activité a perdu le lieu.')
    const updated = await repository.updateActivity(located.tripId, located.id, { ...input, title: 'Autre titre' })
    assert(updated.latitude === located.latitude && updated.longitude === located.longitude && updated.location === located.location && updated.address === located.address, 'Modification partielle a effacé le lieu.')
    await rejects(() => repository.updateActivity(located.tripId, located.id, { ...input, latitude: 20 }))
    const initial = initialActivityValues(updated, null, '2028-01-01')
    const concurrent = { ...updated, latitude: 12, longitude: 34 }
    const retained = activityFormInput(initial, concurrent, initial)
    assert(retained.latitude === 12 && retained.longitude === 34, 'Coordonnées concurrentes perdues.')
    const changedPair = activityFormInput({ ...initial, latitude: '13' }, concurrent, initial)
    assert(changedPair.latitude === 13 && changedPair.longitude === updated.longitude, 'Paire mélangée silencieusement entre deux versions.')
    const clear = { ...initial, location: '', address: '', latitude: '', longitude: '' }
    const cleared = await repository.updateActivity(located.tripId, located.id, activityFormInput(clear, updated, initial))
    assert(cleared.location === undefined && cleared.address === undefined && cleared.latitude === undefined && cleared.longitude === undefined && cleared.id === located.id, 'Effacement du lieu a échoué ou supprimé l’activité.')
    await repository.updateActivity(old.tripId, old.id, { ...input, location: 'Lieu renommé' })
    database.close(); await database.open()
    assert((await repository.getActivity(copied.tripId, copied.id)).latitude === copied.latitude, 'Coordonnées perdues après réouverture.')
    const archive = await buildExportArchive(await readExportSnapshot({ mode: 'full' }, database))
    const prepared = await prepareRestore(archive.blob)
    const preview = await previewRestore(prepared, restored)
    assert(preview.importing.some((trip) => trip.id === tripId), 'Le voyage contenant les localisations doit être importé.')
    assert(preview.skipped.some((trip) => trip.id === 'london-2026'), 'Le voyage préexistant doit rester ignoré.')
    await restoreBackup(prepared, preview, restored)
    const restoredCopy = await restored.activities.get(copied.id)
    assert(restoredCopy, 'Activité de localisation absente après restauration du voyage de test.')
    assert(JSON.stringify(restoredCopy) === JSON.stringify(await database.activities.get(copied.id)), 'Localisation altérée par le ZIP.')
    assert((await restored.activities.get(old.id))?.latitude === undefined, 'Ancienne sauvegarde enrichie artificiellement.')
    const invalid = await readExportSnapshot({ mode: 'full' }, database)
    const partial = invalid.activities.find((activity) => activity.id === copied.id)!
    delete partial.longitude
    await rejects(async () => prepareRestore((await buildExportArchive(invalid)).blob))
    for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 0, longitude: '1' }]) {
      await rejects(() => validateActivity({ ...input, ...bad } as TripActivityInput))
    }
    report('Localisation : validation, point/virgule, paire/limites/zéro, rendu, CRUD, historique, copie via API, préservation, réouverture et ZIP (bases isolées).')
  } finally {
    database.close(); restored.close()
    await database.delete(); await restored.delete()
  }
}
