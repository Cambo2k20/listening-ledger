import type { SpotifyPlayHistoryItem } from '../types.ts'

export function playbackEventKey(item: SpotifyPlayHistoryItem): string {
  return `${item.played_at}::${item.track.uri}`
}

export function deduplicatePlaybackEvents(
  items: SpotifyPlayHistoryItem[],
): SpotifyPlayHistoryItem[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    const key = playbackEventKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

