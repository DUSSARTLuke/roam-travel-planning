import { useMemo } from 'react'
import type { TripActivity } from '../../db/activityModel'
import type { Trip } from '../../db/database'
import { activityMoneyRows } from '../../money/activityMoney'
import { useUtcDay } from '../../hooks/useUtcDay'
import { formatDate } from './dates'

export function ActivityMoneyDetails({ activity, trip }: { activity: TripActivity; trip: Trip }) {
  const today = useUtcDay()
  const rows = useMemo(() => activityMoneyRows(activity, trip, today), [activity, trip, today])
  if (!rows.length && !activity.currency) return null
  return <section aria-labelledby="activity-detail-budget">
    <h3 id="activity-detail-budget">Budget de l’activité</h3>
    <dl className="activity-detail-fields">
      {rows.map((row) => <div key={row.kind}>
        <dt>{row.label}</dt>
        <dd>
          <span className="activity-money-original">{row.original}</span>
          {row.conversion && <>
            <span className="activity-money-equivalent">{row.conversion.text}</span>
            <span className="activity-money-source">{row.conversion.provenance}
              {row.conversion.date && <> · {row.conversion.provenance === 'Taux manuel' ? 'modifié le ' : 'observation du '}
                <time dateTime={row.conversion.date}>{formatDate(row.conversion.date.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}</time></>}
            </span>
            {row.conversion.stale && <span className="activity-money-warning">Taux automatique ancien — équivalent indicatif fondé sur le dernier taux connu.</span>}
            {row.conversion.future && <span className="activity-money-warning">Date du taux en avance — vérifier l’horloge du système.</span>}
          </>}
          {row.unavailable && <span className="activity-money-source">Conversion indisponible — {row.unavailable}.</span>}
        </dd>
      </div>)}
      {activity.currency && <div><dt>Devise d’origine</dt><dd>{activity.currency}</dd></div>}
    </dl>
    {rows.some((row) => row.conversion) && <p className="activity-meta">Équivalents indicatifs dans la devise du voyage. Les montants d’origine restent inchangés.</p>}
  </section>
}
