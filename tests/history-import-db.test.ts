import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SpotifyTrack } from '../server/types.ts'
import type {
  NormalizedSpotifyHistoryRecord,
} from '../server/lib/spotify-history.ts'

let database: typeof import('../server/db.ts')
let historyImport: typeof import('../server/history-import.ts')
let dedupeKey: typeof import('../server/lib/spotify-history.ts').spotifyHistoryDedupeKey
let overlapKey: typeof import('../server/lib/spotify-history.ts').spotifyHistoryOverlapKey

const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const earlier = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
const oldest = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()

const observedTrack: SpotifyTrack = {
  id: 'observed-track',
  uri: 'spotify:track:observed-track',
  name: 'Observed Track',
  duration_ms: 180_000,
  artists: [
    {
      id: 'observed-artist',
      uri: 'spotify:artist:observed-artist',
      name: 'Observed Artist',
    },
  ],
  album: {
    id: 'observed-album',
    uri: 'spotify:album:observed-album',
    name: 'Observed Album',
    images: [],
  },
}

function record(
  playedAt: string,
  trackName: string,
  msPlayed: number,
  trackUri: string | null,
): NormalizedSpotifyHistoryRecord {
  const values = {
    playedAt,
    trackUri,
    trackName,
    artistName: 'Archive Artist',
    msPlayed,
  }
  return {
    ...values,
    albumName: 'Archive Album',
    skipped: msPlayed < 30_000,
    dedupeKey: dedupeKey(values),
    overlapKey: overlapKey(values),
  }
}

function parsed(
  sourceName: string,
  sourceHash: string,
  records: NormalizedSpotifyHistoryRecord[],
  duplicateWithinUploadRecords = 0,
): import('../server/history-import.ts').ParsedHistoryUpload {
  const played = records.map((item) => item.playedAt).sort()
  return {
    sourceName,
    sourceHash,
    format: sourceName.endsWith('.zip') ? 'zip' : 'json',
    fileCount: 1,
    totalRecords: records.length + duplicateWithinUploadRecords,
    validRecords: records.length + duplicateWithinUploadRecords,
    duplicateWithinUploadRecords,
    invalidRecords: 0,
    ignoredRecords: 0,
    firstPlayedAt: played[0] ?? null,
    lastPlayedAt: played.at(-1) ?? null,
    issues: [],
    records,
  }
}

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')
  historyImport = await import('../server/history-import.ts')
  dedupeKey = (await import('../server/lib/spotify-history.ts'))
    .spotifyHistoryDedupeKey
  overlapKey = (await import('../server/lib/spotify-history.ts'))
    .spotifyHistoryOverlapKey
  database.insertPlaybackEvent(observedTrack, recent)
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('Spotify history import persistence', () => {
  const firstHash = 'a'.repeat(64)
  const secondHash = 'b'.repeat(64)
  let firstBatchId = 0
  let secondBatchId = 0
  let firstRecords: NormalizedSpotifyHistoryRecord[] = []

  it('previews and atomically imports a reversible batch', () => {
    firstRecords = [
      record(earlier, 'Qualified Archive Track', 60_000, 'spotify:track:archive-one'),
      record(oldest, 'Legacy Archive Track', 10_000, null),
    ]
    const source = parsed('my-history.zip', firstHash, firstRecords, 1)
    const preview = historyImport.previewHistoryImport(source)

    expect(preview).toMatchObject({
      validRecords: 3,
      importableRecords: 2,
      duplicateWithinUploadRecords: 1,
      duplicateExistingRecords: 0,
      duplicateRecords: 1,
      qualifyingStreams: 1,
      totalMsPlayed: 70_000,
      alreadyImported: false,
    })

    const batch = historyImport.importHistoryUpload(source, firstHash, 2)
    firstBatchId = batch.id
    expect(batch).toMatchObject({
      sourceName: 'my-history.zip',
      eventCount: 2,
      streamCount: 1,
      totalMsPlayed: 70_000,
      duplicateCount: 1,
    })
    expect(database.getHistoryImportBatches()).toHaveLength(1)

    const repeatedPreview = historyImport.previewHistoryImport(source)
    expect(repeatedPreview).toMatchObject({
      importableRecords: 0,
      duplicateExistingRecords: 2,
      duplicateRecords: 3,
      alreadyImported: true,
    })
    expect(() =>
      historyImport.importHistoryUpload(source, firstHash, 2),
    ).toThrow(/already been imported/i)
  })

  it('keeps observed, verified, and combined metrics explicitly separate', () => {
    const dashboard = database.getDashboard('all') as {
      metrics: {
        events: number
        verifiedStreams: number
        verifiedTimeMs: number
        combinedActiveDays: number
      }
      coverage: {
        observed: { activeDays: number }
        verified: { activeDays: number }
        combined: { activeDays: number }
      }
    }
    expect(dashboard.metrics).toMatchObject({
      events: 1,
      verifiedStreams: 1,
      verifiedTimeMs: 70_000,
      combinedActiveDays: 2,
    })
    expect(dashboard.coverage).toMatchObject({
      observed: { activeDays: 1 },
      verified: { activeDays: 1 },
      combined: { activeDays: 2 },
    })
    expect(
      (database.getDashboard('7d') as {
        metrics: { verifiedStreams: number; verifiedTimeMs: number }
      }).metrics,
    ).toMatchObject({ verifiedStreams: 1, verifiedTimeMs: 60_000 })

    const records = database.getRecordsAndMilestones() as {
      summary: { totalEvents: number }
      combinedCoverage: { activeDays: number; includesImportedHistory: boolean }
      verifiedListening: {
        streamCount: number
        totalMsPlayed: number
      }
    }
    expect(records.summary.totalEvents).toBe(1)
    expect(records.combinedCoverage).toMatchObject({
      activeDays: 2,
      includesImportedHistory: true,
    })
    expect(records.verifiedListening).toMatchObject({
      streamCount: 1,
      totalMsPlayed: 70_000,
    })
  })

  it('deduplicates null-URI overlaps across batches', () => {
    const overlap = { ...firstRecords[1] }
    const uniqueShort = record(recent, 'Short New Track', 29_999, null)
    const source = parsed('incremental.json', secondHash, [overlap, uniqueShort])
    const preview = historyImport.previewHistoryImport(source)
    expect(preview).toMatchObject({
      importableRecords: 1,
      duplicateExistingRecords: 1,
      qualifyingStreams: 0,
      totalMsPlayed: 29_999,
    })

    const batch = historyImport.importHistoryUpload(source, secondHash, 1)
    secondBatchId = batch.id
    expect(batch).toMatchObject({ eventCount: 1, streamCount: 0 })
    expect(database.getHistoryImportBatches()).toHaveLength(2)
  })

  it('undoes only the selected batch and relocks verified time without a qualifying stream', () => {
    const removed = database.undoHistoryImport(firstBatchId)
    expect(removed?.eventCount).toBe(2)
    expect(database.getHistoryImportBatches()).toEqual([
      expect.objectContaining({ id: secondBatchId, eventCount: 1 }),
    ])

    const records = database.getRecordsAndMilestones() as {
      verifiedListening: unknown
    }
    expect(records.verifiedListening).toBeNull()

    const dashboard = database.getDashboard('all') as {
      metrics: { events: number; verifiedStreams: number; verifiedTimeMs: null }
    }
    expect(dashboard.metrics).toMatchObject({
      events: 1,
      verifiedStreams: 0,
      verifiedTimeMs: null,
    })
  })

  it('allows an undone source to be imported again', () => {
    expect(database.undoHistoryImport(secondBatchId)?.eventCount).toBe(1)
    const source = parsed('my-history.zip', firstHash, firstRecords, 1)
    const preview = historyImport.previewHistoryImport(source)
    expect(preview.importableRecords).toBe(2)
    expect(preview.alreadyImported).toBe(false)

    const batch = historyImport.importHistoryUpload(source, firstHash, 2)
    expect(batch.eventCount).toBe(2)
    expect(database.undoHistoryImport(batch.id)?.eventCount).toBe(2)
    expect(database.getHistoryImportBatches()).toHaveLength(0)
  })

  it('deduplicates legacy and Extended History overlaps one for one', () => {
    const legacy = record(
      '2021-03-26T08:05:00.000Z',
      'Cross-format Track',
      45_000,
      null,
    )
    const legacySource = parsed('StreamingHistory0.json', 'd'.repeat(64), [legacy])
    const legacyBatch = historyImport.importHistoryUpload(
      legacySource,
      'd'.repeat(64),
      1,
    )
    const extended = [
      record(
        '2021-03-26T08:05:12.000Z',
        'Cross-format Track',
        45_000,
        'spotify:track:cross-format',
      ),
      record(
        '2021-03-26T08:05:42.000Z',
        'Cross-format Track',
        45_000,
        'spotify:track:cross-format',
      ),
    ]
    const extendedSource = parsed(
      'Streaming_History_Audio_2021.json',
      'e'.repeat(64),
      extended,
    )

    expect(historyImport.previewHistoryImport(extendedSource)).toMatchObject({
      importableRecords: 1,
      duplicateExistingRecords: 1,
    })
    const extendedBatch = historyImport.importHistoryUpload(
      extendedSource,
      'e'.repeat(64),
      1,
    )
    expect(extendedBatch).toMatchObject({ eventCount: 1, duplicateCount: 1 })

    expect(database.undoHistoryImport(extendedBatch.id)?.eventCount).toBe(1)
    expect(database.undoHistoryImport(legacyBatch.id)?.eventCount).toBe(1)
    expect(database.getHistoryImportBatches()).toHaveLength(0)
  })

  it('rejects an impossible duration without leaving a committed batch', () => {
    const invalidRecord = record(
      recent,
      'Impossible Duration',
      Number.MAX_SAFE_INTEGER,
      'spotify:track:impossible-duration',
    )
    const invalidSource = parsed(
      'invalid-duration.json',
      'f'.repeat(64),
      [invalidRecord],
    )

    expect(() =>
      historyImport.importHistoryUpload(invalidSource, 'f'.repeat(64), 1),
    ).toThrow(/invalid playback duration/i)
    expect(database.getHistoryImportBatches()).toHaveLength(0)
  })

  it('does not let one stored row consume an exact and cross-format match', () => {
    const existing = record(
      '2021-03-26T08:05:12.000Z',
      'Cardinality Track',
      45_000,
      'spotify:track:cardinality',
    )
    const existingSource = parsed(
      'existing-uri.json',
      '1'.repeat(64),
      [existing],
    )
    const existingBatch = historyImport.importHistoryUpload(
      existingSource,
      '1'.repeat(64),
      1,
    )
    const distinctMetadataRecord = record(
      '2021-03-26T08:05:42.000Z',
      'Cardinality Track',
      45_000,
      null,
    )
    const mixedSource = parsed(
      'mixed-cardinality.json',
      '2'.repeat(64),
      [existing, distinctMetadataRecord],
    )

    expect(historyImport.previewHistoryImport(mixedSource)).toMatchObject({
      importableRecords: 1,
      duplicateExistingRecords: 1,
    })
    const mixedBatch = historyImport.importHistoryUpload(
      mixedSource,
      '2'.repeat(64),
      1,
    )
    expect(mixedBatch.eventCount).toBe(1)

    expect(database.undoHistoryImport(mixedBatch.id)?.eventCount).toBe(1)
    expect(database.undoHistoryImport(existingBatch.id)?.eventCount).toBe(1)
    expect(database.getHistoryImportBatches()).toHaveLength(0)
  })

  it('uses the cautious date union for discovery eligibility without combining events', () => {
    const coverageRecords = Array.from({ length: 14 }, (_, index) =>
      record(
        new Date(
          Date.now() - (index + 2) * 24 * 60 * 60 * 1000,
        ).toISOString(),
        `Coverage Track ${index + 1}`,
        30_000,
        `spotify:track:coverage-${index + 1}`,
      ),
    )
    const coverageHash = 'c'.repeat(64)
    const source = parsed('coverage.json', coverageHash, coverageRecords)
    const batch = historyImport.importHistoryUpload(source, coverageHash, 14)

    expect(database.getArtistDiveOptions().coverage).toMatchObject({
      requiredActiveDays: 14,
      ready: true,
    })
    expect(
      (database.getDashboard('all') as { metrics: { events: number } }).metrics
        .events,
    ).toBe(1)

    expect(database.undoHistoryImport(batch.id)?.eventCount).toBe(14)
  })
})
