import { planningDuration } from './dayPlanning'
import { unknownTransferMessages, type TransferTiming } from './transferAvailability'

export function TransferTimingText({ timing }: { timing: TransferTiming }) {
  return <span className={`transfer-time-status transfer-time-${timing.state}`}>
    {timing.state === 'unknown' ? unknownTransferMessages[timing.reason]
      : timing.state === 'conflict' ? `Il manque ${planningDuration(-timing.remainingMinutes)} pour le déplacement.`
        : timing.state === 'occupied' ? 'Aucun temps libre après le déplacement (0 min).'
          : `Temps libre après le déplacement : ${planningDuration(timing.remainingMinutes)}.`}
  </span>
}
