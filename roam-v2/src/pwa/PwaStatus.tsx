import { useSyncExternalStore } from 'react'
import { getPwaStatus, registerPwa, subscribePwa } from './register'
import { connection } from './connection'
import { updates } from './updates'
import './pwa.css'

export function PwaStatus() {
  const status = useSyncExternalStore(subscribePwa, getPwaStatus, getPwaStatus)
  const update = useSyncExternalStore(updates.subscribe, updates.getSnapshot, updates.getSnapshot)
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  const preparation = status.state !== 'disabled' && status.state !== 'ready'
  const updating = update.phase === 'checking' || update.phase === 'activating'
  return <>
    {(network.offline || network.returned) && <aside className="pwa-connection" role="status"
      title="Le signal réseau du navigateur ne garantit pas l’accès aux serveurs.">
      {network.offline ? 'Hors connexion signalé — utilisation des données locales.' : 'Réseau de nouveau signalé disponible — accès aux serveurs non vérifié.'}
    </aside>}
    {preparation && <aside className="pwa-status" role={status.state === 'error' ? 'alert' : 'status'}>
      <p>{status.message}</p>
      {status.state === 'error' && <button type="button" onClick={() => { void registerPwa() }}>Réessayer</button>}
    </aside>}
    {update.phase !== 'none' && <aside className="pwa-status pwa-update" aria-label="Mise à jour de Roam">
      {update.dismissed
        ? <button type="button" onClick={updates.show}>Nouvelle version disponible</button>
        : <>
          <p role="status" aria-live="polite">{update.message}</p>
          <button type="button" disabled={updating} onClick={updates.request}>{update.phase === 'reload' ? 'Recharger quand prêt' : 'Mettre à jour'}</button>
          <button type="button" disabled={updating} onClick={updates.dismiss}>Plus tard</button>
        </>}
    </aside>}
  </>
}
