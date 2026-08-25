import { describe, expect, it } from 'vitest'
import {
  aggregateLastFmCandidates,
  discoveryTrackKey,
  isUnwantedVariant,
  normalizeDiscoveryText,
  rankDiscoveryCandidates,
} from '../server/lib/discovery-ranking.ts'
import type { ResolvedDiscoveryCandidate } from '../server/types.ts'

function candidate(
  id: string,
  trackName: string,
  artistName: string,
  match = 0.8,
  seedLabels = ['Seed One by Artist One'],
): ResolvedDiscoveryCandidate {
  return {
    spotifyTrackId: id,
    spotifyUri: `spotify:track:${id}`,
    trackName,
    artistName,
    match,
    seedKeys: seedLabels.map((label) => label.toLowerCase()),
    seedLabels,
  }
}

describe('discovery candidate preparation', () => {
  it('normalizes feature credits and punctuation into the same key', () => {
    expect(normalizeDiscoveryText('Beyoncé & JAY-Z')).toBe('beyonce and jay z')
    expect(discoveryTrackKey('Artist', 'Song (feat. Guest)')).toBe(
      discoveryTrackKey('Artist', 'Song'),
    )
  })

  it('filters common alternate versions', () => {
    expect(isUnwantedVariant('Favourite Song - Live at Wembley')).toBe(true)
    expect(isUnwantedVariant('Favourite Song')).toBe(false)
  })

  it('combines candidates returned by more than one seed', () => {
    const combined = aggregateLastFmCandidates([
      {
        trackName: 'Find Me',
        artistName: 'New Artist',
        match: 0.71,
        seedKey: 'seed-one',
        seedLabel: 'Seed One',
      },
      {
        trackName: 'Find Me',
        artistName: 'New Artist',
        match: 0.84,
        seedKey: 'seed-two',
        seedLabel: 'Seed Two',
      },
    ])
    expect(combined).toHaveLength(1)
    expect(combined[0]).toMatchObject({ match: 0.84 })
    expect(combined[0].seedLabels).toEqual(['Seed One', 'Seed Two'])
  })
})

describe('discovery ranking', () => {
  it('removes known, rejected, and variant tracks before ranking', () => {
    const known = candidate('known-id', 'Known Song', 'Known Artist')
    const rejected = candidate('rejected-id', 'No Thanks', 'Other Artist')
    const live = candidate('live-id', 'Good Song - Live', 'New Artist')
    const fresh = candidate('fresh-id', 'Fresh Song', 'Fresh Artist')
    const feedback = new Map([['rejected-id', 'reject' as const]])
    const result = rankDiscoveryCandidates({
      candidates: [known, rejected, live, fresh],
      mode: 'balanced',
      limit: 20,
      knownTrackIds: new Set(['known-id']),
      knownTrackKeys: new Set(),
      knownArtists: new Set(['known artist']),
      feedback,
    })
    expect(result.map((item) => item.spotifyTrackId)).toEqual(['fresh-id'])
  })

  it('keeps no more than two tracks by one artist', () => {
    const result = rankDiscoveryCandidates({
      candidates: [
        candidate('one', 'First', 'Same Artist', 0.9),
        candidate('two', 'Second', 'Same Artist', 0.8),
        candidate('three', 'Third', 'Same Artist', 0.7),
        candidate('four', 'Fourth', 'Different Artist', 0.6),
      ],
      mode: 'balanced',
      limit: 4,
      knownTrackIds: new Set(),
      knownTrackKeys: new Set(),
      knownArtists: new Set(),
      feedback: new Map(),
    })
    expect(result.filter((item) => item.artistName === 'Same Artist')).toHaveLength(2)
    expect(result).toHaveLength(3)
  })
})
