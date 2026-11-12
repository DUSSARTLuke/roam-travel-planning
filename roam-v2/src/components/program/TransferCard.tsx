import { transferTimingOutsideGap } from './transferAvailability'
import { TransferTimingText } from './TransferTimingText'
import { planningDuration } from './dayPlanning'
import { Footprints, Bike, Bus, TrainFront, TramFront, Car, CarTaxiFront, Plane, Ship, Route, Pencil } from 'lucide-react'
import type { TripActivity } from '../../db/activityModel'
import { transferModes, type ManualTransfer } from '../../db/transferModel'
import { transferPlacement } from './transferPlanning'

const icons = { transit: Bus, walk: Footprints, bicycle: Bike, bus: Bus, metro: TrainFront, tram: TramFront, train: TrainFront, car: Car, taxi: CarTaxiFront, plane: Plane, boat: Ship, other: Route }
export function TransferCard({ transfer, activities, onEdit, disabled = false, transfers }: {
  transfer: ManualTransfer; activities: TripActivity[]; onEdit: (transfer: ManualTransfer, trigger: HTMLButtonElement) => void; disabled?: boolean; transfers?: readonly ManualTransfer[]
}) {
  const from = activities.find((item) => item.id === transfer.fromActivityId)
  const to = activities.find((item) => item.id === transfer.toActivityId)
  const Icon = icons[transfer.mode] ?? Route
  const placement = transferPlacement(transfer, activities)
  const timing = transferTimingOutsideGap(transfer, activities, transfers ?? [transfer])
  const showTiming = timing && !placement.warning && !(timing.state === 'unknown' && ['activity-conflict', 'simultaneous'].includes(timing.reason))
  return <article className="program-transfer" aria-label={`Déplacement de ${from?.title ?? 'activité introuvable'} vers ${to?.title ?? 'activité introuvable'}`}>
    <p className="program-transfer-mode"><Icon size={19} aria-hidden="true" />Déplacement · {transferModes[transfer.mode]}</p>
    <p className="program-transfer-endpoints"><strong>Départ :</strong> {from?.title ?? 'Activité introuvable'} → <strong>Arrivée :</strong> {to?.title ?? 'Activité introuvable'}</p>
    <p className="activity-meta">{transfer.durationMinutes !== undefined ? `${transfer.durationMinutes} min` : 'Durée non renseignée'} · {transfer.estimatedCost !== undefined
      ? `Coût estimé : ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: transfer.currency }).format(transfer.estimatedCost)} (${transfer.currency})` : 'Coût non renseigné'}</p>
    {showTiming && <p className="transfer-card-timing">
      {timing.rawMinutes !== undefined && timing.rawMinutes >= 0 && <span className="activity-meta">Créneau brut : {planningDuration(timing.rawMinutes)} · </span>}
      <TransferTimingText timing={timing} />
    </p>}
    {transfer.notes && <p className="program-transfer-notes">{transfer.notes}</p>}
    {placement.warning && <p className="day-planning-warning" role="status">{placement.warning}</p>}
    <button type="button" className="secondary-button" disabled={disabled} aria-haspopup="dialog" aria-label={`Modifier le déplacement de ${from?.title ?? 'activité introuvable'} vers ${to?.title ?? 'activité introuvable'}`}
      onClick={(event) => onEdit(transfer, event.currentTarget)}><Pencil size={16} aria-hidden="true" /> Modifier / supprimer</button>
  </article>
}
