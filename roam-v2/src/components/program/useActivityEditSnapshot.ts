import { useState } from 'react'
import type { TripActivity } from '../../db/activityModel'
// A live-query deletion must not unmount an editor and discard its draft.
export function useActivityEditSnapshot(tripId: string, editingId: string | null, live: TripActivity | undefined) {
  const [opening, setOpening] = useState<{ tripId: string; activity: TripActivity } | null>(null)
  if (editingId && live && (opening?.tripId !== tripId || opening.activity.id !== editingId)) setOpening({ tripId, activity: live })
  if (!editingId) { if (opening) setOpening(null); return live }
  return opening?.tripId === tripId && opening.activity.id === editingId ? opening.activity : live
}
