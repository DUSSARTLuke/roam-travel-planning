import { useContext, useRef, useState, useEffect } from 'react'
import type { ActivityConnection } from '../../routing/activityConnections'
import type { TransferMode } from '../../db/transferModel'
import { activityRoutingRequest, estimatedMinutes, estimateFresh, routingInputKey, RoutingError, type RoutingEstimate } from '../../routing/estimateModel'
import { RoutingServiceContext } from './routingContext'
import { configuredRoutingService, routingAuthenticated, routingSignIn, routingSignOut } from '../../routing/routingRuntime'

const messages: Record<string, string> = { offline: 'Hors ligne : aucune estimation récente en cache. La saisie manuelle reste disponible.', auth: 'Connecte-toi au service de calcul configuré.', quota: 'Quota atteint. Réessaie plus tard ; aucun nouvel essai automatique.', 'no-route': 'Aucun itinéraire trouvé.', coordinates: 'Les deux activités doivent avoir des coordonnées GPS.', unsupported: 'Calcul disponible pour la marche, le vélo et la voiture. Saisis la durée pour les autres modes.', invalid: 'Réponse invalide, estimation ignorée.', timeout: 'Le calcul a expiré.', unavailable: 'Service indisponible. La durée manuelle reste disponible.' }
export function RoutingAttribution() { return <span>© <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer">openrouteservice by HeiGIT</a> | Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA 4.0</a> · minutes arrondies au supérieur</span> }
export function RoutingEstimator({ tripId, pair, mode, manual, onAccept }: { tripId: string; pair?: ActivityConnection; mode: TransferMode; manual: boolean; onAccept: (estimate: RoutingEstimate, useDuration: boolean) => void }) {
  const injected = useContext(RoutingServiceContext), service = injected ?? configuredRoutingService()
  const [estimate, setEstimate] = useState<RoutingEstimate>(), [busy, setBusy] = useState(false), [error, setError] = useState(''), [auth, setAuth] = useState(routingAuthenticated())
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  let key = '', invalid = ''
  try { if (pair) key = routingInputKey(activityRoutingRequest(pair.from, pair.to, mode)); else invalid = 'Ces activités ne se suivent plus.' } catch (reason) { invalid = messages[reason instanceof RoutingError ? reason.code : 'invalid'] }
  const latest = useRef(key)
  const active = useRef<AbortController | undefined>(undefined)
  useEffect(() => { latest.current = key; active.current?.abort() }, [key])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort() } }, [])
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 30_000); return () => clearInterval(timer) }, [])
  if (!service) return <p className="activity-meta">Calcul automatique non configuré. Toutes les durées restent saisissables hors ligne.</p>
  async function calculate() {
    if (!pair || !key || busy) return
    const started = key, controller = new AbortController(); active.current = controller; setBusy(true); setError('')
    try { const result = await service!.calculate(tripId, activityRoutingRequest(pair.from, pair.to, mode), controller.signal); if (mounted.current && latest.current === started) { setEstimate(result); setClock(Date.now()) } }
    catch (reason) { if (mounted.current && !controller.signal.aborted) setError(messages[reason instanceof RoutingError ? reason.code : 'unavailable']) }
    finally { if (mounted.current) setBusy(false) }
  }
  const current = estimate && estimate.inputKey === key && estimateFresh(estimate, clock)
  return <section className="routing-estimator" aria-label="Estimation du déplacement">
    <strong>Estimation facultative</strong>
    {!injected && !auth && <><label>Adresse e-mail du service<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Mot de passe du service<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><button type="button" className="secondary-button" disabled={busy || !email || !password} onClick={() => { setBusy(true); void routingSignIn(email, password).then(() => { setAuth(true); setError('') }, () => setError(messages.auth)).finally(() => { setPassword(''); setBusy(false) }) }}>Se connecter au calcul</button><p className="activity-meta">Session conservée uniquement en mémoire. Aucun compte n’est créé ici.</p></>}
    {!injected && auth && <button type="button" className="connection-link" onClick={() => { routingSignOut(); setAuth(false); setEstimate(undefined) }}>Déconnecter le calcul</button>}
    {invalid && <p className="activity-meta">{invalid}</p>}
    <button type="button" className="secondary-button" disabled={busy || !key || !injected && !auth} onClick={() => void calculate()}>{busy ? 'Calcul en cours…' : 'Estimer le trajet'}</button>
    {current && <><p>{estimatedMinutes(estimate)} min · {(estimate.distanceMeters / 1000).toFixed(1)} km · calcul du {new Date(estimate.calculatedAt).toLocaleDateString('fr-FR')}</p><p className="activity-meta"><RoutingAttribution />. Estimation indicative ; marge et durée manuelle conservées.</p><button type="button" className="secondary-button" onClick={() => { if (estimateFresh(estimate, Date.now())) onAccept(estimate, !manual); else { setClock(Date.now()); setError('Cette estimation a expiré. Relance le calcul.') } }}>{manual ? 'Conserver l’estimation à côté de ma durée' : 'Utiliser cette estimation'}</button></>}
    {error && <p role="status">{error}</p>}
  </section>
}
