import type { ActivityFormValues } from './activityFormModel'
const labels: Record<keyof ActivityFormValues, string> = {
  title: 'Nom', category: 'Catégorie', date: 'Date', idea: 'Idée à planifier', scheduleType: 'Planification', startTime: 'Début', endTime: 'Fin', period: 'Moment',
  location: 'Lieu', address: 'Adresse', latitude: 'Latitude', longitude: 'Longitude', notes: 'Notes', reservationType: 'Type de réservation', reservationStatus: 'Statut de réservation', reservationReference: 'Référence', reservationProvider: 'Prestataire', reservationPeople: 'Personnes', reservationDeadline: 'Date limite', reservationNotes: 'Notes de réservation', estimatedCost: 'Estimé', paidAmount: 'Payé', currency: 'Devise', legacyUrl: 'Lien historique', links: 'Liens utiles',
}
export function activityDraftText(form: ActivityFormValues) {
  return (Object.keys(form) as (keyof ActivityFormValues)[]).map((key) => {
    const value = form[key]
    return `${labels[key]} : ${Array.isArray(value) ? value.map((link) => `${link.title} — ${link.url}`).join('\n') : typeof value === 'boolean' ? value ? 'Oui' : 'Non' : value || 'Non renseigné'}`
  }).join('\n')
}
