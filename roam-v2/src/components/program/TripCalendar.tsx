import type { Accommodation } from '../../evolution/v21/contracts'
import { stayPhase } from '../../accommodations/model'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDate, getMonthCells } from './dates'

type Props = {
  accommodations?:Accommodation[]
  onAccommodationOpen?:(stay:Accommodation,trigger:HTMLButtonElement)=>void
  months: string[]
  month: string
  startDate: string
  endDate: string
  selectedDate: string
  accommodationCounts?: Record<string, number>
  activityCounts: Record<string, number>
  onMonthChange: (month: string) => void
  onSelect: (date: string) => void
}

export function TripCalendar({ months, month, startDate, endDate, selectedDate, activityCounts, accommodationCounts={}, accommodations=[], onAccommodationOpen, onMonthChange, onSelect }: Props) {
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
          const activityCount = activityCounts[date] ?? 0
          return (
            <span key={date} className="program-calendar-cell"><button type="button" key={date}
              className={`program-calendar-day ${inTrip ? 'in-trip' : ''} ${date === selectedDate ? 'selected' : ''}`}
              disabled={!inTrip} aria-pressed={date === selectedDate}
              aria-label={`${formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${activityCount} activité${activityCount > 1 ? 's' : ''}${accommodationCounts[date]?`, ${accommodationCounts[date]} hébergement(s)`:''}`}
              onClick={() => onSelect(date)}>
              {Number(date.slice(8))}
              {!!accommodationCounts[date]&&<span className="stay-calendar-mark" aria-hidden="true">▣</span>}
              {activityCount > 0 && <span className="program-activity-count" aria-hidden="true">{activityCount}</span>}
            </button>{onAccommodationOpen&&accommodations.filter(stay=>stayPhase(stay,date)).map(stay=><button key={stay.id} type="button" className="stay-calendar-open" aria-label={`Ouvrir l’hébergement ${stay.place.name} le ${date}`} onClick={event=>onAccommodationOpen(stay,event.currentTarget)}>▣<span className="sr-only">{stay.place.name}</span></button>)}</span>
          )
        })}
      </div>
      <p className="program-legend"><span /> Dates du séjour · Les pastilles indiquent les activités. Choisis une date pour afficher sa journée.</p>
    </section>
  )
}
