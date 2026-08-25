import { describe, expect, it } from 'vitest'
import {
  deduplicatePlaybackEvents,
  playbackEventKey,
} from '../server/lib/dedup.ts'
import type { SpotifyPlayHistoryItem } from '../server/types.ts'

function event(
  playedAt: string,
  uri = 'spotify:track:one',
): SpotifyPlayHistoryItem {
  return {
    played_at: playedAt,
    context: null,
    track: {
      id: uri.split(':').at(-1)!,
      uri,
      name: 'Track',
      duration_ms: 180_000,
      external_urls: { spotify: 'https://open.spotify.com/track/one' },
      artists: [
        { id: 'artist', uri: 'spotify:artist:artist', name: 'Artist' },
      ],
      album: {
        id: 'album',
        uri: 'spotify:album:album',
        name: 'Album',
      },
    },
  }
}

describe('playback event deduplication', () => {
  it('uses both timestamp and track URI as the identity', () => {
    expect(playbackEventKey(event('2026-08-25T10:00:00.000Z'))).toBe(
      '2026-08-25T10:00:00.000Z::spotify:track:one',
    )
  })

  it('removes exact duplicate events', () => {
    const first = event('2026-08-25T10:00:00.000Z')
    expect(deduplicatePlaybackEvents([first, first])).toHaveLength(1)
  })

  it('preserves different tracks at the same timestamp', () => {
    const items = [
      event('2026-08-25T10:00:00.000Z'),
      event('2026-08-25T10:00:00.000Z', 'spotify:track:two'),
    ]
    expect(deduplicatePlaybackEvents(items)).toHaveLength(2)
  })
})

