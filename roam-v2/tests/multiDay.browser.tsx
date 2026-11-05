import appStyles from '../src/App.css?inline'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoamDatabase, type Trip } from '../src/db/database'
import { createActivityRepository } from '../src/db/activities'
import { schedulingKey } from '../src/db/activityOrganization'
import { getTripDays, getTripMonths } from '../src/components/program/dates'
import { initialProgramNavigation, normalizeProgramNavigation, multiDayGroup, type ProgramNavigation } from '../src/components/program/programNavigation'
import { MultiDayProgram } from '../src/components/program/MultiDayProgram'
import { TripProgram } from '../src/components/program/TripProgram'
import { timedFixture } from './dayPlanning.core'
import '../src/components/program/program.css'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(condition: () => boolean) {
  const end = performance.now() + 5000
  while (!condition() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
  assert(condition(), 'Programme multi-jours non actualisé.')
}
export async function testMultiDay(report: (message: string) => void) {
  const days = getTripDays('2026-12-28', '2027-01-03')
  assert(days.length === 7 && days[4] === '2027-01-01', 'Jours locaux décalés.')
  assert(initialProgramNavigation(days[0]).mode === 'day', 'La vue par défaut doit rester Jour.')
  for (const length of [1, 2, 7]) {
    const slice = days.slice(0, length)
    const group = multiDayGroup(slice, slice[0])
    assert(group.days.length === Math.min(length, 3) && group.previous === undefined, 'Groupe court incorrect.')
    const markup = renderToStaticMarkup(<MultiDayProgram days={slice} selectedDate={slice[0]} activities={[]} onSelect={() => {}} onEdit={() => {}} onOpen={() => {}} />)
    assert((markup.match(/data-day=/g) ?? []).length === Math.min(length, 3) && markup.includes('Aucune activité'), 'Jours courts/vides incorrects.')
  }
  const last = multiDayGroup(days, days[6])
  assert(last.days.length === 1 && last.next === undefined && last.previous === days[3], 'Dernière page incorrecte.')
  const repaired = normalizeProgramNavigation({ mode: 'multi', selectedDate: '2020-01-01', month: '2020-01' }, days, getTripMonths(days[0], days[6]))
  assert(repaired.mode === 'multi' && repaired.selectedDate === days[0] && repaired.month === '2026-12', 'Réconciliation des dates incorrecte.')
  const database = new RoamDatabase(`roam-v2-test-multi-${crypto.randomUUID()}`)
  const repo = createActivityRepository(database)
  const trip: Trip = { id: 'multi-trip', destination: 'Test multi', country: 'Test', startDate: days[0], endDate: days[6], travelers: 1, image: '' }
  const host = document.createElement('div'); host.style.width = '100%'; document.body.append(host)
  const root = createRoot(host)
  const productionStyles = document.createElement('style')
  productionStyles.textContent = appStyles + '\n[data-geometry], [data-geometry] * { box-sizing: border-box; }' 
  let opened = ''; let edited = ''; let added = ''; let transferDay = ''
  try {
    const fixture = [ { ...timedFixture('Tard', '11:00', '12:00'), tripId: trip.id, date: days[0] },
      { ...timedFixture('Tôt', '09:00', '11:30'), tripId: trip.id, date: days[0] },
      { ...timedFixture('À organiser', '08:00'), tripId: trip.id, date: days[1], scheduleType: 'unscheduled' as const, startTime: undefined } ]
    // Remembered selection, same-group changes and paging must not crop the
    // leading column, regardless of whether all three tracks fit the container.
    document.head.append(productionStyles)
    function Geometry({ population }: { population: typeof fixture }) {
      const [selected, select] = useState(days[1])
      return <div className="app-shell" data-geometry><main className="main-content">
        <MultiDayProgram days={days} selectedDate={selected} activities={population} onAdd={() => {}} onAddTransfer={() => {}} onSelect={select} onEdit={() => {}} onOpen={() => {}} />
      </main></div>
    }
    function assertLeadingColumn(width: number) {
      const region = host.querySelector<HTMLElement>('.program-multi-columns')!
      const column = region.querySelector<HTMLElement>('.program-multi-day')!
      const box = region.getBoundingClientRect(); const firstBox = column.getBoundingClientRect()
      assert(region.scrollLeft === 0 && firstBox.left >= box.left - 1 && firstBox.right <= box.right + 1,
        `Première colonne rognée à ${width}px : scrollLeft=${region.scrollLeft}, gauche=${firstBox.left - box.left}, droite=${firstBox.right - box.left}, largeur=${box.width}.`)
      const headingBox = column.querySelector('h2')!.getBoundingClientRect()
      assert(headingBox.left >= box.left && headingBox.right <= box.right + 1, 'Texte de la première colonne rogné.')
      assert(host.scrollWidth <= host.clientWidth + 1, 'Défilement des jours propagé à la page.')
      for (const dayColumn of region.querySelectorAll<HTMLElement>('.program-multi-day')) {
        const header = dayColumn.querySelector<HTMLElement>('.program-multi-day-header')!
        const content = header.nextElementSibling as HTMLElement
        const gap = content.getBoundingClientRect().top - header.getBoundingClientRect().bottom
        assert(gap >= 19, `Contenu collé à l’en-tête du ${dayColumn.dataset.day} : espace vertical=${gap}px, vide=${content.classList.contains('program-empty')}.`)
      }
      return region
    }
    const settle = async () => {
      await document.fonts.ready
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const fullPopulation = days.map((date, index) => ({ ...fixture[0], id: `full-${index}`, date }))
    const referenceSizes = new Map<number, string>()
    for (const [kind, population] of [['empty', []], ['partial', fixture], ['full', fullPopulation]] as const) {
    for (const width of [327, 740, 1000, 1180]) {
      host.style.width = `${width}px`
      flushSync(() => root.render(<Geometry key={`geometry-${kind}-${width}`} population={[...population]} />))
      await settle()
      let region = assertLeadingColumn(width)
      const size = JSON.stringify([region.clientWidth, region.scrollWidth, ...[...region.children].map((column) => column.getBoundingClientRect().width)])
      if (kind === 'empty') referenceSizes.set(width, size)
      else assert(size === referenceSizes.get(width), 'Dimensions différentes entre colonnes vides et remplies.')
      region.scrollLeft = Math.min(80, region.scrollWidth - region.clientWidth)
      const beforeSelection = region.scrollLeft
      const firstButton = region.querySelector<HTMLButtonElement>('.program-multi-day button[aria-pressed="false"]')!
      flushSync(() => firstButton.click())
      await settle()
      assert(region === host.querySelector('.program-multi-columns') && Math.abs(region.scrollLeft - beforeSelection) <= 1, 'La sélection impose un déplacement horizontal inattendu.')
      // A final pending scroll on the old viewport can arrive after React's
      // layout phase (gesture/restoration). It must not shift the new group.
      const previousRegion = region
      requestAnimationFrame(() => { previousRegion.scrollLeft = previousRegion.scrollWidth })
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours suivant"]')!.click())
      await settle()
      region = assertLeadingColumn(width)
      assert(!previousRegion.isConnected, 'Ancien viewport conservé après pagination.')
      assert(region.querySelector<HTMLElement>('.program-multi-day')!.dataset.day === days[3], 'Mauvais groupe suivant.')
      region.scrollLeft = region.scrollWidth
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours précédent"]')!.click())
      await settle()
      region = assertLeadingColumn(width)
      assert(region.querySelector<HTMLElement>('.program-multi-day')!.dataset.day === days[0], 'Mauvais groupe précédent.')
      // Exact report: 28 Dec–3 Jan; return from the lone 3 Jan to 31 Dec–2 Jan.
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours suivant"]')!.click())
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours suivant"]')!.click())
      await settle()
      assert(host.querySelectorAll('.program-multi-day').length === 1 && host.querySelector<HTMLElement>('.program-multi-day')!.dataset.day === '2027-01-03', 'Dernier groupe du séjour incorrect.')
      flushSync(() => host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours précédent"]')!.click())
      await settle(); region = assertLeadingColumn(width)
      assert(region.querySelector<HTMLElement>('.program-multi-day')!.dataset.day === '2026-12-31' && region.querySelectorAll('.program-multi-day').length === 3, 'Retour 3 janvier → 31 décembre–2 janvier incorrect.')
    }
    }
    host.style.width = '100%'
    const emptyRead = async () => []
    function EmptyTabs() {
      const [visible, show] = useState(true)
      const [remembered, remember] = useState<ProgramNavigation>({ mode: 'multi', selectedDate: days[1], month: '2026-12' })
      return <div className="app-shell" data-geometry><main className="main-content">
        <button type="button" data-empty-tab onClick={() => show((value) => !value)}>Autre onglet</button>
        {visible && <TripProgram trip={trip} readActivities={emptyRead} initialNavigation={remembered} onNavigationChange={remember} />}
      </main></div>
    }
    flushSync(() => root.render(<StrictMode><EmptyTabs /></StrictMode>))
    await waitFor(() => !!host.querySelector('.program-multi-columns'))
    await settle(); assertLeadingColumn(host.clientWidth)
    const emptyMode = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.program-mode-switch button')].find((button) => button.textContent?.trim() === label)!
    flushSync(() => emptyMode('Jour').click())
    flushSync(() => emptyMode('Multi-jours').click())
    await settle(); assertLeadingColumn(host.clientWidth)
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-empty-tab]')!.click())
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-empty-tab]')!.click())
    await waitFor(() => !!host.querySelector('.program-multi-columns'))
    await settle(); assertLeadingColumn(host.clientWidth)
    productionStyles.remove()
    host.style.width = '100%'
    let selection = days[0]
    const callbacks = { onOpen: (item: { id: string }) => { opened = item.id }, onEdit: (item: { id: string }) => { edited = item.id } }
    flushSync(() => root.render(<MultiDayProgram days={days} selectedDate={selection} activities={fixture} onSelect={(day) => { selection = day }}
      onAdd={(day) => { added = day }} onAddTransfer={(day) => { transferDay = day }} {...callbacks} />))
    const first = host.querySelector<HTMLElement>(`[data-day="${days[0]}"]`)!
    assert(first.querySelector('.day-timeline-item h3')?.textContent === 'Tôt' && first.textContent?.includes('Chevauchement'), 'Tri/conflit perdu dans une colonne.')
    assert(host.querySelector(`[data-day="${days[1]}"]`)?.textContent?.includes('À organiser'), 'Activités sans horaire absentes.')
    for (const [index, expectedPlacement] of [[0, 'header'], [1, 'header'], [2, '.program-empty']] as const) {
      const column = host.querySelector<HTMLElement>(`[data-day="${days[index]}"]`)!
      const adds = [...column.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent?.trim() === 'Ajouter une activité')
      assert(adds.length === 1 && column.querySelector(expectedPlacement)?.contains(adds[0]), 'Ajout dupliqué ou mal placé selon l’état vide/rempli.')
    }
    assert(!first.querySelector('button[aria-pressed]') && first.querySelector('.program-multi-selected')?.textContent === 'Journée sélectionnée', 'La sélection doit être un indicateur discret, sans bouton.')
    assert(first.getAttribute('aria-describedby') === first.querySelector('.program-multi-selected')?.id, 'État sélectionné non décrit aux lecteurs d’écran.')
    const emptyAdd = host.querySelector<HTMLButtonElement>(`[data-day="${days[2]}"] .program-empty button`)!
    emptyAdd.click(); assert(added === days[2], 'Ajout depuis journée vide associé au mauvais jour.')
    const next = host.querySelector<HTMLButtonElement>('[aria-label="Groupe de jours suivant"]')!
    next.focus(); assert(document.activeElement === next && next.getBoundingClientRect().height >= 44, 'Navigation tactile/clavier inaccessible.')
    next.click(); assert(selection === days[3], 'Navigation groupe suivant incorrecte.')
    first.querySelector<HTMLButtonElement>('[aria-label="Consulter l’activité Tôt"]')!.click()
    first.querySelector<HTMLButtonElement>('[aria-label="Modifier l’activité Tôt"]')!.click()
    assert(opened === 'Tôt' && edited === 'Tôt', 'Actions des cartes perdues.')
    first.querySelector<HTMLButtonElement>('.program-multi-day-header button[aria-label^="Ajouter une activité"]')!.click()
    assert(added === days[0], 'Ajout associé à la mauvaise colonne.')
    const transferButton = first.querySelector<HTMLButtonElement>('button[aria-label^="Ajouter un déplacement"]')!
    transferButton.click()
    assert(transferDay === days[0] && !host.querySelector(`[data-day="${days[2]}"] button[aria-label^="Ajouter un déplacement"]`), 'Ajout de déplacement hors contexte de la colonne.')
    for (const width of [1180, 740, 327]) {
      host.style.width = `${width}px`
      const scroller = host.querySelector<HTMLElement>('.program-multi-columns')!
      const columns = [...scroller.querySelectorAll<HTMLElement>('.program-multi-day')]
      const top = columns[0].getBoundingClientRect().top
      assert(columns.every((column) => Math.abs(column.getBoundingClientRect().top - top) < 1), 'Colonnes mal alignées verticalement.')
      assert(scroller.scrollHeight <= scroller.clientHeight + 1, 'Défilement vertical imbriqué dans les colonnes.')
      scroller.scrollLeft = scroller.scrollWidth
      assert(scroller.scrollLeft >= 0 && scroller.scrollTop === 0, 'Défilements horizontal et vertical confondus.')
      assert(host.scrollWidth <= width + 1, `Débordement de page à ${width}px.`)
      assert(first.getBoundingClientRect().width >= Math.min(300, width), 'Colonne trop comprimée.')
      if (width === 1180) assert(scroller.scrollWidth <= scroller.clientWidth + 1, 'Trois colonnes ne tiennent pas sur desktop.')
      else assert(scroller.scrollWidth > scroller.clientWidth, 'Défilement local tablette/mobile absent.')
    }
    host.style.width = '100%'
    await database.trips.add(trip)
    let a = await repo.createActivity(trip.id, fixture[0])
    const b = await repo.createActivity(trip.id, fixture[1])
    await repo.createActivity(trip.id, fixture[2])
    await repo.createActivity(trip.id, { ...fixture[0], title: 'Hors séjour', date: '2027-02-01' })
    const transfer = { id: 'multi-transfer', fromActivityId: a.id, toActivityId: b.id, mode: 'walk' as const, currency: 'EUR', createdAt: a.createdAt, updatedAt: a.updatedAt }
    let reads = 0
    const read = (id: string) => { reads++; return repo.listActivities(id) }
    // Same parent-state contract as App, without querying the user's database.
    function Tabs() {
      const [visible, setVisible] = useState(true)
      const [remembered, remember] = useState<ProgramNavigation | undefined>()
      return <><button type="button" data-test-tab onClick={() => setVisible((value) => !value)}>Autre onglet</button>
        {visible && <TripProgram trip={{ ...trip, manualTransfers: [transfer] }} initialNavigation={remembered} onNavigationChange={remember} readActivities={read} />}</>
    }
    flushSync(() => root.render(<Tabs />))
    await waitFor(() => host.querySelectorAll('.day-timeline-item').length === 2)
    const mode = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.program-mode-switch button')].find((button) => button.textContent?.trim() === label)!
    flushSync(() => mode('Multi-jours').click())
    await waitFor(() => host.querySelectorAll('[data-day]').length === 3)
    assert(!host.querySelector('.program-heading button') && !host.querySelector('.program-view-actions'), 'Actions globales redondantes en Multi-jours.')
    assert(host.querySelector(`[data-day="${days[0]}"] button[aria-label^="Ajouter un déplacement"]`), 'Création de déplacement perdue en Multi-jours.')
    assert(reads === 1, 'Requêtes répétées par colonne ou changement de vue.')
    const columnTransfer = host.querySelector<HTMLButtonElement>(`[data-day="${days[0]}"] button[aria-label^="Ajouter un déplacement"]`)!
    columnTransfer.focus()
    flushSync(() => columnTransfer.click())
    assert(host.querySelector<HTMLSelectElement>('.transfer-panel select')?.value === days[0], 'Le formulaire de déplacement ne reprend pas le jour de la colonne.')
    flushSync(() => [...host.querySelectorAll<HTMLButtonElement>('.transfer-panel button')].find((button) => button.textContent === 'Fermer')!.click())
    assert(!host.querySelector('.transfer-panel') && document.activeElement === columnTransfer, 'Retour au bouton de déplacement de la colonne perdu.')
    assert(host.querySelector(`[data-day="${days[0]}"] .program-transfer`), 'Déplacement absent de sa colonne.')
    assert(host.textContent?.includes('avant le départ'), 'Alerte de trajet incohérent perdue.')
    assert(host.textContent?.includes('Autres dates') && host.textContent.includes('Hors séjour'), 'Hors séjour masqué.')
    const dayTwo = host.querySelector<HTMLButtonElement>(`[data-day="${days[1]}"] [aria-pressed]`)!
    dayTwo.focus()
    const beforeDaySelection = host.querySelector<HTMLElement>('.program-multi-columns')!.scrollLeft
    flushSync(() => dayTwo.click())
    const selectedColumn = host.querySelector<HTMLElement>(`[data-day="${days[1]}"]`)!
    assert(document.activeElement === selectedColumn.querySelector('h2'), 'Focus perdu après remplacement du bouton de sélection.')
    assert(!selectedColumn.querySelector('button[aria-pressed]') && selectedColumn.querySelector('.program-multi-selected'), 'Bouton sélectionné encore présent.')
    assert(host.querySelector(`[data-day="${days[0]}"] button[aria-pressed="false"]`), 'Le jour précédemment sélectionné doit redevenir sélectionnable.')
    const region = host.querySelector<HTMLElement>('.program-multi-columns')!
    assert(Math.abs(region.scrollLeft - beforeDaySelection) <= 1, 'La sélection recale le défilement au lieu de le préserver.')
    flushSync(() => mode('Jour').click())
    assert(host.querySelector('.program-view-actions .program-add') && host.querySelector('.program-view-actions .program-add-transfer'), 'Actions de la vue Jour perdues.')
    assert(host.querySelector('#program-day-title')?.textContent?.includes('29'), 'Sélection perdue en passant à Jour.')
    flushSync(() => mode('Multi-jours').click())
    assert(host.querySelector(`[data-day="${days[1]}"]`)?.classList.contains('selected'), 'Sélection perdue en revenant à Multi-jours.')
    assertLeadingColumn(host.clientWidth)
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-test-tab]')!.click())
    assert(!host.querySelector('.trip-program'), 'Programme caché resté monté.')
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-test-tab]')!.click())
    await waitFor(() => host.querySelectorAll('[data-day]').length === 3)
    assert(host.querySelector(`[data-day="${days[1]}"]`)?.classList.contains('selected') && mode('Multi-jours').getAttribute('aria-pressed') === 'true', 'Navigation perdue entre onglets.')
    a = await repo.organizeActivity(trip.id, a.id, { date: days[1] }, schedulingKey(a))
    await waitFor(() => host.querySelectorAll(`[data-day="${days[1]}"] .day-timeline-item`).length === 1)
    assert(host.querySelectorAll(`[data-day="${days[0]}"] .day-timeline-item`).length === 1, 'Activité dupliquée entre colonnes après déplacement.')
    assert(host.textContent?.includes('Déplacements à vérifier'), 'Lien inter-journées non signalé après déplacement.')
    a = await repo.organizeActivity(trip.id, a.id, { startTime: '06:00' }, schedulingKey(a))
    await waitFor(() => host.querySelector(`[data-day="${days[1]}"] .day-timeline-time`)?.textContent?.includes('06:00') === true)
    assert(host.querySelector(`[data-day="${days[0]}"] .day-timeline-time`)?.textContent?.includes('09:00'), 'Autre colonne altérée.')
    flushSync(() => mode('Calendrier').click())
    assert(host.querySelector('.program-calendar-grid'), 'Calendrier disparu.')
    assert(host.querySelector('.program-view-actions .program-add') && host.querySelector('.program-view-actions .program-add-transfer'), 'Actions du calendrier perdues.')
    const calendarDay = host.querySelector<HTMLButtonElement>('.program-calendar-day.in-trip:not(.selected)')!
    flushSync(() => calendarDay.click())
    assert(mode('Jour').getAttribute('aria-pressed') === 'true' && host.querySelector('#program-day-title'), 'Navigation calendrier → jour cassée.')
    report('Multi-jours : groupes vides/partiels/remplis stabilisés, défilement tardif isolé par groupe, dimensions identiques, première colonne non rognée, sélection sans saut ; groupes courts/longs, décembre/janvier, tri, vide, À organiser, trajets/alertes, actions, sélection et onglets, une requête, réactivité inter-colonnes et largeurs desktop/tablette/mobile validés.')
  } finally { flushSync(() => root.unmount()); host.remove(); productionStyles.remove(); await database.delete() }
}
