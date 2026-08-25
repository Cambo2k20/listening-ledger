import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SpotifyTrack } from '../server/types.ts'

let database: typeof import('../server/db.ts')

function makeTrack(
  id: string,
  name: string,
  artistId: string,
  artistName: string,
  albumId: string,
  albumName: string,
): SpotifyTrack {
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    duration_ms: 180_000,
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    artists: [
      {
        id: artistId,
        uri: `spotify:artist:${artistId}`,
        name: artistName,
        external_urls: {
          spotify: `https://open.spotify.com/artist/${artistId}`,
        },
      },
    ],
    album: {
      id: albumId,
      uri: `spotify:album:${albumId}`,
      name: albumName,
      images: [{ url: `https://images.example/${albumId}.jpg`, width: 300 }],
      external_urls: { spotify: `https://open.spotify.com/album/${albumId}` },
    },
  }
}

const returningTrack = makeTrack(
  'return-track',
  'Return Track',
  'return-artist',
  'Return Artist',
  'return-album',
  'Return Album',
)
const secondTrack = makeTrack(
  'second-track',
  'Second Track',
  'second-artist',
  'Second Artist',
  'second-album',
  'Second Album',
)
const newestTrack = makeTrack(
  'newest-track',
  'Newest Track',
  'newest-artist',
  'Newest Artist',
  'newest-album',
  'Newest Album',
)

function insert(track: SpotifyTrack, value: string): void {
  database.insertPlaybackEvent(track, value)
}

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')

  insert(returningTrack, '2026-01-01T10:00:00.000Z')
  insert(returningTrack, '2026-04-05T10:00:00.000Z')
  insert(secondTrack, '2026-08-02T10:00:00.000Z')
  insert(newestTrack, '2026-08-05T10:00:00.000Z')
  insert(returningTrack, '2026-08-10T10:00:00.000Z')
  insert(returningTrack, '2026-08-11T10:00:00.000Z')
  insert(returningTrack, '2026-08-12T10:00:00.000Z')
  insert(returningTrack, '2026-08-13T08:00:00.000Z')
  insert(secondTrack, '2026-08-13T12:00:00.000Z')
  insert(newestTrack, '2026-08-13T18:00:00.000Z')
  insert(returningTrack, '2026-08-24T10:00:00.000Z')
  insert(returningTrack, '2026-08-25T10:00:00.000Z')
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('records and milestones', () => {
  it('calculates current and longest active-day streaks plus the peak day', () => {
    const records = database.getRecordsAndMilestones(
      new Date('2026-08-25T12:00:00.000Z'),
    ) as {
      summary: {
        totalEvents: number
        activeDays: number
        bestDay: { day: string; events: number; tiedDays: number }
      }
      streaks: {
        current: { days: number; startDay: string; state: string }
        longest: { days: number; startDay: string; endDay: string }
      }
    }

    expect(records.summary).toMatchObject({
      totalEvents: 12,
      activeDays: 10,
      bestDay: { day: '2026-08-13', events: 3, tiedDays: 1 },
    })
    expect(records.streaks.current).toMatchObject({
      days: 2,
      startDay: '2026-08-24',
      state: 'active',
    })
    expect(records.streaks.longest).toEqual({
      days: 4,
      startDay: '2026-08-10',
      endDay: '2026-08-13',
    })
  })

  it('ends a current streak after a full inactive calendar day', () => {
    const records = database.getRecordsAndMilestones(
      new Date('2026-08-27T12:00:00.000Z'),
    ) as { streaks: { current: { days: number; state: string } } }

    expect(records.streaks.current).toEqual(
      expect.objectContaining({ days: 0, state: 'ended' }),
    )
  })

  it('dates cumulative milestones and finds 90-day artist returns', () => {
    const records = database.getRecordsAndMilestones(
      new Date('2026-08-25T12:00:00.000Z'),
    ) as {
      milestones: {
        achieved: Array<{ value: number; reachedAt: string }>
        next: { value: number; remaining: number; progress: number }
      }
      rediscoveries: Array<{
        artistId: string
        returnedAt: string
        gapDays: number
      }>
    }

    expect(records.milestones.achieved).toEqual([
      { value: 1, reachedAt: '2026-01-01T10:00:00.000Z' },
      { value: 10, reachedAt: '2026-08-13T18:00:00.000Z' },
    ])
    expect(records.milestones.next).toMatchObject({
      value: 25,
      remaining: 13,
      progress: 12 / 25,
    })
    expect(records.rediscoveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artistId: 'return-artist',
          returnedAt: '2026-08-10T10:00:00.000Z',
          gapDays: 127,
        }),
        expect.objectContaining({
          artistId: 'return-artist',
          returnedAt: '2026-04-05T10:00:00.000Z',
          gapDays: 94,
        }),
      ]),
    )
  })

  it('returns the newest first appearances for every entity type', () => {
    const records = database.getRecordsAndMilestones(
      new Date('2026-08-25T12:00:00.000Z'),
    ) as {
      firstAppearances: {
        tracks: Array<{ id: string; firstPlayed: string }>
        artists: Array<{ id: string; firstPlayed: string }>
        albums: Array<{ id: string; firstPlayed: string }>
      }
    }

    expect(records.firstAppearances.tracks[0]).toMatchObject({
      id: 'newest-track',
      firstPlayed: '2026-08-05T10:00:00.000Z',
    })
    expect(records.firstAppearances.artists[0]).toMatchObject({
      id: 'newest-artist',
      firstPlayed: '2026-08-05T10:00:00.000Z',
    })
    expect(records.firstAppearances.albums[0]).toMatchObject({
      id: 'newest-album',
      firstPlayed: '2026-08-05T10:00:00.000Z',
    })
  })

  it('keeps listening-time records hidden until an import batch exists', () => {
    const beforeImport = database.getRecordsAndMilestones() as {
      verifiedListening: unknown
    }
    expect(beforeImport.verifiedListening).toBeNull()

    const batch = database.db.prepare(`
      INSERT INTO import_batches
        (imported_at, source_name, source_hash, event_count)
      VALUES (?, ?, ?, ?)
    `).run('2026-08-25T12:00:00.000Z', 'history.json', 'records-test', 3)
    const batchId = Number(batch.lastInsertRowid)
    const insertVerified = database.db.prepare(`
      INSERT INTO verified_streams
        (played_at, track_uri, track_name, artist_name, album_name,
          ms_played, skipped, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertVerified.run(
      '2026-08-20T10:00:00.000Z',
      'spotify:track:one',
      'One',
      'Artist',
      'Album',
      60_000,
      0,
      batchId,
    )
    insertVerified.run(
      '2026-08-20T11:00:00.000Z',
      'spotify:track:two',
      'Two',
      'Artist',
      'Album',
      10_000,
      1,
      batchId,
    )
    insertVerified.run(
      '2026-08-21T10:00:00.000Z',
      'spotify:track:three',
      'Three',
      'Artist',
      'Album',
      120_000,
      0,
      batchId,
    )

    const afterImport = database.getRecordsAndMilestones() as {
      verifiedListening: {
        importBatchCount: number
        totalMsPlayed: number
        streamCount: number
        highestDay: { day: string; msPlayed: number }
      }
    }
    expect(afterImport.verifiedListening).toEqual({
      importBatchCount: 1,
      totalMsPlayed: 190_000,
      streamCount: 2,
      highestDay: { day: '2026-08-21', msPlayed: 120_000 },
    })
  })
})
