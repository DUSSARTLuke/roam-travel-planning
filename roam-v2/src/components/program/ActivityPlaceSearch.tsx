import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { connection } from '../../pwa/connection'
import { coordinateFormValue } from '../../db/activityLocation'
import { photonProvider, type PlaceProvider, type PlaceSuggestion } from '../../places/photon'
import { createPlaceSearch } from '../../places/searchController'
import type { ActivityFormValues } from './activityFormModel'
import './place-search.css'

type Props = { form: ActivityFormValues; onChange: (form: ActivityFormValues) => void; onApplied?: () => void; provider?: PlaceProvider }
export function ActivityPlaceSearch({ form, onChange, onApplied, provider = photonProvider }: Props) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [search] = useState(() => createPlaceSearch(provider))
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot)
  const network = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
  const [active, setActive] = useState(0)
  const [pending, setPending] = useState<PlaceSuggestion | null>(null)
  useEffect(() => { search.activate(); return () => search.dispose() }, [search])
  useEffect(() => { search.setOnline(!network.offline) }, [search, network.offline])
  useEffect(() => { if (pending) cancelButton.current?.focus() }, [pending])
  const index = Math.min(active, Math.max(0, state.results.length - 1))
  useEffect(() => { if (state.results.length) document.getElementById(`${id}-result-${index}`)?.scrollIntoView({ block: 'nearest' }) }, [id, index, state.results])
  function apply(place: PlaceSuggestion) {
    onChange({ ...form, location: place.name, address: place.address, latitude: coordinateFormValue(place.latitude), longitude: coordinateFormValue(place.longitude) })
    setPending(null); search.dismiss(); onApplied?.()
  }
  function choose(place: PlaceSuggestion) {
    search.dismiss()
    if ([form.location, form.address, form.latitude, form.longitude].some((value) => value.trim())) setPending(place)
    else apply(place)
  }
  return <div className="activity-place-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) search.dismiss() }}>
    <label htmlFor={`${id}-search`}>Rechercher un lieu</label>
    <input id={`${id}-search`} ref={input} type="text" role="combobox" value={state.query} maxLength={200} autoComplete="off"
      placeholder="Nom du lieu ou adresse…" disabled={network.offline || pending !== null}
      aria-autocomplete="list" aria-expanded={state.results.length > 0} aria-controls={state.results.length ? `${id}-results` : undefined}
      aria-activedescendant={state.results[index] ? `${id}-result-${index}` : undefined} aria-describedby={`${id}-help ${id}-status`}
      onChange={(event) => { setActive(0); search.query(event.target.value) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (pending || state.phase !== 'idle')) { event.preventDefault(); event.stopPropagation(); setPending(null); search.dismiss() }
        else if (event.key === 'Enter') { event.preventDefault(); if (state.results[index]) choose(state.results[index]) }
        else if (state.results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); setActive(Math.max(0, Math.min(state.results.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        }
      }} />
    <p id={`${id}-help`} className="activity-meta">À partir de 3 caractères, ta recherche est envoyée à Photon, sans position de l’appareil. La sélection ne sauvegarde pas l’activité.</p>
    <p id={`${id}-status`} role="status" className="activity-meta">{network.offline ? 'Recherche indisponible hors connexion. La saisie manuelle reste disponible.' : state.message}</p>
    {state.results.length > 0 && !network.offline && <ul id={`${id}-results`} role="listbox" aria-label="Lieux proposés">
      {state.results.map((place, position) => <li key={place.id} id={`${id}-result-${position}`} role="option" aria-selected={position === index}
        className={position === index ? 'place-result-active' : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}>
        <strong>{place.name}</strong><span>{[place.city, place.country].filter(Boolean).join(' · ')}</span>{place.address && <span>{place.address}</span>}
      </li>)}
    </ul>}
    {pending && <div className="place-search-confirm" role="alertdialog" aria-modal="false" aria-labelledby={`${id}-confirm`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPending(null); requestAnimationFrame(() => input.current?.focus()) } }}>
      <h4 id={`${id}-confirm`}>Remplacer la localisation saisie ?</h4>
      <p>Utiliser « {pending.name} » à la place du lieu, de l’adresse et des coordonnées actuels ?</p>
      <button ref={cancelButton} type="button" className="secondary-button" onClick={() => { setPending(null); requestAnimationFrame(() => input.current?.focus()) }}>Conserver ma saisie</button>
      <button type="button" className="secondary-button" onClick={() => apply(pending)}>Remplacer la localisation</button>
    </div>}
    <p className="activity-meta">Recherche : <a href="https://photon.komoot.io/" target="_blank" rel="noopener noreferrer">Photon</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">contributeurs OpenStreetMap</a></p>
  </div>
}
