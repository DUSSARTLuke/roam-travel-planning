import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/database'
import { automaticRateService, requiredAutomaticPairs, type RefreshResult } from '../../db/automaticRates'
import { validateAutomaticCache } from '../../money/automaticRates'
import { connection } from '../../pwa/connection'
import { useReloadBlocker } from '../../pwa/useReloadBlocker'
import { useUtcDay } from '../../hooks/useUtcDay'
import './manual-rates.css'

function useAutomaticRates(tripId: string) {
  const data = useLiveQuery(async () => {
    const trip = await db.trips.get(tripId)
    if (!trip) return null
    const [activities,journeys,accommodations]=await Promise.all([db.activities.where('tripId').equals(tripId).toArray(),db.journeys.where('tripId').equals(tripId).toArray(),db.accommodations.where('tripId').equals(tripId).toArray()])
    return { trip, pairs: requiredAutomaticPairs(trip, activities, journeys, accommodations) }
  }, [tripId])
  const today = useUtcDay()
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  // Cache writes and tab navigation must not retrigger fetching. The service
  // also reserves persistently, so StrictMode and other tabs cannot duplicate it.
  const signature = JSON.stringify({ pairs: data?.pairs ?? [], refresh: data?.trip.automaticExchangeRates?.refresh?.id })
  useEffect(() => {
    if (!network.offline) void automaticRateService.refresh(tripId).catch((error: unknown) => { console.error('Actualisation automatique des taux impossible :', error) })
  }, [tripId, signature, network.offline, today])
  return { data, offline: network.offline, today }
}
export function AutomaticRatesController({ tripId }: { tripId: string }) {
  useAutomaticRates(tripId)
  return null
}
export function AutomaticRatesStatus({ tripId, disabled }: { tripId: string; disabled: boolean }) {
  const { data, offline, today } = useAutomaticRates(tripId)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useReloadBlocker(busy, 'Actualisation des taux en cours.')
  if (!data) return null
  let cache
  try { cache = validateAutomaticCache(data.trip.automaticExchangeRates) }
  catch { return <p role="alert">Le cache des taux est invalide. Aucun taux n’a été remplacé.</p> }
  const last = cache.checks.filter((item) => item.status === 'ok').map((item) => item.checkedAt).sort().at(-1)
  function summary(result: RefreshResult) {
    if (result.status === 'offline') return 'Hors connexion signalé : les derniers taux enregistrés restent disponibles.'
    if (result.status === 'busy') return 'Une actualisation est déjà en cours dans un onglet. Réessaie après sa fin.'
    if (result.status === 'obsolete') return 'Le voyage a changé pendant l’actualisation. Réessaie avec ses paramètres enregistrés.'
    if (result.status === 'cached') return 'Aucune paire supplémentaire à actualiser.'
    return `${result.fetched} taux reçus ; ${result.unavailable} paires non couvertes ; ${result.errors} erreurs. Les anciens taux valides sont conservés.`
  }
  async function refresh() {
    if (busy || disabled) return
    setBusy(true); setMessage('')
    try { setMessage(summary(await automaticRateService.refresh(tripId, true))) }
    catch (error) { setMessage(`Actualisation impossible : ${error instanceof Error ? error.message : 'erreur de stockage inconnue'}. Les derniers taux valides restent conservés.`) }
    finally { setBusy(false) }
  }
  return <details className="manual-rates">
    <summary>Taux automatiques · Frankfurter V2</summary>
    <p>Paramètres du voyage déjà enregistrés uniquement. Les modifications de ce formulaire doivent d’abord être enregistrées. Les taux manuels sont prioritaires.</p>
    <p>Dernière réception valide : {last ? new Date(last).toLocaleString('fr-FR') : 'aucune'}.</p>
    {offline && <p>Hors connexion signalé : utilisation du cache local. Le signal réseau ne garantit pas l’accès au fournisseur.</p>}
    {!data.pairs.length && <p>Aucune paire automatique nécessaire : montants sans devise, devise identique ou taux manuel disponible.</p>}
    <ul>{data.pairs.map((pair) => {
      const rate = cache.rates.find((item) => item.sourceCurrency === pair.sourceCurrency && item.targetCurrency === pair.targetCurrency)
      const check = cache.checks.find((item) => item.sourceCurrency === pair.sourceCurrency && item.targetCurrency === pair.targetCurrency)
      const age = rate ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${rate.rateDate}T00:00:00Z`)) / 86400000) : null
      return <li key={`${pair.sourceCurrency}/${pair.targetCurrency}`}>
        {pair.sourceCurrency} → {pair.targetCurrency} : {rate ? <>1 = {rate.rate} · taux du {rate.rateDate} · {age !== null && age < 0 ? 'date future — vérifier l’horloge' : age !== null && age <= 3 ? 'récent' : 'ancien'} (conservé hors ligne)</> : 'indisponible'}
        {check?.status === 'unavailable' && ' · paire non couverte par le fournisseur'}
        {check?.status === 'error' && <span> · dernière tentative en erreur{check.diagnostic ? ` : ${check.diagnostic}` : ''}</span>}
        {check?.status === 'pending' && ' · tentative enregistrée (en cours ou interrompue)'}
      </li>
    })}</ul>
    <p>« Récent » signifie une date de taux de moins de 4 jours ; ce sont des taux indicatifs, pas des prix en temps réel.</p>
    <button type="button" className="secondary-button" disabled={disabled || busy || offline} onClick={() => { void refresh() }}>{busy ? 'Actualisation…' : 'Actualiser les taux maintenant'}</button>
    {message && <p role="status">{message}</p>}
  </details>
}
