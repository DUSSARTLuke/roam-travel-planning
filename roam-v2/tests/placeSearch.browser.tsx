import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { createPhotonProvider, parsePhotonResults, type PlaceProvider, type PlaceSuggestion } from '../src/places/photon'
import { createPlaceSearch } from '../src/places/searchController'
import { ActivityPlaceSearch } from '../src/components/program/ActivityPlaceSearch'
import { initialActivityValues } from '../src/components/program/activityFormModel'
import { connection } from '../src/pwa/connection'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => unknown | Promise<unknown>) {
  let failed = false
  try { await action() } catch { failed = true }
  assert(failed, 'Réponse de recherche invalide acceptée.')
}
const payload = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-0.127, 51.5194] },
  properties: { name: 'Musée test', street: 'Rue test', housenumber: '2', postcode: 'TEST', city: 'Londres', country: 'Royaume-Uni' } }] }
const place = parsePhotonResults(payload)[0]
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

export async function testPlaceProvider(report: (message: string) => void) {
  assert(place.latitude === 51.5194 && place.longitude === -0.127 && place.address.includes('2 Rue test'), 'GeoJSON longitude/latitude ou adresse incorrects.')
  assert(parsePhotonResults({ features: [] }).length === 0, 'Résultats vides refusés.')
  for (const invalid of [null, [], {}, { features: 'bad' }, { features: [{ ...payload.features[0], geometry: { type: 'Point', coordinates: [0, 91] } }] },
    { features: [{ ...payload.features[0], geometry: { type: 'Point', coordinates: ['0', 1] } }] },
    { features: [{ ...payload.features[0], properties: { name: 42 } }] }]) await rejects(() => parsePhotonResults(invalid))
  const requests: string[] = []
  let now = 0
  const provider = createPhotonProvider(async (input, init) => {
    const url = String(input); requests.push(url)
    const params = new URL(url).searchParams
    assert(params.get('limit') === '5' && params.get('lang') === 'fr' && !params.has('lat') && !params.has('lon') && init?.credentials === 'omit', 'Paramètres ou confidentialité incorrects.')
    return json(payload)
  }, () => now)
  const controller = new AbortController()
  assert((await provider.search('ab', controller.signal)).length === 0 && !requests.length, 'Recherche trop courte envoyée.')
  const first = await provider.search('Musée', controller.signal)
  first[0].name = 'Modification locale'
  assert((await provider.search('musée', controller.signal))[0].name === 'Musée test' && requests.length === 1, 'Cache mémoire non isolé.')
  const queued = new AbortController()
  const waiting = provider.search('Autre lieu', queued.signal)
  queued.abort(); await rejects(() => waiting)
  assert(requests.length === 1, 'Requête annulée en attente envoyée.')
  now = 1500
  await provider.search('Autre lieu', controller.signal)
  assert(Number(requests.length) === 2, 'Limitation de rythme bloque la reprise.')
  for (const fetcher of [
    async () => json({}, 503), async () => new Response('bad JSON', { headers: { 'content-type': 'application/json' } }),
    async () => json({ features: [{ type: 'Feature' }] }), async () => { throw new TypeError('Panne simulée') },
    async () => new Response('HTML', { headers: { 'content-type': 'text/html' } }),
  ]) await rejects(() => createPhotonProvider(fetcher).search('Test lieu', controller.signal))
  const timeoutProvider = createPhotonProvider((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Test timeout', 'AbortError')), { once: true })
  }), () => 0, { timeoutMs: 1 })
  await rejects(() => timeoutProvider.search('Test timeout', controller.signal))
  let limitedCalls = 0
  const limited = createPhotonProvider(async () => { limitedCalls++; return new Response('{}', { status: 429, headers: { 'retry-after': '120' } }) }, () => 0)
  await rejects(() => limited.search('Premier', controller.signal))
  await rejects(() => limited.search('Second', controller.signal))
  assert(limitedCalls === 1, 'Réponse 429 ignorée.')
  let clock = Date.parse('2026-11-04T12:00:00.000Z')
  const retryDate = new Date(clock + 300000).toUTCString()
  let datedCalls = 0
  const dated = createPhotonProvider(async () => { datedCalls++; return datedCalls === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': retryDate } }) : json(payload) }, () => clock)
  await rejects(() => dated.search('Premier lieu', controller.signal))
  clock += 120000
  await rejects(() => dated.search('Second lieu', controller.signal))
  assert(datedCalls === 1, 'Retry-After HTTP ignoré avant échéance.')
  clock += 180000
  assert((await dated.search('Second lieu', controller.signal)).length === 1 && Number(datedCalls) === 2, 'Reprise après Retry-After incorrecte.')
  assert((await createPhotonProvider(async () => json({ features: [] })).search('Vide', controller.signal)).length === 0, 'Résultat vide incorrect.')
  report('Photon simulé : GeoJSON/coordonnées/adresse, validation, requêtes minimales, cache, rythme, annulation, HTTP/JSON/réseau/timeout et 429.')
}

export async function testPlaceController(report: (message: string) => void) {
  const timers = new Map<number, () => void>()
  let next = 0
  const calls: { signal: AbortSignal; resolve: (values: PlaceSuggestion[]) => void; reject: (error: Error) => void }[] = []
  const provider: PlaceProvider = { search: (_query, signal) => new Promise((resolve, reject) => { calls.push({ signal, resolve, reject }) }) }
  const search = createPlaceSearch(provider, { set: (callback, delay) => { assert(delay === 650, 'Debounce modifié.'); const id = ++next; timers.set(id, callback); return id as ReturnType<typeof setTimeout> }, clear: (id) => { timers.delete(Number(id)) } })
  const run = () => { const tasks = [...timers.values()]; timers.clear(); tasks.forEach((task) => task()) }
  const settle = async () => { await Promise.resolve(); await Promise.resolve() }
  search.query('ab'); run(); assert(!calls.length, 'Appel avant longueur minimale.')
  search.query('Ancien'); search.query('Ancien lieu'); run()
  assert(Number(calls.length) === 1, 'Debounce inefficace.')
  search.query('Nouveau'); assert(calls[0].signal.aborted, 'Ancienne requête non annulée.'); run()
  calls[0].resolve([{ ...place, name: 'Ancien' }]); await settle()
  assert(search.getSnapshot().phase === 'loading', 'Ancienne réponse affichée.')
  calls[1].resolve([{ ...place, name: 'Nouveau' }]); await settle()
  assert(search.getSnapshot().results[0]?.name === 'Nouveau', 'Dernière réponse perdue.')
  search.query('Sans résultat'); run(); calls[2].resolve([]); await settle()
  assert(search.getSnapshot().phase === 'empty', 'État vide absent.')
  search.query('En erreur'); run(); calls[3].reject(new Error('Erreur simulée')); await settle()
  assert(search.getSnapshot().phase === 'error', 'Erreur masquée.')
  search.query('En attente'); search.setOnline(false); run()
  assert(search.getSnapshot().phase === 'offline' && Number(calls.length) === 4, 'Requête envoyée offline.')
  search.query('Saisie offline'); run(); assert(Number(calls.length) === 4, 'Saisie offline envoyée.')
  search.setOnline(true); run(); search.dispose()
  assert(calls[4].signal.aborted, 'Requête conservée après démontage.')
  calls[4].resolve([place]); await settle()
  assert(search.getSnapshot().results.length === 0, 'Réponse publiée après démontage.')
  search.activate(); search.query('Annulation différée'); search.dispose(); run()
  assert(Number(calls.length) === 5 && timers.size === 0, 'Timer conservé après démontage.')
  report('Recherche : debounce 650 ms, requêtes concurrentes/obsolètes, vide/erreur, offline, annulation et démontage.')
}

export async function testPlaceSearchUI(report: (message: string) => void) {
  const previousNetwork = connection.getSnapshot().offline
  window.dispatchEvent(new Event('online'))
  const host = document.createElement('div')
  const previousFocus = document.activeElement
  document.body.append(host)
  const root = createRoot(host)
  let values = initialActivityValues(null, null, '2028-01-01')
  values.notes = 'Notes conservées'
  let changes = 0
  let submissions = 0
  let requests = 0
  let mounted = true
  const provider: PlaceProvider = { async search() { requests++; return [place, { ...place, id: 'second', name: 'Second lieu' }] } }
  const render = () => root.render(<form onSubmit={(event) => { event.preventDefault(); submissions++ }}>
    <ActivityPlaceSearch form={values} provider={provider} onChange={(next) => { values = next; changes++; render() }} />
    <button type="submit">Enregistrer test</button>
  </form>)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 720))
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  try {
    flushSync(render)
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
    assert(requests === 0, 'Recherche automatique à l’ouverture.')
    const type = (text: string) => flushSync(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
    const key = (value: string) => flushSync(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
    input.focus(); type('Musée'); await settle(); flushSync(() => {})
    assert(host.querySelectorAll('[role="option"]').length === 2, 'Suggestions absentes.')
    key('ArrowDown'); key('Enter')
    assert(values.location === 'Second lieu' && values.address === place.address && values.latitude === '51.5194' && values.longitude === '-0.127' && !submissions, 'Sélection clavier ou coordonnées incorrectes / soumission implicite.')
    const stored = JSON.stringify(values)
    type('Autre lieu'); await settle(); flushSync(() => {}); flushSync(() => host.querySelector<HTMLElement>('[role="option"]')!.click())
    assert(host.querySelector('[role="alertdialog"]') && JSON.stringify(values) === stored && changes === 1, 'Saisie existante écrasée silencieusement.')
    const cancel = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Conserver ma saisie')!
    flushSync(() => cancel.click())
    assert(JSON.stringify(values) === stored, 'Annuler a modifié le formulaire.')
    type('Encore un lieu'); await settle(); flushSync(() => {}); key('Enter')
    values = { ...values, notes: 'Note modifiée pendant la confirmation' }; flushSync(render)
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Remplacer la localisation')!
    flushSync(() => confirm.click())
    assert(String(values.location) === place.name && values.notes === 'Note modifiée pendant la confirmation' && !submissions, 'Remplacement a perdu une saisie ou enregistré.')
    type('À fermer'); key('Escape')
    assert(!host.querySelector('[role="listbox"]'), 'Échap ne ferme pas les suggestions.')
    flushSync(() => window.dispatchEvent(new Event('offline')))
    assert(input.disabled && host.textContent?.includes('hors connexion'), 'État offline absent.')
    const before = requests
    flushSync(() => window.dispatchEvent(new Event('online')))
    type('Recherche au démontage')
    flushSync(() => root.unmount()); mounted = false; await settle()
    assert(requests === before, 'Recherche déclenchée après démontage.')
    assert(host.textContent === '', 'Composant non démonté.')
    report('UI recherche : clavier, remplissage sans soumission, confirmation/annulation, saisies conservées, Échap, offline et démontage.')
  } finally {
    if (mounted) flushSync(() => root.unmount())
    host.remove()
    window.dispatchEvent(new Event(previousNetwork ? 'offline' : 'online'))
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
  }
}
