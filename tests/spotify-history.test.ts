import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  createHistoryAccumulator,
  finalizeHistoryAccumulator,
  HistoryRecordLimitError,
  MAX_SPOTIFY_MUSIC_MS_PLAYED,
  parseSpotifyHistoryJsonStream,
  spotifyHistoryDedupeKey,
  spotifyHistoryOverlapKey,
} from '../server/lib/spotify-history.ts'

function jsonStream(value: unknown): Readable {
  return Readable.from([JSON.stringify(value)])
}

describe('Spotify history parsing', () => {
  it('normalizes Extended Streaming History through a privacy-safe allowlist', async () => {
    const accumulator = createHistoryAccumulator()

    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          ts: '2026-08-20T12:34:56Z',
          ms_played: 45_500,
          master_metadata_track_name: '  Purple Sky  ',
          master_metadata_album_artist_name: 'Night Drive',
          master_metadata_album_album_name: 'Violet Hours',
          spotify_track_uri: 'spotify:track:purple',
          skipped: false,
          ip_addr_decrypted: '203.0.113.10',
          platform: 'sensitive-platform',
          conn_country: 'GB',
          user_agent_decrypted: 'sensitive-device',
          episode_name: null,
          spotify_episode_uri: null,
        },
      ]),
      'Streaming_History_Audio_2026.json',
      accumulator,
    )

    expect(accumulator.fileCount).toBe(1)
    expect(accumulator.totalRecords).toBe(1)
    expect(accumulator.validRecords).toBe(1)
    expect(accumulator.records.size).toBe(1)
    expect(accumulator.qualifyingStreams).toBe(1)
    expect(accumulator.totalMsPlayed).toBe(45_500)
    expect(accumulator.firstPlayedAt).toBe('2026-08-20T12:34:56.000Z')
    expect(accumulator.lastPlayedAt).toBe('2026-08-20T12:34:56.000Z')

    const normalized = [...accumulator.records.values()][0]
    expect(normalized).toMatchObject({
      playedAt: '2026-08-20T12:34:56.000Z',
      trackUri: 'spotify:track:purple',
      trackName: 'Purple Sky',
      artistName: 'Night Drive',
      albumName: 'Violet Hours',
      msPlayed: 45_500,
      skipped: false,
    })
    expect(Object.keys(normalized)).toEqual([
      'playedAt',
      'trackUri',
      'trackName',
      'artistName',
      'albumName',
      'msPlayed',
      'skipped',
      'dedupeKey',
      'overlapKey',
    ])
    expect(JSON.stringify(normalized)).not.toContain('203.0.113.10')
    expect(JSON.stringify(normalized)).not.toContain('sensitive-platform')
    expect(JSON.stringify(normalized)).not.toContain('sensitive-device')
  })

  it('normalizes legacy history and treats timezone-free endTime as UTC', async () => {
    const accumulator = createHistoryAccumulator()

    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          endTime: '2021-03-26 08:05',
          artistName: 'Legacy Artist',
          trackName: 'Legacy Track',
          msPlayed: 29_999,
        },
      ]),
      'StreamingHistory0.json',
      accumulator,
    )

    expect([...accumulator.records.values()][0]).toMatchObject({
      playedAt: '2021-03-26T08:05:00.000Z',
      trackUri: null,
      trackName: 'Legacy Track',
      artistName: 'Legacy Artist',
      albumName: null,
      msPlayed: 29_999,
      skipped: null,
    })
    expect(accumulator.qualifyingStreams).toBe(0)
    expect(accumulator.totalMsPlayed).toBe(29_999)
  })

  it('deduplicates null-URI rows across files without double-counting totals', async () => {
    const accumulator = createHistoryAccumulator()
    const row = {
      endTime: '2021-03-26 08:05',
      artistName: 'Legacy Artist',
      trackName: 'Legacy Track',
      msPlayed: 30_000,
    }

    await parseSpotifyHistoryJsonStream(
      jsonStream([row]),
      'StreamingHistory0.json',
      accumulator,
    )
    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          ...row,
          artistName: '  legacy   artist ',
          trackName: 'LEGACY TRACK',
        },
      ]),
      'StreamingHistory1.json',
      accumulator,
    )

    expect(accumulator.fileCount).toBe(2)
    expect(accumulator.totalRecords).toBe(2)
    expect(accumulator.validRecords).toBe(2)
    expect(accumulator.records.size).toBe(1)
    expect(accumulator.duplicateWithinUploadRecords).toBe(1)
    expect(accumulator.qualifyingStreams).toBe(1)
    expect(accumulator.totalMsPlayed).toBe(30_000)
  })

  it('ignores episode rows and reports invalid music rows without raw values', async () => {
    const accumulator = createHistoryAccumulator()

    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          ts: '2026-08-20T12:00:00Z',
          ms_played: 90_000,
          episode_name: 'Private podcast title',
          episode_show_name: 'Private show',
          spotify_episode_uri: 'spotify:episode:private',
          ip_addr_decrypted: '198.51.100.8',
        },
        {
          ts: 'not-a-date-containing-192.0.2.1',
          ms_played: 10,
          master_metadata_track_name: 'Track',
          master_metadata_album_artist_name: 'Artist',
          platform: 'private-device-name',
        },
        {
          ts: '2026-02-30T12:00:00Z',
          ms_played: 10,
          master_metadata_track_name: 'Track',
          master_metadata_album_artist_name: 'Artist',
        },
        {
          ts: '2026-08-20T12:00:00Z',
          ms_played: -1,
          master_metadata_track_name: 'Track',
          master_metadata_album_artist_name: 'Artist',
        },
        {
          ts: '2026-08-20T12:00:00Z',
          ms_played: 1.5,
          master_metadata_track_name: 'Track',
          master_metadata_album_artist_name: 'Artist',
        },
        {
          ts: '2026-08-20T12:00:00Z',
          ms_played: 10,
          master_metadata_track_name: ' ',
          master_metadata_album_artist_name: 'Artist',
        },
        {
          ts: '2026-08-20T12:00:00Z',
          ms_played: 10,
          master_metadata_track_name: 'Track',
          master_metadata_album_artist_name: '',
        },
      ]),
      'history.json',
      accumulator,
    )

    expect(accumulator.totalRecords).toBe(7)
    expect(accumulator.ignoredRecords).toBe(1)
    expect(accumulator.invalidRecords).toBe(6)
    expect(accumulator.validRecords).toBe(0)
    expect(accumulator.issues.map((issue) => issue.rowNumber)).toEqual([
      2, 3, 4, 5, 6, 7,
    ])
    expect(accumulator.issues.map((issue) => issue.reason)).toEqual([
      'Missing or invalid playback timestamp.',
      'Missing or invalid playback timestamp.',
      'Missing or invalid playback duration.',
      'Missing or invalid playback duration.',
      'Missing track title.',
      'Missing artist name.',
    ])
    expect(JSON.stringify(accumulator.issues)).not.toContain('192.0.2.1')
    expect(JSON.stringify(accumulator.issues)).not.toContain(
      'private-device-name',
    )
    expect(JSON.stringify(accumulator.issues)).not.toContain(
      'Private podcast title',
    )
  })

  it('caps recorded issues while continuing to count every invalid row', async () => {
    const accumulator = createHistoryAccumulator()
    await parseSpotifyHistoryJsonStream(
      jsonStream(Array.from({ length: 25 }, () => null)),
      'invalid.json',
      accumulator,
    )

    expect(accumulator.invalidRecords).toBe(25)
    expect(accumulator.issues).toHaveLength(20)
    expect(accumulator.issues.at(-1)?.rowNumber).toBe(20)
  })

  it('builds stable keys using URI identity when one is available', () => {
    const base = {
      playedAt: '2026-08-20T12:34:56.000Z',
      trackUri: 'spotify:track:same',
      trackName: 'Old title',
      artistName: 'Old artist',
      msPlayed: 45_500,
    }
    const first = spotifyHistoryDedupeKey(base)
    const second = spotifyHistoryDedupeKey({
      ...base,
      trackName: 'Renamed title',
      artistName: 'Renamed artist',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('collapses one unambiguous URI and metadata-only overlap', async () => {
    const accumulator = createHistoryAccumulator()
    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          ts: '2026-08-20T12:34:50Z',
          ms_played: 45_500,
          master_metadata_track_name: 'Purple Sky',
          master_metadata_album_artist_name: 'Night Drive',
          spotify_track_uri: 'spotify:track:purple',
        },
        {
          endTime: '2026-08-20 12:34:02',
          msPlayed: 45_500,
          trackName: ' purple   sky ',
          artistName: 'NIGHT DRIVE',
        },
      ]),
      'mixed-history.json',
      accumulator,
    )

    const before = [...accumulator.records.values()]
    expect(before[0].overlapKey).toBe(before[1].overlapKey)
    expect(accumulator.totalMsPlayed).toBe(91_000)
    expect(accumulator.qualifyingStreams).toBe(2)
    expect(accumulator.firstPlayedAt).toBe('2026-08-20T12:34:02.000Z')

    expect(finalizeHistoryAccumulator(accumulator)).toBe(1)

    expect(accumulator.records.size).toBe(1)
    expect([...accumulator.records.values()][0].trackUri).toBe(
      'spotify:track:purple',
    )
    expect(accumulator.validRecords).toBe(2)
    expect(accumulator.duplicateWithinUploadRecords).toBe(1)
    expect(accumulator.totalMsPlayed).toBe(45_500)
    expect(accumulator.qualifyingStreams).toBe(1)
    expect(accumulator.firstPlayedAt).toBe('2026-08-20T12:34:50.000Z')
    expect(accumulator.lastPlayedAt).toBe('2026-08-20T12:34:50.000Z')
    expect(finalizeHistoryAccumulator(accumulator)).toBe(0)
    expect(accumulator.duplicateWithinUploadRecords).toBe(1)
  })

  it('matches legacy and URI rows one for one without collapsing distinct URI plays', async () => {
    const accumulator = createHistoryAccumulator()
    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          ts: '2026-08-20T12:34:01Z',
          ms_played: 45_500,
          master_metadata_track_name: 'Purple Sky',
          master_metadata_album_artist_name: 'Night Drive',
          spotify_track_uri: 'spotify:track:purple',
        },
        {
          ts: '2026-08-20T12:34:20Z',
          ms_played: 45_500,
          master_metadata_track_name: 'Purple Sky',
          master_metadata_album_artist_name: 'Night Drive',
          spotify_track_uri: 'spotify:track:purple',
        },
        {
          endTime: '2026-08-20 12:34:40',
          msPlayed: 45_500,
          trackName: 'Purple Sky',
          artistName: 'Night Drive',
        },
      ]),
      'ambiguous-history.json',
      accumulator,
    )

    expect(finalizeHistoryAccumulator(accumulator)).toBe(1)
    expect(accumulator.records.size).toBe(2)
    expect(
      [...accumulator.records.values()].filter((record) => record.trackUri),
    ).toHaveLength(2)
    expect(accumulator.duplicateWithinUploadRecords).toBe(1)
    expect(accumulator.totalMsPlayed).toBe(91_000)
  })

  it('uses a normalized UTC-minute key for cross-format overlap checks', () => {
    const first = spotifyHistoryOverlapKey({
      playedAt: '2026-08-20T13:34:01+01:00',
      trackName: ' Purple  Sky ',
      artistName: 'NIGHT DRIVE',
      msPlayed: 45_500,
    })
    const second = spotifyHistoryOverlapKey({
      playedAt: '2026-08-20T12:34:59.999Z',
      trackName: 'purple sky',
      artistName: 'night drive',
      msPlayed: 45_500,
    })

    expect(first).toBe(second)
  })

  it('enforces a global streaming row cap before another record is retained', async () => {
    const accumulator = createHistoryAccumulator()
    const row = {
      endTime: '2021-03-26 08:05',
      artistName: 'Legacy Artist',
      trackName: 'Legacy Track',
      msPlayed: 30_000,
    }

    await parseSpotifyHistoryJsonStream(
      jsonStream([row]),
      'first.json',
      accumulator,
      { maxRecords: 1 },
    )
    await expect(
      parseSpotifyHistoryJsonStream(
        jsonStream([{ ...row, endTime: '2021-03-26 08:06' }]),
        'second.json',
        accumulator,
        { maxRecords: 1 },
      ),
    ).rejects.toMatchObject({
      name: 'HistoryRecordLimitError',
      maxRecords: 1,
    } satisfies Partial<HistoryRecordLimitError>)

    expect(accumulator.totalRecords).toBe(1)
    expect(accumulator.records.size).toBe(1)
    expect(accumulator.fileCount).toBe(2)
  })

  it('rejects playback durations above the documented 24-hour ceiling', async () => {
    const accumulator = createHistoryAccumulator()
    await parseSpotifyHistoryJsonStream(
      jsonStream([
        {
          endTime: '2021-03-26 08:05',
          artistName: 'Legacy Artist',
          trackName: 'Longest accepted track',
          msPlayed: MAX_SPOTIFY_MUSIC_MS_PLAYED,
        },
        {
          endTime: '2021-03-26 08:06',
          artistName: 'Legacy Artist',
          trackName: 'Implausibly long track',
          msPlayed: MAX_SPOTIFY_MUSIC_MS_PLAYED + 1,
          platform: 'private-device-name',
        },
      ]),
      'duration-history.json',
      accumulator,
    )

    expect(accumulator.validRecords).toBe(1)
    expect(accumulator.invalidRecords).toBe(1)
    expect(accumulator.records.size).toBe(1)
    expect(accumulator.totalMsPlayed).toBe(MAX_SPOTIFY_MUSIC_MS_PLAYED)
    expect(accumulator.issues[0]).toEqual({
      fileName: 'duration-history.json',
      rowNumber: 2,
      reason: 'Missing or invalid playback duration.',
    })
    expect(JSON.stringify(accumulator.issues)).not.toContain(
      'private-device-name',
    )
  })

  it('rejects documents that are not top-level JSON arrays', async () => {
    const accumulator = createHistoryAccumulator()

    await expect(
      parseSpotifyHistoryJsonStream(
        jsonStream({ items: [] }),
        'object.json',
        accumulator,
      ),
    ).rejects.toThrow()
  })
})
