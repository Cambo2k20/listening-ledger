export const SPOTIFY_SYNC_LOCK = 'spotify-sync'
export const SYNC_LOCK_TTL_MS = 10 * 60_000

export function isDailyTopSyncDue(
  lastSuccessAt: string | null,
  now = new Date(),
): boolean {
  if (!lastSuccessAt) return true
  const last = new Date(lastSuccessAt)
  if (Number.isNaN(last.getTime())) return true
  return last.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10)
}
