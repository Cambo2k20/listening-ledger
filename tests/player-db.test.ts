import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SpotifyTrack } from '../server/types.ts'

let database: typeof import('../server/db.ts')

const track: SpotifyTrack = {
  id: 'playable-track',
  uri: 'spotify:track:playable-track',
  name: 'Playable Track',
  duration_ms: 180_000,
  external_urls: { spotify: 'https://open.spotify.com/track/playable-track' },
  artists: [
    {
      id: 'playable-artist',
      uri: 'spotify:artist:playable-artist',
      name: 'Playable Artist',
      external_urls: { spotify: 'https://open.spotify.com/artist/playable-artist' },
    },
  ],
  album: {
    id: 'playable-album',
    uri: 'spotify:album:playable-album',
    name: 'Playable Album',
    external_urls: { spotify: 'https://open.spotify.com/album/playable-album' },
  },
}

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')
  database.insertPlaybackEvent(track, new Date().toISOString())
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('playable ledger records', () => {
  it('exposes Spotify URIs for dashboard, history, and every ranking type', () => {
    const dashboard = database.getDashboard('all') as {
      topTracks: Array<{ spotifyUri: string }>
      topArtists: Array<{ spotifyUri: string }>
    }
    expect(dashboard.topTracks[0].spotifyUri).toBe(track.uri)
    expect(dashboard.topArtists[0].spotifyUri).toBe(track.artists[0].uri)

    expect(database.getHistory()[0].spotifyUri).toBe(track.uri)
    expect(database.getRankings('track', 'all')[0].spotifyUri).toBe(track.uri)
    expect(database.getRankings('artist', 'all')[0].spotifyUri).toBe(track.artists[0].uri)
    expect(database.getRankings('album', 'all')[0].spotifyUri).toBe(track.album.uri)
  })
})
