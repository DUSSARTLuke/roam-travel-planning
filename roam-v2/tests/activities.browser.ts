import { testTripBudget } from './tripBudget.browser'
import { testTripMapMobile } from './tripMapMobile.browser'
import { testTripMapTransfers } from './tripMapTransfers.browser'
import { testTripMapFiltering } from './tripMapFiltering.browser'
import { testBackupHttp } from './backupHttp.browser'
import { testActivitySave } from './activitySave.browser'
import { testTripMap } from './tripMap.browser'
import { testTransferFormActivities } from './transferFormActivities.browser'
import { testTransferAvailability } from './transferAvailability.browser'
import { testMultiDay } from './multiDay.browser'
import { testTransfers } from './transfers.browser'
import { testActivityOrganization } from './activityOrganization.browser'
import { testDayPlanning } from './dayPlanning.core'
import { testDayPlanningUI } from './dayPlanning.browser'
import { testMapPreviewCore } from './mapPreview.core'
import { testMapPreviewUI } from './mapPreview.browser'
import { testPlaceProvider, testPlaceController, testPlaceSearchUI } from './placeSearch.browser'
import { testActivityLocation } from './activityLocation.browser'
import { testActivityMoney } from './activityMoney.browser'
import { testAutomaticRatesPure, testAutomaticRatesPersistence } from './automaticRates.browser'
import { testManualRatesPure, testManualRatesPersistence } from './manualRates.browser'
import { testMoney } from './money.browser'
import { testCurrencySelector } from './currencySelector.browser'
import { testCurrencies } from './currency.browser'
import Dexie from 'dexie'
import { testPwaUpdates } from './pwa-updates.browser'
import { testRestore } from './restore.browser'
import { testBackups } from './backups.browser'
import { testNativePdfPreview } from './nativePdfPreview.browser'
import { testDocuments } from './documents.browser'
import { testAdvancedActivities } from './activityAdvanced.browser'
import { activityFormInput, initialActivityValues } from '../src/components/program/activityFormModel'
import { RoamDatabase, updateTripTrash, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { validateActivity, type TripActivityInput } from '../src/db/activityModel'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function rejects(operation: () => unknown | Promise<unknown>) {
  let rejected = false
  try { await operation() } catch { rejected = true }
  assert(rejected, 'Une opération invalide a été acceptée.')
}

const input: TripActivityInput = {
  title: 'Visite test', category: 'visit', date: '2028-02-29',
  scheduleType: 'exact', startTime: '09:30', endTime: '10:00', period: null, sortOrder: 0,
}

async function run(report: (message: string) => void) {
  const name = `roam-v2-test-activities-${crypto.randomUUID()}`
  const legacy = new Dexie(name)
  const database = new RoamDatabase(name)
  try {
    // Create only synthetic fixtures, in an isolated V2 database.
    legacy.version(2).stores({ trips: 'id, destination, startDate, endDate', metadata: 'key' })
    const trip: Trip = { id: 'test-a', destination: 'Test A', country: 'Test', startDate: '2028-02-28',
      endDate: '2028-03-01', travelers: 2, image: '', archived: false }
    const trips = [trip, { ...trip, id: 'test-b', destination: 'Test B', archived: true }]
    const metadata = [{ key: 'initialization', initialized: true }, { key: 'test-sentinel', value: 'unchanged' }]
    await legacy.table('trips').bulkAdd(trips)
    await legacy.table('metadata').bulkAdd(metadata)
    legacy.close()
    await database.open()
    assert(JSON.stringify(await database.trips.toArray()) === JSON.stringify(trips), 'Voyages modifiés par la migration.')
    assert(JSON.stringify(await database.metadata.toArray()) === JSON.stringify(metadata), 'Métadonnées modifiées par la migration.')
    assert(await database.activities.count() === 0, 'Activités fictives créées par la migration.')
    report('Migration V2 → V3 : voyages et métadonnées conservés, activités vides.')

    const repo = createActivityRepository(database)
    await testAdvancedActivities(repo, 'test-a')
    report('Réservation, multidevise, liens : validations, compatibilité et préservation après écriture.')
    const a = await repo.createActivity('test-a', input)
    const period = await repo.createActivity('test-a', { ...input, scheduleType: 'period', period: 'afternoon', startTime: undefined, endTime: undefined })
    const unscheduled = await repo.createActivity('test-a', { title: 'Sans heure', category: 'rest', date: input.date,
      scheduleType: 'unscheduled', period: null, sortOrder: 0 })
    const idea = await repo.createActivity('test-a', { ...input, date: null })
    const other = await repo.createActivity('test-b', input)
    assert(new Set([a.id, period.id, unscheduled.id, idea.id, other.id]).size === 5, 'Identifiants non uniques.')
    assert(a.createdAt === a.updatedAt && !Number.isNaN(Date.parse(a.createdAt)), 'Horodatages invalides.')
    assert((await repo.getActivity('test-a', a.id)).startTime === '09:30', 'Lecture incorrecte.')
    assert((await repo.listActivities('test-a', null))[0].id === idea.id, 'Idées non isolées.')
    assert((await repo.listActivities('test-a', input.date)).length === 3, 'Recherche par date incorrecte.')
    assert((await repo.listActivities('test-b')).length === 1, 'Fuite entre voyages.')
    const order = await repo.listActivities('test-a')
    assert(order.map((activity) => activity.id).join() === [a.id, period.id, unscheduled.id, idea.id].join(), 'Tri incorrect.')
    assert((await repo.listActivities('test-a')).map((activity) => activity.id).join() === order.map((activity) => activity.id).join(), 'Tri instable.')
    report('CRUD lecture/création : trois modes, idées, index voyage/date et isolation.')

    const updated = await repo.updateActivity('test-a', a.id, { title: 'Modifiée', category: 'other', date: null,
      scheduleType: 'unscheduled', period: null, sortOrder: -1 })
    assert(updated.id === a.id && updated.createdAt === a.createdAt && updated.tripId === a.tripId, 'Identité modifiée.')
    assert(!('startTime' in updated) && !('endTime' in updated), 'Horaires obsolètes conservés.')
    await rejects(() => repo.getActivity('test-b', a.id))
    await rejects(() => repo.updateActivity('test-b', a.id, input))
    await rejects(() => repo.deleteActivity('test-b', a.id))
    await rejects(() => repo.createActivity('absent', input))
    await repo.deleteActivity('test-a', a.id)
    await rejects(() => repo.getActivity('test-a', a.id))
    report('Modification complète, préservation identité/création, suppression et refus inter-voyages.')

    // Same input adapter as the UI: hidden advanced fields must survive every mode.
    let formActivity = await repo.createActivity('test-a', { ...input, estimatedCost: 42, currency: 'EUR',
      reservationStatus: 'confirmed', url: 'https://example.com/test', sortOrder: 7 })
    for (const scheduleType of ['period', 'unscheduled', 'exact'] as const) {
      const form = initialActivityValues(formActivity, input.date, '2026-12-31')
      form.scheduleType = scheduleType
      form.startTime = '11:00'
      form.endTime = '12:00'
      form.period = 'evening'
      form.date = '2027-01-01'
      const latest = await repo.getActivity('test-a', formActivity.id)
      formActivity = await repo.updateActivity('test-a', latest.id, activityFormInput(form, latest))
      assert(formActivity.scheduleType === scheduleType && formActivity.date === '2027-01-01', 'Mode/date du formulaire incorrect.')
      assert(formActivity.estimatedCost === 42 && formActivity.currency === 'EUR' &&
        formActivity.reservationStatus === 'confirmed' && formActivity.url === 'https://example.com/test' &&
        formActivity.sortOrder === 7, 'Champ avancé perdu par le formulaire.')
      if (scheduleType !== 'exact') assert(!('startTime' in formActivity) && !('endTime' in formActivity), 'Horaires cachés conservés.')
    }
    const ideaForm = initialActivityValues(formActivity, input.date, '2026-12-31')
    ideaForm.idea = true
    formActivity = await repo.updateActivity('test-a', formActivity.id, activityFormInput(ideaForm, formActivity))
    assert(formActivity.date === null, 'Idée du formulaire datée par erreur.')
    assert(initialActivityValues(null, '2026-12-31', '2026-12-28').date === '2026-12-31', 'Journée par défaut incorrecte.')
    assert(initialActivityValues(null, null, '2026-12-28').idea, 'Création idée incorrecte.')
    await repo.deleteActivity('test-a', formActivity.id)
    report('Formulaire : trois modes, décembre/janvier, idées, champs avancés conservés après persistance.')

    const invalid = [
      { title: ' ' }, { category: 'invalid' }, { date: '2027-02-29' }, { date: '2028-02-30' },
      { startTime: undefined }, { startTime: '24:00' }, { endTime: '08:00' }, { period: 'morning' },
      { scheduleType: 'period', period: null }, { scheduleType: 'period', period: 'morning' },
      { scheduleType: 'unscheduled', period: null }, { scheduleType: 'invalid' },
      { estimatedCost: -1 }, { estimatedCost: NaN }, { sortOrder: Infinity },
      { currency: 'EURO' }, { url: 'javascript:alert(1)' }, { reservationStatus: 'invalid' },
    ]
    const before = await database.activities.count()
    for (const patch of invalid) await rejects(() => repo.createActivity('test-a', { ...input, ...patch } as TripActivityInput))
    assert(await database.activities.count() === before, 'Écriture partielle après validation échouée.')
    assert(validateActivity({ ...input, currency: 'eur', estimatedCost: 0 }).currency === 'EUR', 'Normalisation incorrecte.')
    assert(validateActivity({ ...input, date: null }).date === null, 'Date nulle rejetée en mode exact.')
    report('Validation : horaires, dates calendaires, titre, coût, devise, URL et classement.')

    // Archiving and trashing retain activities. Restore preserves archived.
    await updateTripTrash('test-b', 'trash', undefined, database)
    const trashed = (await database.trips.get('test-b'))!
    assert((await repo.listActivities('test-b')).length === 1, 'Activités perdues à la mise à la corbeille.')
    await rejects(() => repo.createActivity('test-b', input))
    await updateTripTrash('test-b', 'restore', undefined, database)
    assert((await database.trips.get('test-b'))!.archived === true, 'Statut archivé perdu.')
    await rejects(() => updateTripTrash('test-b', 'delete', trashed.deletedAt, database))
    assert(await database.activities.get(other.id), 'Activité supprimée malgré restauration concurrente.')
    report('Corbeille/restauration : activités conservées, suppression refusée après restauration.')

    await updateTripTrash('test-b', 'trash', undefined, database)
    const token = (await database.trips.get('test-b'))!.deletedAt
    // Force a failure after cascade deletion: the entire transaction must roll back.
    function failDelete() { throw new Error('Échec de test volontaire') }
    database.trips.hook('deleting', failDelete)
    await rejects(() => updateTripTrash('test-b', 'delete', token, database))
    database.trips.hook('deleting').unsubscribe(failDelete)
    assert(await database.trips.get('test-b'), 'Voyage perdu après rollback.')
    assert(await database.activities.get(other.id), 'Cascade non atomique.')
    await updateTripTrash('test-b', 'delete', token, database)
    assert(!await database.trips.get('test-b') && !await database.activities.get(other.id), 'Cascade incomplète.')
    assert((await repo.listActivities('test-a')).length === 3, 'Autre voyage affecté par la cascade.')
    report('Cascade transactionnelle : rollback sur erreur et isolation du voyage voisin.')

    await updateTripTrash('test-a', 'trash', undefined, database)
    const currentToken = (await database.trips.get('test-a'))!.deletedAt
    await Promise.allSettled([
      repo.createActivity('test-a', input),
      updateTripTrash('test-a', 'delete', currentToken, database),
    ])
    assert(!await database.trips.get('test-a') && await database.activities.count() === 0, 'Activités orphelines après concurrence.')
    report('Écriture concurrente et suppression : aucune activité orpheline.')
  } finally {
    legacy.close()
    database.close()
    await database.delete()
  }
}

const button = document.querySelector<HTMLButtonElement>('#run')!
const results = document.querySelector<HTMLElement>('#results')!
button.addEventListener('click', async () => {
  button.disabled = true
  results.textContent = ''
  try {
    await testActivitySave((message) => { results.textContent += `✓ ${message}\n` })
    await testTripBudget((message) => { results.textContent += `✓ ${message}\n` })
    await testTripMapMobile((message) => { results.textContent += `✓ ${message}\n` })
    await testTripMapTransfers((message) => { results.textContent += `✓ ${message}\n` })
    await testTripMapFiltering((message) => { results.textContent += `✓ ${message}\n` })
    await testTripMap((message) => { results.textContent += `✓ ${message}\n` })
    await testTransferFormActivities((message) => { results.textContent += `✓ ${message}\n` })
    await testTransferAvailability((message) => { results.textContent += `✓ ${message}\n` })
    await testMultiDay((message) => { results.textContent += `✓ ${message}\n` })
    await testTransfers((message) => { results.textContent += `✓ ${message}\n` })
    await testActivityOrganization((message) => { results.textContent += `✓ ${message}\n` })
    testDayPlanning((message) => { results.textContent += `✓ ${message}\n` })
    await testDayPlanningUI((message) => { results.textContent += `✓ ${message}\n` })
    await testMapPreviewCore((message) => { results.textContent += `✓ ${message}\n` })
    await testMapPreviewUI((message) => { results.textContent += `✓ ${message}\n` })
    await testPlaceProvider((message) => { results.textContent += `✓ ${message}\n` })
    await testPlaceController((message) => { results.textContent += `✓ ${message}\n` })
    await testPlaceSearchUI((message) => { results.textContent += `✓ ${message}\n` })
    await testActivityLocation((message) => { results.textContent += `✓ ${message}\n` })
    testActivityMoney((message) => { results.textContent += `✓ ${message}\n` })
    await testAutomaticRatesPure((message) => { results.textContent += `✓ ${message}\n` })
    await testAutomaticRatesPersistence((message) => { results.textContent += `✓ ${message}\n` })
    await testManualRatesPure((message) => { results.textContent += `✓ ${message}\n` })
    await testManualRatesPersistence((message) => { results.textContent += `✓ ${message}\n` })
    testMoney((message) => { results.textContent += `✓ ${message}\n` })
    testCurrencySelector((message) => { results.textContent += `✓ ${message}\n` })
    testPwaUpdates((message) => { results.textContent += `✓ ${message}\n` })
    testNativePdfPreview((message) => { results.textContent += `✓ ${message}\n` })
    await run((message) => { results.textContent += `✓ ${message}\n` })
    await testDocuments((message) => { results.textContent += `✓ ${message}\n` })
    await testCurrencies((message) => { results.textContent += `✓ ${message}\n` })
    await testBackupHttp((message) => { results.textContent += `✓ ${message}\n` })
    await testBackups((message) => { results.textContent += `✓ ${message}\n` })
    await testRestore((message) => { results.textContent += `✓ ${message}\n` })
    results.textContent += '\nTous les tests ont réussi. Base de test supprimée.'
  } catch (error) {
    results.textContent += `\nÉCHEC : ${String(error)}`
  } finally {
    button.disabled = false
  }
})
