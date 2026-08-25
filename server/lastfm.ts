import { config } from './config.ts'
import type { DiscoverySeed, LastFmCandidate } from './types.ts'
import { discoveryTrackKey } from './lib/discovery-ranking.ts'

interface LastFmSimilarTrack {
  name?: string
  match?: string | number
  artist?: { name?: string }
}

export class LastFmError extends Error {}

export async function getLastFmSimilarTracks(
  seed: DiscoverySeed,
): Promise<LastFmCandidate[]> {
  if (!config.lastFmApiKey) {
    throw new LastFmError('LASTFM_API_KEY is not configured.')
  }
  const url = new URL('https://ws.audioscrobbler.com/2.0/')
  url.searchParams.set('method', 'track.getsimilar')
  url.searchParams.set('api_key', config.lastFmApiKey)
  url.searchParams.set('artist', seed.artistName)
  url.searchParams.set('track', seed.trackName)
  url.searchParams.set('autocorrect', '1')
  url.searchParams.set('limit', '40')
  url.searchParams.set('format', 'json')

  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: number
        message?: string
        similartracks?: { track?: LastFmSimilarTrack[] }
      }
    | null
  if (!response.ok || payload?.error) {
    throw new LastFmError(
      payload?.message ?? `Last.fm request failed with ${response.status}.`,
    )
  }

  const seedLabel = `${seed.trackName} by ${seed.artistName}`
  const seedKey = discoveryTrackKey(seed.artistName, seed.trackName)
  return (payload?.similartracks?.track ?? []).flatMap((track) => {
    const trackName = track.name?.trim()
    const artistName = track.artist?.name?.trim()
    if (!trackName || !artistName) return []
    const parsedMatch = Number(track.match ?? 0)
    return [{
      trackName,
      artistName,
      match: Number.isFinite(parsedMatch) ? parsedMatch : 0,
      seedKey,
      seedLabel,
    }]
  })
}
