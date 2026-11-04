import { renderToStaticMarkup } from 'react-dom/server'
import type { Trip } from '../src/db/database'
import type { TripActivity } from '../src/db/activityModel'
import { activityMoneyRows } from '../src/money/activityMoney'
import { ActivityMoneyDetails } from '../src/components/program/ActivityMoneyDetails'
import { ActivityAdvancedDetails } from '../src/components/program/ActivityAdvancedDetails'
import { AUTOMATIC_PROVIDER } from '../src/money/automaticRates'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export function testActivityMoney(report: (message: string) => void) {
  const today = '2026-11-10'
  const date = '2026-11-04T12:00:00.000Z'
  const activity: TripActivity = { id: 'money-view', tripId: 'trip-money', title: 'Test', category: 'visit', date: null,
    scheduleType: 'unscheduled', period: null, sortOrder: 0, createdAt: date, updatedAt: date, currency: 'JPY', estimatedCost: 1000, paidAmount: 0 }
  const trip: Trip = { id: activity.tripId, destination: 'Test', country: 'Test', startDate: '2028-01-01', endDate: '2028-01-02', travelers: 1, image: '',
    automaticExchangeRates: { rates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.006, rateDate: '2026-11-04', fetchedAt: date, provider: AUTOMATIC_PROVIDER }], checks: [] } }
  const original = JSON.stringify({ activity, trip })
  const rows = activityMoneyRows(activity, trip, today)
  assert(rows.length === 2 && rows[0].label === 'Prix estimé' && rows[1].label === 'Montant payé', 'Estimation/paiement confondus.')
  assert(rows[0].original.includes('JPY') && rows[0].original.includes('¥'), 'Symbole/code d’origine absent.')
  assert(rows[0].conversion?.text.includes('6,00') && rows[0].conversion.text.includes('EUR'), 'Équivalent automatique incorrect.')
  assert(rows[0].conversion.provenance.includes('Frankfurter V2') && rows[0].conversion.date === '2026-11-04' && rows[0].conversion.stale, 'Source/date/ancienneté absentes.')
  assert(rows[1].original.includes('0') && rows[1].conversion?.text.includes('0,00'), 'Zéro masqué.')
  const manual: Trip = { ...trip, manualExchangeRates: [{ sourceCurrency: 'JPY', targetCurrency: 'EUR', rate: 0.007, updatedAt: date }] }
  const preferred = activityMoneyRows(activity, manual, today)[0]
  assert(preferred.conversion?.text.includes('7,00') && preferred.conversion.provenance === 'Taux manuel' && preferred.conversion.date === date && !preferred.conversion.stale, 'Priorité/date manuelle incorrectes.')
  const same = activityMoneyRows({ ...activity, currency: 'EUR' }, manual, today)
  assert(same.every((row) => !row.conversion && !row.unavailable), 'Conversion redondante pour devise identique.')
  const missing = activityMoneyRows({ ...activity, currency: 'GBP' }, trip, today)
  assert(missing[0].original.includes('GBP') && missing[0].unavailable && !missing[0].conversion, 'Origine masquée sans taux.')
  const historic = activityMoneyRows({ ...activity, currency: undefined }, trip, today)
  assert(historic[0].original.includes('devise non renseignée') && historic[0].unavailable?.includes('devise'), 'EUR attribué à un historique sans devise.')
  assert(activityMoneyRows({ ...activity, estimatedCost: undefined, paidAmount: undefined }, trip, today).length === 0, 'Montant absent devenu zéro.')
  assert(activityMoneyRows({ ...activity, paidAmount: undefined }, trip, today).length === 1, 'Paiement absent affiché.')
  assert(activityMoneyRows({ ...activity, estimatedCost: null as unknown as number, paidAmount: undefined }, trip, today).length === 0, 'Valeur null présentée comme zéro.')
  assert(activityMoneyRows(activity, { ...trip, id: 'other' }, today).every((row) => !row.conversion), 'Taux utilisés depuis un autre voyage.')
  assert(!activityMoneyRows(activity, trip, '2026-11-07')[0].conversion?.stale && activityMoneyRows(activity, trip, '2026-11-08')[0].conversion?.stale, 'Seuil ancienneté incohérent.')
  assert(activityMoneyRows(activity, trip, '2026-11-03')[0].conversion?.future, 'Date future non signalée.')
  assert(activityMoneyRows({ ...activity, currency: 'ZZZ' }, trip, today)[0].original.includes('ZZZ'), 'Code historique masqué.')
  assert(JSON.stringify({ activity, trip }) === original, 'Affichage a modifié les données sources.')
  function render(value: TripActivity, context: Trip) {
    const template = document.createElement('template')
    template.innerHTML = renderToStaticMarkup(<ActivityMoneyDetails activity={value} trip={context} />)
    return template.content
  }
  const markup = render(activity, manual)
  assert(markup.querySelector('.activity-money-original') && markup.querySelector('.activity-money-equivalent') && markup.querySelector('time')?.getAttribute('datetime') === date, 'Montants/date non rendus.')
  const noRate = render({ ...activity, currency: 'GBP' }, trip)
  assert(noRate.textContent?.includes('Conversion indisponible') && noRate.textContent.includes('GBP'), 'Repli sans taux non visible.')
  const legacy = render({ ...activity, currency: undefined }, trip)
  assert(legacy.textContent?.includes('Devise') || legacy.textContent?.includes('devise non renseignée'), 'Historique non affiché.')
  const old: Trip = { ...trip, automaticExchangeRates: { rates: [{ ...trip.automaticExchangeRates!.rates[0], rateDate: '2000-01-01' }], checks: [] } }
  assert(render(activity, old).textContent?.includes('Taux automatique ancien'), 'Avertissement ancien absent.')
  const absent = render({ ...activity, currency: undefined, estimatedCost: undefined, paidAmount: undefined }, trip)
  assert(!absent.querySelector('section'), 'Section vide affichée.')
  const integrated = renderToStaticMarkup(<ActivityAdvancedDetails activity={activity} trip={manual} />)
  assert(integrated.includes('Taux manuel') && !integrated.includes('Aucune conversion de devise'), 'Fiche avancée non intégrée.')
  report('Affichage monétaire : origine/symbole/ISO, manuel/automatique, priorité, identité, indisponibilité, historique, zéro/absence, montants séparés, dates/ancienneté, rendu et immutabilité.')
}
