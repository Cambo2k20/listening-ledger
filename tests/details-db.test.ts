import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SpotifyTrack } from '../server/types.ts'

let database: typeof import('../server/db.ts')

const primaryArtist = {
  id: 'detail-artist',
  uri: 'spotify:artist:detail-artist',
  name: 'Detail Artist',
  external_urls: { spotify: 'https://open.spotify.com/artist/detail-artist' },
}

function makeTrack(
  id: string,
  name: string,
  albumId: string,
  albumName: string,
  artist = primaryArtist,
): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    duration_ms: 180_000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    artists: [artist],
    album: {
      id: albumId,
      uri: `spotify:album:${albumId}`,
      name: albumName,
      images: [{ url: `https://images.example/${albumId}.jpg`, width: 300 }],
      external_urls: { spotify: `https://open.spotify.com/album/${albumId}` },
    },
  }
}

const focusTrack = makeTrack(
  'detail-track',
  'Detail Track',
  'detail-album',
  'Detail Album',
)
const siblingTrack = makeTrack(
  'sibling-track',
  'Sibling Track',
  'detail-album',
  'Detail Album',
)
const otherTrack = makeTrack(
  'other-track',
  'Other Track',
  'other-album',
  'Other Album',
  {
    id: 'other-artist',
    uri: 'spotify:artist:other-artist',
    name: 'Other Artist',
    external_urls: { spotify: 'https://open.spotify.com/artist/other-artist' },
  },
)

function daysAgo(days: number, hour = 12): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')

  ;[1, 2, 10].forEach((day, index) => {
    database.insertPlaybackEvent(focusTrack, daysAgo(day, 10 + index))
  })
  ;[3, 31].forEach((day, index) => {
    database.insertPlaybackEvent(siblingTrack, daysAgo(day, 14 + index))
  })
  ;[1, 2, 3, 4].forEach((day, index) => {
    database.insertPlaybackEvent(otherTrack, daysAgo(day, 16 + index))
  })
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('ledger entity details', () => {
  it('builds a track drill-down with related credits and period ranks', () => {
    const detail = database.getEntityDetail('track', focusTrack.id, 'all') as {
      entity: {
        id: string
        album: { id: string }
        artists: Array<{ id: string }>
      }
      summary: { events: number; activeDays: number }
      timeline: { bucketKind: string; items: Array<{ events: number }> }
      rankings: Array<{ period: string; position: number; events: number }>
      related: Array<{
        title: string
        items: Array<{ id: string; type: string }>
      }>
      recentEvents: Array<{ trackId: string }>
    }

    expect(detail.entity).toMatchObject({
      id: focusTrack.id,
      album: { id: 'detail-album' },
      artists: [{ id: primaryArtist.id }],
    })
    expect(detail.summary).toMatchObject({ events: 3, activeDays: 3 })
    expect(detail.timeline.bucketKind).toBe('month')
    expect(
      detail.timeline.items.reduce((sum, item) => sum + item.events, 0),
    ).toBe(3)
    expect(detail.rankings.find((item) => item.period === 'all')).toMatchObject({
      position: 2,
      events: 3,
    })
    expect(detail.related[1]).toMatchObject({
      title: 'More from this album',
      items: [expect.objectContaining({ id: siblingTrack.id, type: 'track' })],
    })
    expect(detail.recentEvents).toHaveLength(3)
  })

  it('builds artist and album drill-downs from primary observed events', () => {
    const artist = database.getEntityDetail('artist', primaryArtist.id, 'all') as {
      summary: { events: number }
      rankings: Array<{ period: string; position: number; events: number }>
      related: Array<{ title: string; items: Array<{ id: string }> }>
    }
    const album = database.getEntityDetail('album', 'detail-album', '30d') as {
      summary: { events: number; firstPlayed: string; lastPlayed: string }
      timeline: { bucketKind: string }
      related: Array<{ title: string; items: Array<{ id: string }> }>
    }

    expect(artist.summary.events).toBe(5)
    expect(artist.rankings.find((item) => item.period === 'all')).toMatchObject({
      position: 1,
      events: 5,
    })
    expect(artist.related[0]).toMatchObject({
      title: 'Top tracks',
      items: expect.arrayContaining([
        expect.objectContaining({ id: focusTrack.id }),
        expect.objectContaining({ id: siblingTrack.id }),
      ]),
    })

    expect(album.summary.events).toBe(4)
    expect(album.summary.firstPlayed).toBeTruthy()
    expect(album.summary.lastPlayed).toBeTruthy()
    expect(album.timeline.bucketKind).toBe('day')
    expect(album.related[0]).toMatchObject({
      title: 'Artists',
      items: [expect.objectContaining({ id: primaryArtist.id })],
    })
  })

  it('returns null for an ID that is not in the ledger', () => {
    expect(database.getEntityDetail('track', 'missing-track')).toBeNull()
  })
})
