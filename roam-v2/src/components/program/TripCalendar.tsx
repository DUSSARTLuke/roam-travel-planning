import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDate, getMonthCells } from './dates'

type Props = {
  months: string[]
  month: string
  startDate: string
  endDate: string
  selectedDate: string
  onMonthChange: (month: string) => void
  onSelect: (date: string) => void
}

export function TripCalendar({ months, month, startDate, endDate, selectedDate, onMonthChange, onSelect }: Props) {
  const monthIndex = months.indexOf(month)
  return (
    <section className="program-calendar" aria-label="Calendrier du séjour">
      <div className="program-month-nav">
        <button type="button" className="icon-button" aria-label="Mois précédent" disabled={monthIndex <= 0}
          onClick={() => onMonthChange(months[monthIndex - 1])}><ChevronLeft size={20} /></button>
        <h2 aria-live="polite">{formatDate(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
        <button type="button" className="icon-button" aria-label="Mois suivant" disabled={monthIndex >= months.length - 1}
          onClick={() => onMonthChange(months[monthIndex + 1])}><ChevronRight size={20} /></button>
      </div>
      <div className="program-calendar-grid">
        {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => <span className="program-weekday" key={day}>{day}</span>)}
        {getMonthCells(month).map((date, index) => {
          if (!date) return <span key={`blank-${index}`} aria-hidden="true" />
          const inTrip = date >= startDate && date <= endDate
          return (
            <button type="button" key={date}
              className={`program-calendar-day ${inTrip ? 'in-trip' : ''} ${date === selectedDate ? 'selected' : ''}`}
              disabled={!inTrip} aria-pressed={date === selectedDate}
              aria-label={formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              onClick={() => onSelect(date)}>{Number(date.slice(8))}</button>
          )
        })}
      </div>
      <p className="program-legend"><span /> Dates du séjour · Choisis une date pour afficher sa journée.</p>
    </section>
  )
}
