import { validateCoordinates } from '../db/activityLocation'

export type MapPoint = { latitude: number; longitude: number; name: string }
export function activityMapPoint(activity: { latitude?: number; longitude?: number; location?: string }): MapPoint | null {
  try {
    const coordinates = validateCoordinates(activity.latitude, activity.longitude)
    if (coordinates.latitude === undefined || coordinates.longitude === undefined) return null
    return { latitude: coordinates.latitude, longitude: coordinates.longitude, name: activity.location ?? '' }
  } catch { return null }
}
