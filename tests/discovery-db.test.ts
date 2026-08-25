import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DiscoverySeed, RankedDiscoveryCandidate } from '../server/types.ts'

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
  isNewArtist: true,
  decision: 'neutral',
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
})
