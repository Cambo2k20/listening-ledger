import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  ArtistCatalogTrack,
  DiscoverySeed,
  RankedDiscoveryCandidate,
  SpotifyTrack,
} from '../server/types.ts'

let database: typeof import('../server/db.ts')

const seed: DiscoverySeed = {
  spotifyTrackId: 'seed-track',
  spotifyUri: 'spotify:track:seed-track',
  trackName: 'Seed Track',
  artistName: 'Seed Artist',
  source: 'ledger',
}

const recommendation: RankedDiscoveryCandidate = {
  spotifyTrackId: 'fresh-track',
  spotifyUri: 'spotify:track:fresh-track',
  trackName: 'Fresh Track',
  artistName: 'Fresh Artist',
  match: 0.88,
  seedKeys: ['seed artist::seed track'],
  seedLabels: ['Seed Track by Seed Artist'],
  score: 91,
  reason: 'Similar to Seed Track by Seed Artist. This artist has not appeared in your ledger.',
  relationshipKind: 'similar',
  isNewArtist: true,
  isAnchor: false,
  decision: 'neutral',
}

function makeTrack(id: string, name: string, artistId: string, artistName: string): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    duration_ms: 180_000,
    artists: [
      {
        id: artistId,
        uri: `spotify:artist:${artistId}`,
        name: artistName,
      },
    ],
    album: {
      id: `${id}-album`,
      uri: `spotify:album:${id}-album`,
      name: `${name} Album`,
      images: [{ url: `https://images.example/${id}.jpg` }],
    },
  }
}

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('discovery persistence', () => {
  it('saves sessions and excludes rejected tracks from playlist output', () => {
    const sessionId = database.createDiscoverySession('balanced', 20, [seed])
    database.saveDiscoveryCandidates(sessionId, [recommendation])

    const saved = database.getDiscoverySession(sessionId)
    expect(saved?.seeds).toEqual([seed])
    expect(saved?.candidates[0]).toMatchObject({
      trackName: 'Fresh Track',
      isNewArtist: true,
      seedLabels: ['Seed Track by Seed Artist'],
    })
    expect(database.getDiscoveryPlaylistTracks(sessionId)).toHaveLength(1)

    database.setDiscoveryFeedback(saved!.candidates[0].id, 'reject')
    expect(database.getDiscoveryPlaylistTracks(sessionId)).toHaveLength(0)
    expect(database.getDiscoveryFeedbackMap().get('fresh-track')).toBe('reject')
  })

  it('unlocks automatic suggestions after 14 active days and exposes ranked artist seeds', () => {
    const coverageTrack = makeTrack('coverage-track', 'Coverage', 'coverage-artist', 'Coverage Artist')
    for (let day = 1; day <= 14; day += 1) {
      database.insertPlaybackEvent(
        coverageTrack,
        `2026-07-${String(day).padStart(2, '0')}T07:00:00.000Z`,
      )
    }

    const focusTracks = [
      makeTrack('focus-one', 'Focus One', 'focus-artist', 'Focus Artist'),
      makeTrack('focus-two', 'Focus Two', 'focus-artist', 'Focus Artist'),
      makeTrack('focus-three', 'Focus Three', 'focus-artist', 'Focus Artist'),
    ]
    const events = [
      [focusTracks[0], '2026-07-01T08:00:00.000Z'],
      [focusTracks[0], '2026-07-01T09:00:00.000Z'],
      [focusTracks[0], '2026-07-01T10:00:00.000Z'],
      [focusTracks[0], '2026-07-01T11:00:00.000Z'],
      [focusTracks[1], '2026-07-02T08:00:00.000Z'],
      [focusTracks[1], '2026-07-02T09:00:00.000Z'],
      [focusTracks[1], '2026-07-02T10:00:00.000Z'],
      [focusTracks[2], '2026-07-03T08:00:00.000Z'],
    ] as const
    events.forEach(([track, playedAt]) => database.insertPlaybackEvent(track, playedAt))

    const options = database.getArtistDiveOptions()
    expect(options.coverage).toEqual({ activeDays: 14, requiredActiveDays: 14, ready: true })
    expect(options.suggestions).toContainEqual(
      expect.objectContaining({
        id: 'focus-artist',
        events: 8,
        activeDays: 3,
        distinctTracks: 3,
        topTwoShare: 0.875,
      }),
    )
    expect(database.getArtistDiveSeeds('focus-artist').slice(0, 3)).toEqual([
      expect.objectContaining({ spotifyTrackId: 'focus-one', events: 4, source: 'ledger' }),
      expect.objectContaining({ spotifyTrackId: 'focus-two', events: 3, source: 'ledger' }),
      expect.objectContaining({ spotifyTrackId: 'focus-three', events: 1, source: 'ledger' }),
    ])
  })

  it('caches catalogues for seven days and preserves deep-dive session metadata', () => {
    const catalog = [
      {
        spotifyTrackId: 'catalog-track',
        spotifyUri: 'spotify:track:catalog-track',
        trackName: 'Catalogue Track',
        artistId: 'focus-artist',
        artistName: 'Focus Artist',
        albumId: 'catalog-album',
        albumUri: 'spotify:album:catalog-album',
        albumName: 'Catalogue Album',
        albumType: 'album',
        match: 0,
        seedKeys: [],
        seedLabels: [],
      },
    ] satisfies ArtistCatalogTrack[]
    const fetchedAt = '2026-08-20T12:00:00.000Z'
    database.saveCachedArtistCatalog('focus-artist', catalog, fetchedAt)
    expect(
      database.getCachedArtistCatalog(
        'focus-artist',
        7 * 86_400_000,
        Date.parse('2026-08-25T12:00:00.000Z'),
      ),
    ).toEqual(catalog)
    expect(
      database.getCachedArtistCatalog(
        'focus-artist',
        7 * 86_400_000,
        Date.parse('2026-08-28T12:00:00.001Z'),
      ),
    ).toBeNull()

    const focusSeed: DiscoverySeed = {
      spotifyTrackId: 'focus-one',
      spotifyUri: 'spotify:track:focus-one',
      trackName: 'Focus One',
      artistId: 'focus-artist',
      artistName: 'Focus Artist',
      source: 'ledger',
    }
    const anchor: RankedDiscoveryCandidate = {
      ...recommendation,
      spotifyTrackId: focusSeed.spotifyTrackId,
      spotifyUri: focusSeed.spotifyUri,
      trackName: focusSeed.trackName,
      artistId: 'focus-artist',
      artistName: 'Focus Artist',
      relationshipKind: 'anchor',
      isAnchor: true,
      reason: 'Familiar anchor.',
    }
    const diveRecommendation: RankedDiscoveryCandidate = {
      ...recommendation,
      spotifyTrackId: 'dive-recommendation',
      spotifyUri: 'spotify:track:dive-recommendation',
      artistId: 'focus-artist',
      artistName: 'Focus Artist',
      isNewArtist: false,
    }
    const sessionId = database.createDiscoverySession('deep', 12, [focusSeed], {
      kind: 'artist_dive',
      focusArtist: {
        id: 'focus-artist',
        name: 'Focus Artist',
        spotifyUri: 'spotify:artist:focus-artist',
      },
    })
    database.saveDiscoveryCandidates(sessionId, [anchor, diveRecommendation])
    const saved = database.getDiscoverySession(sessionId)
    expect(saved).toMatchObject({
      kind: 'artist_dive',
      mode: 'deep',
      targetCount: 12,
      focusArtist: { id: 'focus-artist', name: 'Focus Artist' },
      candidates: [
        { relationshipKind: 'anchor', isAnchor: true },
        { relationshipKind: 'similar', isAnchor: false },
      ],
    })

    database.setDiscoveryFeedback(saved!.candidates[0].id, 'reject')
    expect(database.getDiscoveryPlaylistTracks(sessionId)).toEqual([
      expect.objectContaining({ spotifyUri: 'spotify:track:dive-recommendation' }),
    ])
    expect(database.getDiscoveryFeedbackMap().has('focus-one')).toBe(false)
  })
})
