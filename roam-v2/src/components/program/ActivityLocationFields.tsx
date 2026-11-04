import { useRef, type ChangeEvent, type SyntheticEvent } from 'react'
import { isCoordinateDraft } from '../../db/activityLocation'
import type { ActivityFormValues } from './activityFormModel'

type Props = { form: ActivityFormValues; onChange: (form: ActivityFormValues) => void }
export function ActivityLocationFields({ form, onChange }: Props) {
  const selections = useRef<Record<string, { start: number; end: number; direction: 'forward' | 'backward' | 'none' }>>({})
  function remember(field: 'latitude' | 'longitude', event: SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget
    selections.current[field] = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? 'none' }
  }
  function changeCoordinate(field: 'latitude' | 'longitude', event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    if (isCoordinateDraft(input.value)) {
      onChange({ ...form, [field]: input.value })
    } else {
      const selection = selections.current[field]
      input.value = form[field]
      if (selection) input.setSelectionRange(selection.start, selection.end, selection.direction)
    }
  }
  return <>
    <label>Nom du lieu<input value={form.location} placeholder="Ex. British Museum" onChange={(event) => onChange({ ...form, location: event.target.value })} /></label>
    <label>Adresse (facultative)<textarea rows={2} value={form.address} onChange={(event) => onChange({ ...form, address: event.target.value })} /></label>
    <details className="activity-extra">
      <summary>Coordonnées GPS (facultatives)</summary>
      <p className="activity-meta">Renseigne les deux coordonnées avec un point ou une virgule. Aucune position n’est recherchée automatiquement.</p>
      <div className="form-row">
        <label>Latitude (−90 à 90)<input type="text" inputMode="decimal" value={form.latitude} placeholder="Ex. 51,5194" onSelect={(event) => remember('latitude', event)} onBeforeInput={(event) => remember('latitude', event)} onPaste={(event) => remember('latitude', event)} onChange={(event) => changeCoordinate('latitude', event)} /></label>
        <label>Longitude (−180 à 180)<input type="text" inputMode="decimal" value={form.longitude} placeholder="Ex. -0,1270" onSelect={(event) => remember('longitude', event)} onBeforeInput={(event) => remember('longitude', event)} onPaste={(event) => remember('longitude', event)} onChange={(event) => changeCoordinate('longitude', event)} /></label>
      </div>
    </details>
    {(form.location || form.address || form.latitude || form.longitude) && <div className="activity-location-actions"><button type="button" className="secondary-button" onClick={() => onChange({ ...form, location: '', address: '', latitude: '', longitude: '' })}>Effacer la localisation</button></div>}
  </>
}
