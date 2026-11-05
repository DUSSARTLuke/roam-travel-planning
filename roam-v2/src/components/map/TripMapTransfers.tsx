import type { RefObject } from 'react'
import { X } from 'lucide-react'
import { transferModes } from '../../db/transferModel'
import { transferColors, type MapTransfer } from '../../maps/tripMapTransfers'
import { formatDate } from '../program/dates'

function TransferSummary({ link }: { link: MapTransfer }) {
  const { transfer } = link
  return <>
    <strong>{link.from.title} → {link.to.title}</strong>
    <span><span className="trip-transfer-swatch" style={{ backgroundColor: transferColors[transfer.mode] }} aria-hidden="true" />{transferModes[transfer.mode]}</span>
    <span>{transfer.durationMinutes !== undefined ? `${transfer.durationMinutes} min` : 'Durée non renseignée'} · {transfer.estimatedCost !== undefined
      ? `${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: transfer.currency }).format(transfer.estimatedCost)} (${transfer.currency}) estimés` : 'Coût non renseigné'}</span>
  </>
}
export function TripMapTransfers({ links, selectedIds, onSelect, onClose, previewRef, onReturnMap }: {
  onReturnMap?: () => void; links: readonly MapTransfer[]; selectedIds: readonly string[]; onSelect: (ids: string[]) => void; onClose: () => void; previewRef: RefObject<HTMLButtonElement | null>
}) {
  const selected = selectedIds.map((id) => links.find((link) => link.transfer.id === id)).filter((link): link is MapTransfer => Boolean(link))
  const current = selected[0]
  return <section className="trip-map-transfers" aria-labelledby="trip-map-transfers-title">
    <h2 id="trip-map-transfers-title">Déplacements manuels ({links.length})</h2>
    <p className="activity-meta">Liaisons indicatives à vol d’oiseau : ce ne sont pas des itinéraires routiers ou piétons réels.</p>
    <p className="activity-meta">Seuls les liens cohérents avec le planning et disposant de GPS affichables sont représentés. Les autres restent dans le Programme.</p>
    {current && <section className="trip-map-preview trip-transfer-preview" aria-label="Aperçu du déplacement" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="trip-map-toolbar"><h3>Déplacement · {transferModes[current.transfer.mode]}</h3>
        <button ref={previewRef} type="button" className="secondary-button" aria-label="Fermer l’aperçu du déplacement" onClick={onClose}><X size={18} aria-hidden="true" /> Fermer</button></div>
      {selected.length > 1 && <fieldset><legend>Plusieurs liaisons ici — choisir un déplacement</legend>
        {selected.map((link) => <button type="button" key={link.transfer.id} className="secondary-button" aria-pressed={current.transfer.id === link.transfer.id}
          onClick={() => onSelect([link.transfer.id, ...selectedIds.filter((id) => id !== link.transfer.id)])}>{link.from.title} → {link.to.title} · {transferModes[link.transfer.mode]}</button>)}
      </fieldset>}
      <div className="trip-transfer-summary"><TransferSummary link={current} /></div>
      <p>{formatDate(current.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      {current.geometry.type === 'Point' && <p>Les deux activités partagent les mêmes coordonnées : un halo représente leur liaison, sans inventer de parcours.</p>}
      {current.transfer.notes && <p className="trip-transfer-notes">{current.transfer.notes}</p>}
      {onReturnMap && <button type="button" className="secondary-button trip-map-return" onClick={onReturnMap}>Revenir à la carte</button>}
    </section>}
    {!links.length ? <p>Aucun déplacement représentable pour ce filtre.</p> : <ul className="trip-transfer-list">
      {links.map((link) => <li key={link.transfer.id}><button type="button" className="secondary-button trip-transfer-summary" aria-pressed={current?.transfer.id === link.transfer.id}
        onClick={() => onSelect([link.transfer.id])}><TransferSummary link={link} /></button></li>)}
    </ul>}
  </section>
}
