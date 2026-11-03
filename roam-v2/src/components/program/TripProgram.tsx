import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, List } from 'lucide-react'
import type { Trip } from '../../db/database'
import { formatDate, getTripDays, getTripMonths } from './dates'
import { TripCalendar } from './TripCalendar'
import './program.css'

function DayDetails({ date }: { date: string }) {
  return (
    <section className="program-day-detail" aria-labelledby="program-day-title">
      <h2 id="program-day-title">{formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
      <div className="program-empty">
        <CalendarDays size={36} aria-hidden="true" />
        <h3>Une journée à imaginer</h3>
        <p>Aucune activité n’est encore programmée pour cette journée.</p>
        <p>Tu pourras bientôt y organiser tes découvertes, à ton rythme.</p>
      </div>
    </section>
  )
}

function DayStrip({ days, selectedDate, onSelect }: { days: string[]; selectedDate: string; onSelect: (date: string) => void }) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedDate])
  return (
    <nav className="program-day-strip" aria-label="Journées du séjour">
      {days.map((date, index) => (
        <button type="button" key={date} ref={date === selectedDate ? selectedRef : undefined}
          className={`program-day-chip ${date === selectedDate ? 'selected' : ''}`}
          aria-pressed={date === selectedDate}
          aria-label={`Jour ${index + 1}, ${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
          onClick={() => onSelect(date)}>
          <span>Jour {index + 1}</span>
          <strong>{formatDate(date, { weekday: 'short', day: 'numeric' })}</strong>
          <span>{formatDate(date, { month: 'short', year: 'numeric' })}</span>
        </button>
      ))}
    </nav>
  )
}

export function TripProgram({ trip }: { trip: Trip }) {
  const days = useMemo(() => getTripDays(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const months = useMemo(() => getTripMonths(trip.startDate, trip.endDate), [trip.startDate, trip.endDate])
  const [mode, setMode] = useState<'day' | 'calendar'>('day')
  const [selectedDate, setSelectedDate] = useState(trip.startDate)
  const [month, setMonth] = useState(trip.startDate.slice(0, 7))

  function selectDay(date: string) {
    setSelectedDate(date)
    setMonth(date.slice(0, 7))
    setMode('day')
  }

  return (
    <section className="trip-program">
      <header className="program-heading">
        <p className="eyebrow">{trip.destination}</p>
        <h1>Programme</h1>
        <p className="subtitle">{days.length} journée{days.length > 1 ? 's' : ''} pour profiter du voyage.</p>
      </header>
      {days.length === 0 ? <p className="empty-state" role="status">Les dates de ce voyage ne permettent pas d’afficher le programme. Vérifie les dates de départ et de retour.</p> : <>
        <div className="program-mode-switch" role="group" aria-label="Mode d’affichage du programme">
          <button type="button" aria-pressed={mode === 'day'} onClick={() => setMode('day')}><List size={18} /> Jour par jour</button>
          <button type="button" aria-pressed={mode === 'calendar'} onClick={() => { setMonth(selectedDate.slice(0, 7)); setMode('calendar') }}><CalendarDays size={18} /> Calendrier</button>
        </div>
        {mode === 'day' ? <>
          <DayStrip days={days} selectedDate={selectedDate} onSelect={selectDay} />
          <DayDetails date={selectedDate} />
        </> : <TripCalendar months={months} month={month} startDate={trip.startDate} endDate={trip.endDate}
          selectedDate={selectedDate} onMonthChange={setMonth} onSelect={selectDay} />}
      </>}
    </section>
  )
}
