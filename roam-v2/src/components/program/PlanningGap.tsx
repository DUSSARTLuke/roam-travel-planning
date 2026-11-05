import { planningDuration, planningTime, type FreePeriod } from './dayPlanning'
import type { GapTiming } from './transferAvailability'
import { TransferTimingText } from './TransferTimingText'

export function PlanningGap({ entry, timing }: { entry: FreePeriod; timing: GapTiming }) {
  return <li className={`day-timeline-free gap-${timing.state}`}>
    <span><time dateTime={planningTime(entry.start)}>{planningTime(entry.start)}</time> – <time dateTime={planningTime(entry.end)}>{planningTime(entry.end)}</time></span>
    {timing.state === 'raw' ? <span>Créneau libre entre activités horaires · {planningDuration(entry.durationMinutes)}</span> : <>
      <span>Créneau brut : {planningDuration(entry.durationMinutes)}</span>
      <TransferTimingText timing={timing} />
    </>}
  </li>
}
