import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { currencyOptionLabel, currencyOptions, searchCurrencies } from './currencyOptions'
import './currency-selector.css'

type Props = { label: string; value: string; onChange: (code: string) => void; allowEmpty?: boolean }

export function CurrencySelector({ label, value, onChange, allowEmpty = false }: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const current = currencyOptions.find((option) => option.code === value)
  const results = searchCurrencies(query)
  const options = [
    ...(allowEmpty && !query.trim() ? [{ code: '', label: 'Devise non renseignée' }] : []),
    ...results.map((option) => ({ code: option.code, label: currencyOptionLabel(option) })),
  ]
  const index = Math.min(active, Math.max(0, options.length - 1))
  const selectedLabel = current ? currencyOptionLabel(current) : value ? `${value} — devise historique conservée` : 'Devise non renseignée'
  useEffect(() => { if (open) search.current?.focus() }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, index, id])
  function close(restoreFocus = true) {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }
  function select(code: string) {
    onChange(code)
    close()
  }
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((previous) => Math.max(0, Math.min(options.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Home' || event.key === 'End') {
      if (event.ctrlKey) { event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, options.length - 1)) }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (options[index]) select(options[index].code)
    }
  }
  return <div className="currency-selector" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false) }}>
    <span id={`${id}-label`} className="currency-selector-label">{label}</span>
    <button ref={trigger} type="button" className="currency-selector-trigger"
      aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-haspopup="listbox"
      onClick={() => { if (open) close(); else { setQuery(''); setActive(0); setOpen(true) } }}>
      <span id={`${id}-value`}>{selectedLabel}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div className="currency-selector-panel">
      <input ref={search} role="combobox" aria-label={`Rechercher : ${label}`} aria-expanded="true"
        aria-autocomplete="list" aria-controls={`${id}-list`}
        aria-activedescendant={options[index] ? `${id}-option-${index}` : undefined}
        autoComplete="off" placeholder="Nom, code ou pays courant…" value={query}
        onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={keyboard} />
      {!current && value && <p className="currency-selector-note">Valeur historique conservée tant que tu ne sélectionnes pas une autre devise.</p>}
      <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
        {options.map((option, position) => <li key={option.code} id={`${id}-option-${position}`} role="option"
          aria-selected={option.code === value} className={position === index ? 'currency-option-active' : undefined}
          onMouseDown={(event) => event.preventDefault()} onClick={() => select(option.code)}>
          {option.label}
        </li>)}
      </ul>
      {options.length === 0 && <p role="status" className="currency-selector-note">Aucune devise trouvée.</p>}
    </div>}
  </div>
}
