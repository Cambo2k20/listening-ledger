import { describe, expect, it } from 'vitest'
import {
  createArtistDiveAnchor,
  normalizedAlbumKey,
  orderArtistDivePlaylist,
  rankArtistDiveCandidates,
  underexploredArtistScore,
} from '../server/lib/artist-dive.ts'
import { discoveryTrackKey } from '../server/lib/discovery-ranking.ts'
import type {
  ArtistCatalogTrack,
  DiscoverySeed,
  RankedDiscoveryCandidate,
} from '../server/types.ts'

const artist = {
  id: 'artist-1',
  name: 'Focus Artist',
}

function catalogTrack(
  id: string,
  name: string,
  albumId: string,
  albumName: string,
): ArtistCatalogTrack {
  return {
    spotifyTrackId: id,
    spotifyUri: `spotify:track:${id}`,
    trackName: name,
    artistId: artist.id,
    artistName: artist.name,
    albumId,
    albumUri: `spotify:album:${albumId}`,
    albumName,
    albumType: 'album',
    releaseDate: '2020-01-01',
    match: 0,
    seedKeys: [],
    seedLabels: [],
  }
}

const seed: DiscoverySeed = {
  spotifyTrackId: 'seed-track',
  spotifyUri: 'spotify:track:seed-track',
  trackName: 'Favourite Song',
  artistId: artist.id,
  artistName: artist.name,
  albumId: 'known-album',
  albumUri: 'spotify:album:known-album',
  albumName: 'Known Album',
  source: 'ledger',
  events: 8,
}

function rank(catalog: ArtistCatalogTrack[]) {
  return rankArtistDiveCandidates({
    catalog,
    seeds: [seed],
    similarCandidates: [
      {
        key: discoveryTrackKey(artist.name, 'Direct Match'),
        trackName: 'Direct Match',
        artistName: artist.name,
        match: 0.91,
        seedKeys: [discoveryTrackKey(seed.artistName, seed.trackName)],
        seedLabels: [`${seed.trackName} by ${seed.artistName}`],
      },
    ],
    mode: 'close',
    limit: 20,
    knownTrackIds: new Set(['known-track']),
    knownTrackKeys: new Set(),
    knownAlbumIds: new Set(['known-album']),
    feedback: new Map([
      ['rejected-track', 'reject'],
      ['known-feedback-track', 'known'],
    ]),
  })
}

describe('artist deep-dive ranking', () => {
  it('labels only Last.fm matches as similar and explains other catalogue paths truthfully', () => {
    const result = rank([
      catalogTrack('direct-track', 'Direct Match', 'new-album', 'New Album'),
      catalogTrack('album-track', 'Album Bridge', 'known-album', 'Known Album'),
      catalogTrack('catalog-track', 'Catalogue Pick', 'other-album', 'Other Album'),
    ])

    expect(result.find((item) => item.spotifyTrackId === 'direct-track')).toMatchObject({
      relationshipKind: 'similar',
      reason: expect.stringContaining('Last.fm returned this direct track relationship'),
    })
    expect(result.find((item) => item.spotifyTrackId === 'album-track')).toMatchObject({
      relationshipKind: 'album',
      reason: expect.stringContaining('the same album as'),
    })
    expect(result.find((item) => item.spotifyTrackId === 'catalog-track')).toMatchObject({
      relationshipKind: 'catalog',
      reason: expect.stringContaining('an album that has not appeared in your ledger'),
    })
  })

  it('removes already-known, rejected, known-feedback, and variant tracks', () => {
    const result = rank([
      catalogTrack('known-track', 'Known Track', 'a', 'A'),
      catalogTrack('rejected-track', 'Rejected Track', 'b', 'B'),
      catalogTrack('known-feedback-track', 'Known Feedback', 'c', 'C'),
      catalogTrack('live-track', 'Great Song - Live', 'd', 'D'),
      catalogTrack('fresh-track', 'Fresh Track', 'e', 'E'),
    ])

    expect(result.map((item) => item.spotifyTrackId)).toEqual(['fresh-track'])
  })

  it('spreads across albums in deep mode and caps each album at two tracks', () => {
    const catalog = [
      catalogTrack('a1', 'A One', 'album-a', 'Album A'),
      catalogTrack('a2', 'A Two', 'album-a', 'Album A'),
      catalogTrack('a3', 'A Three', 'album-a', 'Album A'),
      catalogTrack('b1', 'B One', 'album-b', 'Album B'),
      catalogTrack('c1', 'C One', 'album-c', 'Album C'),
      catalogTrack('d1', 'D One', 'album-d', 'Album D'),
    ]
    const result = rankArtistDiveCandidates({
      catalog,
      seeds: [seed],
      similarCandidates: [],
      mode: 'deep',
      limit: 6,
      knownTrackIds: new Set(),
      knownTrackKeys: new Set(),
      knownAlbumIds: new Set(['known-album']),
      feedback: new Map(),
    })

    expect(new Set(result.slice(0, 3).map((item) => item.albumId)).size).toBe(3)
    const counts = result.reduce<Record<string, number>>((items, item) => {
      items[item.albumId!] = (items[item.albumId!] ?? 0) + 1
      return items
    }, {})
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2)
  })

  it('places two familiar anchors at positions one and five in a 12-track set', () => {
    const recommendations = Array.from({ length: 12 }, (_, index) => ({
      ...catalogTrack(`rec-${index}`, `Recommendation ${index}`, `album-${index}`, `Album ${index}`),
      score: 50 - index,
      reason: 'Catalogue pick.',
      relationshipKind: 'catalog' as const,
      isNewArtist: false,
      isAnchor: false,
      decision: 'neutral' as const,
    })) satisfies RankedDiscoveryCandidate[]
    const anchors = [
      createArtistDiveAnchor(seed, artist.id),
      createArtistDiveAnchor({ ...seed, spotifyTrackId: 'second-seed', trackName: 'Second Favourite' }, artist.id),
    ]

    const ordered = orderArtistDivePlaylist(recommendations, anchors, 12)
    expect(ordered).toHaveLength(12)
    expect(ordered[0].isAnchor).toBe(true)
    expect(ordered[4].isAnchor).toBe(true)
    expect(ordered.filter((item) => item.isAnchor)).toHaveLength(2)
  })

  it('normalizes reissue labels and gives optional signals a bounded boost', () => {
    expect(normalizedAlbumKey('Night Drive (Deluxe Remastered Edition)')).toBe('night drive')
    expect(
      normalizedAlbumKey(
        "Balance, Not Symmetry (From the Original Motion Picture Soundtrack 'Balance, Not Symmetry')",
      ),
    ).toBe(normalizedAlbumKey('Balance, Not Symmetry (Original Motion Picture Soundtrack)'))
    const base = underexploredArtistScore({
      events: 8,
      activeDays: 3,
      distinctTracks: 3,
      topTwoShare: 0.75,
      topItemSignal: false,
      lovedTrackSignal: false,
    })
    const boosted = underexploredArtistScore({
      events: 8,
      activeDays: 3,
      distinctTracks: 3,
      topTwoShare: 0.75,
      topItemSignal: true,
      lovedTrackSignal: true,
    })
    expect(boosted - base).toBe(10)
  })
})
