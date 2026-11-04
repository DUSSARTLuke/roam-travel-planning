import type { TripActivity } from '../src/db/activityModel'
import { buildDayPlanning, planningDuration, planningTime } from '../src/components/program/dayPlanning'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export function timedFixture(id: string, startTime: string, endTime?: string, sortOrder = 0): TripActivity {
  return { id, tripId: 'planning-trip', title: id, date: '2026-12-31', category: 'visit', scheduleType: 'exact', startTime,
    ...(endTime !== undefined ? { endTime } : {}), period: null, sortOrder, createdAt: '2026-11-04T12:00:00.000Z', updatedAt: '2026-11-04T12:00:00.000Z' }
}
export function testDayPlanning(report: (message: string) => void) {
  let count = 0
  const check = (value: unknown, message: string) => { count++; assert(value, message) }
  const empty = buildDayPlanning([])
  check(!empty.entries.length && !empty.toOrganize.length && !empty.conflictCount, 'Journée vide incorrecte.')
  const one = buildDayPlanning([timedFixture('Visite', '09:00', '10:30')])
  check(one.timed[0].start === 540 && one.timed[0].end === 630 && one.timed[0].durationMinutes === 90, 'Horaires/durée explicites perdus.')
  check(one.entries.length === 1, 'Créneaux ajoutés avant/après le séjour sans bornes.')
  const unknown = buildDayPlanning([timedFixture('Fin inconnue', '09:00')])
  check(unknown.timed[0].end === undefined && unknown.timed[0].durationMinutes === undefined && unknown.hasUnknownEnd, 'Durée/fin inventée.')
  const period: TripActivity = { ...timedFixture('Matin', '09:00'), scheduleType: 'period', period: 'morning', startTime: undefined }
  const unscheduled: TripActivity = { ...timedFixture('Libre', '09:00'), scheduleType: 'unscheduled', period: null, startTime: undefined }
  const unordered = buildDayPlanning([period, unscheduled])
  check(!unordered.timed.length && unordered.toOrganize.length === 2 && unordered.entries.length === 0, 'Période transformée en heure.')
  const ordered = buildDayPlanning([timedFixture('Après', '12:00', '13:00', -100), timedFixture('Avant', '09:00', '10:00', 100)])
  check(ordered.timed.map((item) => item.activity.id).join() === 'Avant,Après', 'Ordre manuel prioritaire sur l’heure.')
  const gaps = ordered.entries.filter((entry) => entry.kind === 'free')
  check(gaps.length === 1 && gaps[0].start === 600 && gaps[0].end === 720 && gaps[0].durationMinutes === 120, 'Créneau libre borné incorrect.')
  const touching = buildDayPlanning([timedFixture('A', '09:00', '10:00'), timedFixture('B', '10:00', '11:00')])
  check(touching.conflictCount === 0 && touching.entries.length === 2, 'Bornes jointives considérées comme chevauchement.')
  const nested = buildDayPlanning([timedFixture('Longue', '09:00', '12:00'), timedFixture('Courte', '10:00', '10:30'), timedFixture('Suite', '13:00', '14:00')])
  check(nested.conflictCount === 2 && nested.timed[0].conflicts[0].activity.id === 'Courte', 'Chevauchement imbriqué non signalé.')
  const nestedGap = nested.entries.filter((entry) => entry.kind === 'free')
  check(nestedGap.length === 1 && nestedGap[0].start === 720 && nestedGap[0].end === 780, 'Faux créneau libre dans une activité longue.')
  const chain = buildDayPlanning([timedFixture('A', '09:00', '12:00'), timedFixture('B', '10:00', '11:00'), timedFixture('C', '10:30', '13:00'), timedFixture('D', '13:00', '14:00')])
  check(chain.conflictCount === 3 && chain.timed[1].conflicts.length === 2 && chain.timed[3].conflicts.length === 0, 'Chaîne de conflits incorrecte.')
  const same = buildDayPlanning([timedFixture('b', '09:00'), timedFixture('a', '09:00')])
  check(same.conflictCount === 2 && same.timed[0].activity.id === 'a' && same.timed[0].conflicts[0].kind === 'same-start', 'Simultanéité/tri stable incorrects.')
  const startsInside = buildDayPlanning([timedFixture('Intervalle', '09:00', '11:00'), timedFixture('Début seul', '10:00')])
  check(startsInside.conflictCount === 2 && startsInside.timed[1].conflicts[0].kind === 'overlap', 'Début pendant une activité ignoré.')
  const uncertain = buildDayPlanning([timedFixture('Avant', '09:00', '10:00'), timedFixture('Inconnue', '10:30'), timedFixture('Après', '12:00', '13:00'), timedFixture('Dernière', '14:00', '15:00')])
  const certainGaps = uncertain.entries.filter((entry) => entry.kind === 'free')
  check(certainGaps.length === 1 && certainGaps[0].start === 600 && certainGaps[0].end === 630, 'Fin inconnue ignorée dans les disponibilités.')
  const firstUnknown = buildDayPlanning([timedFixture('Premier', '08:00'), timedFixture('Second', '10:00', '11:00'), timedFixture('Troisième', '12:00', '13:00')])
  check(!firstUnknown.entries.some((entry) => entry.kind === 'free'), 'Fin inconnue remplacée par le début suivant.')
  const midnight = buildDayPlanning([timedFixture('Minuit', '00:00', '01:00'), timedFixture('Suite', '02:00', '03:00')])
  check(midnight.timed[0].start === 0 && midnight.entries.some((entry) => entry.kind === 'free' && entry.start === 60 && entry.end === 120), 'Minuit perdu.')
  const zero = buildDayPlanning([timedFixture('Instant', '09:00', '09:00')])
  check(zero.timed[0].durationMinutes === 0 && !zero.hasUnknownEnd, 'Durée zéro confondue avec absence.')
  check(planningTime(0) === '00:00' && planningTime(1439) === '23:59', 'Format horaire incorrect.')
  check(planningDuration(90) === '1 h 30' && planningDuration(120) === '2 h' && planningDuration(0) === '0 min', 'Format durée incorrect.')
  const original = Object.freeze([Object.freeze(timedFixture('Après', '12:00', '13:00')), Object.freeze(timedFixture('Avant', '09:00', '10:00'))])
  const before = JSON.stringify(original)
  const frozen = buildDayPlanning(original)
  check(JSON.stringify(original) === before && frozen.timed[0].activity === original[1], 'Activités copiées/mutées ou tableau trié sur place.')
  const changed = buildDayPlanning([original[0], { ...original[1], startTime: '14:00', endTime: '15:00' }])
  check(changed.timed[0].activity.id === 'Après' && changed.entries.some((entry) => entry.kind === 'free' && entry.start === 780 && entry.end === 840), 'Recalcul après modification incorrect.')
  report(`Planning : ${count} contrôles purs (vide, horaires/durées, ordre, créneaux bornés, conflits, minuit, absence et immutabilité).`)
}
