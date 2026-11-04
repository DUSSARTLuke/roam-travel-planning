import { RoamDatabase, type Trip } from '../src/db/database'
import { tripReferenceCurrency, validateCurrency } from '../src/db/currency'
import { createActivityRepository } from '../src/db/activities'
import { activityFormInput, initialActivityValues } from '../src/components/program/activityFormModel'
import { buildExportArchive, readExportSnapshot } from '../src/backup/exportBackup'
import { prepareRestore, previewRestore, restoreBackup } from '../src/backup/restoreBackup'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Une devise invalide a été acceptée.')
}
export async function testCurrencies(report: (message: string) => void) {
  assert(validateCurrency(' gbp ') === 'GBP', 'Normalisation incorrecte.')
  for (const code of ['', 'ZZZ', 'EU', 'EURO', 12, null]) await rejects(() => validateCurrency(code))
  const source = new RoamDatabase(`roam-v2-test-currency-source-${crypto.randomUUID()}`)
  const target = new RoamDatabase(`roam-v2-test-currency-target-${crypto.randomUUID()}`)
  try {
    await source.open(); await target.open()
    const legacy: Trip = { id: 'currency-legacy', destination: 'Test', country: 'Test', startDate: '2028-01-01',
      endDate: '2028-01-02', travelers: 1, image: '' }
    await source.trips.add(legacy)
    const stored = (await source.trips.get(legacy.id))!
    assert(tripReferenceCurrency(stored) === 'EUR' && stored.referenceCurrency === undefined, 'Ancien voyage réécrit.')
    const created = { ...legacy, id: 'currency-new', referenceCurrency: validateCurrency('GBP') }
    await source.trips.add(created)
    await source.trips.update(created.id, { referenceCurrency: validateCurrency('USD') })
    const updated = (await source.trips.get(created.id))!
    const copy = { ...updated, id: 'currency-copy', referenceCurrency: tripReferenceCurrency(updated) }
    await source.trips.add(copy)
    assert(copy.referenceCurrency === 'USD' && (await source.trips.get(legacy.id))!.referenceCurrency === undefined, 'Devise copie/original incorrecte.')
    const repo = createActivityRepository(source)
    const fresh = initialActivityValues(null, '2028-01-01', '2028-01-01', tripReferenceCurrency(updated))
    assert(fresh.currency === 'USD', 'Devise du voyage non proposée.')
    fresh.title = 'Test devise'; fresh.estimatedCost = '0'; fresh.paidAmount = '12.5'; fresh.currency = 'GBP'
    const activity = await repo.createActivity(created.id, activityFormInput(fresh, null))
    const historic = await repo.createActivity(legacy.id, { ...activityFormInput(fresh, null), currency: undefined })
    assert(initialActivityValues(historic, null, '2028-01-01', 'USD').currency === '', 'Devise imposée à une activité historique.')
    await source.trips.update(created.id, { referenceCurrency: 'EUR' })
    const after = await repo.getActivity(created.id, activity.id)
    assert(after.currency === 'GBP' && after.estimatedCost === 0 && after.paidAmount === 12.5, 'Montants modifiés par la devise de référence.')
    const roundTrip = async () => {
      const archive = await buildExportArchive(await readExportSnapshot({ mode: 'full' }, source))
      const prepared = await prepareRestore(archive.blob)
      await restoreBackup(prepared, await previewRestore(prepared, target), target)
    }
    await roundTrip()
    assert((await target.trips.get(copy.id))?.referenceCurrency === 'USD', 'Devise perdue dans le ZIP.')
    assert((await target.trips.get(legacy.id))?.referenceCurrency === undefined, 'Ancienne sauvegarde normalisée.')
    assert(JSON.stringify(await target.activities.get(activity.id)) === JSON.stringify(activity), 'Montants ou devise altérés à la restauration.')
    assert((await target.activities.get(historic.id))?.currency === undefined, 'Devise historique inventée.')
    const before = JSON.stringify(await target.trips.toArray())
    for (const invalid of ['ZZZ', '', 123, null]) {
      // Synthetic corrupt fixtures only; fresh inventory/hash so semantic validation is exercised.
      const snapshot = await readExportSnapshot({ mode: 'full' }, source)
      Object.assign(snapshot.trips.find((trip) => trip.id === copy.id)!, { referenceCurrency: invalid })
      const archive = await buildExportArchive(snapshot)
      await rejects(() => prepareRestore(archive.blob))
    }
    assert(JSON.stringify(await target.trips.toArray()) === before, 'Validation ZIP a modifié la base.')
    report('Devises : défaut EUR sans réécriture, codes, création/modification/copie, activités historiques, montants et ZIP format 1/V4.')
  } finally {
    source.close(); target.close()
    await source.delete(); await target.delete()
  }
}
