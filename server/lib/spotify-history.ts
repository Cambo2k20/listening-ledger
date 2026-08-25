import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { streamArray } from 'stream-json/streamers/stream-array.js'

const MAX_RECORDED_ISSUES = 20
const QUALIFYING_STREAM_MS = 30_000

/** Reject implausible single music plays longer than 24 hours. */
export const MAX_SPOTIFY_MUSIC_MS_PLAYED = 86_400_000

export interface NormalizedSpotifyHistoryRecord {
  playedAt: string
  trackUri: string | null
  trackName: string
  artistName: string
  albumName: string | null
  msPlayed: number
  skipped: boolean | null
  dedupeKey: string
  overlapKey: string
}

export interface HistoryParseIssue {
  fileName: string
  rowNumber: number
  reason: string
}

export interface HistoryParseAccumulator {
  records: Map<string, NormalizedSpotifyHistoryRecord>
  totalRecords: number
  /** Rows carrying at least one known Spotify history field. */
  historyShapedRecords: number
  /** Includes valid duplicate rows. `records.size` is the unique valid count. */
  validRecords: number
  duplicateWithinUploadRecords: number
  invalidRecords: number
  ignoredRecords: number
  /** Counts unique valid records lasting at least 30 seconds. */
  qualifyingStreams: number
  /** Sums `msPlayed` across unique valid records only. */
  totalMsPlayed: number
  firstPlayedAt: string | null
  lastPlayedAt: string | null
  issues: HistoryParseIssue[]
  fileCount: number
}

interface SpotifyHistoryDedupeFields {
  playedAt: string
  trackUri: string | null
  trackName: string
  artistName: string
  msPlayed: number
}

interface SpotifyHistoryOverlapFields {
  playedAt: string
  trackName: string
  artistName: string
  msPlayed: number
}

export interface HistoryParseOptions {
  /** Maximum total rows allowed in this accumulator across all parsed files. */
  maxRecords?: number
}

export class HistoryRecordLimitError extends Error {
  readonly maxRecords: number

  constructor(maxRecords: number) {
    super(
      `Spotify history exceeds the configured ${maxRecords.toLocaleString('en-GB')} record limit.`,
    )
    this.name = 'HistoryRecordLimitError'
    this.maxRecords = maxRecords
  }
}

type UnknownRecord = Record<string, unknown>

export function createHistoryAccumulator(): HistoryParseAccumulator {
  return {
    records: new Map(),
    totalRecords: 0,
    historyShapedRecords: 0,
    validRecords: 0,
    duplicateWithinUploadRecords: 0,
    invalidRecords: 0,
    ignoredRecords: 0,
    qualifyingStreams: 0,
    totalMsPlayed: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    issues: [],
    fileCount: 0,
  }
}

export function spotifyHistoryDedupeKey(
  fields: SpotifyHistoryDedupeFields,
): string {
  const trackIdentity = fields.trackUri
    ? `uri:${fields.trackUri.trim()}`
    : `metadata:${normalizeIdentity(fields.artistName)}\u001f${normalizeIdentity(fields.trackName)}`

  return createHash('sha256')
    .update(
      JSON.stringify([
        fields.playedAt.trim(),
        trackIdentity,
        fields.msPlayed,
      ]),
    )
    .digest('hex')
}

export function spotifyHistoryOverlapKey(
  fields: SpotifyHistoryOverlapFields,
): string {
  const timestamp = new Date(fields.playedAt)
  if (Number.isNaN(timestamp.getTime())) {
    throw new RangeError('A valid playback timestamp is required.')
  }

  const utcMinute = timestamp.toISOString().slice(0, 16)
  return createHash('sha256')
    .update(
      JSON.stringify([
        utcMinute,
        normalizeIdentity(fields.artistName),
        normalizeIdentity(fields.trackName),
        fields.msPlayed,
      ]),
    )
    .digest('hex')
}

/**
 * Matches legacy metadata-only rows to Extended URI rows one for one, preferring
 * the richer URI records. Call after every JSON file in an upload is parsed.
 */
export function finalizeHistoryAccumulator(
  accumulator: HistoryParseAccumulator,
): number {
  const groups = new Map<
    string,
    {
      uriRecords: NormalizedSpotifyHistoryRecord[]
      metadataOnlyRecords: NormalizedSpotifyHistoryRecord[]
    }
  >()

  for (const record of accumulator.records.values()) {
    const group = groups.get(record.overlapKey) ?? {
      uriRecords: [],
      metadataOnlyRecords: [],
    }
    if (record.trackUri) {
      group.uriRecords.push(record)
    } else {
      group.metadataOnlyRecords.push(record)
    }
    groups.set(record.overlapKey, group)
  }

  let collapsedRecords = 0
  for (const group of groups.values()) {
    const overlapCount = Math.min(
      group.uriRecords.length,
      group.metadataOnlyRecords.length,
    )
    group.metadataOnlyRecords
      .sort(
        (left, right) =>
          left.playedAt.localeCompare(right.playedAt) ||
          left.dedupeKey.localeCompare(right.dedupeKey),
      )
      .slice(0, overlapCount)
      .forEach((record) => {
        if (accumulator.records.delete(record.dedupeKey)) {
          collapsedRecords += 1
        }
      })
  }

  accumulator.duplicateWithinUploadRecords += collapsedRecords
  recomputeUniqueTotals(accumulator)
  return collapsedRecords
}

export async function parseSpotifyHistoryJsonStream(
  readable: Readable,
  fileName: string,
  accumulator: HistoryParseAccumulator,
  options: HistoryParseOptions = {},
): Promise<void> {
  if (
    options.maxRecords !== undefined &&
    (!Number.isSafeInteger(options.maxRecords) || options.maxRecords < 0)
  ) {
    throw new RangeError('maxRecords must be a non-negative safe integer.')
  }

  accumulator.fileCount += 1

  await pipeline(
    readable,
    streamArray.withParserAsStream(),
    async (source) => {
      for await (const chunk of source) {
        const { key, value } = chunk as { key: number; value: unknown }
        if (
          options.maxRecords !== undefined &&
          accumulator.totalRecords >= options.maxRecords
        ) {
          throw new HistoryRecordLimitError(options.maxRecords)
        }
        collectRow(value, fileName, key + 1, accumulator)
      }
    },
  )
}

function collectRow(
  value: unknown,
  fileName: string,
  rowNumber: number,
  accumulator: HistoryParseAccumulator,
): void {
  accumulator.totalRecords += 1

  if (!isUnknownRecord(value)) {
    recordInvalid(accumulator, fileName, rowNumber, 'Record is not an object.')
    return
  }

  if (isEpisodeRecord(value)) {
    accumulator.historyShapedRecords += 1
    accumulator.ignoredRecords += 1
    return
  }

  if (isHistoryShapedRecord(value)) accumulator.historyShapedRecords += 1

  const playedAt = normalizeTimestamp(firstDefined(value.ts, value.endTime))
  if (!playedAt) {
    recordInvalid(
      accumulator,
      fileName,
      rowNumber,
      'Missing or invalid playback timestamp.',
    )
    return
  }

  const msPlayed = firstDefined(value.ms_played, value.msPlayed)
  if (
    !Number.isSafeInteger(msPlayed) ||
    (msPlayed as number) < 0 ||
    (msPlayed as number) > MAX_SPOTIFY_MUSIC_MS_PLAYED
  ) {
    recordInvalid(
      accumulator,
      fileName,
      rowNumber,
      'Missing or invalid playback duration.',
    )
    return
  }

  const trackName = normalizeRequiredString(
    firstDefined(value.master_metadata_track_name, value.trackName),
  )
  if (!trackName) {
    recordInvalid(accumulator, fileName, rowNumber, 'Missing track title.')
    return
  }

  const artistName = normalizeRequiredString(
    firstDefined(value.master_metadata_album_artist_name, value.artistName),
  )
  if (!artistName) {
    recordInvalid(accumulator, fileName, rowNumber, 'Missing artist name.')
    return
  }

  const trackUri = normalizeOptionalString(
    firstDefined(value.spotify_track_uri, value.trackUri),
  )
  const albumName = normalizeOptionalString(
    firstDefined(value.master_metadata_album_album_name, value.albumName),
  )
  const skipped = typeof value.skipped === 'boolean' ? value.skipped : null
  const dedupeKey = spotifyHistoryDedupeKey({
    playedAt,
    trackUri,
    trackName,
    artistName,
    msPlayed: msPlayed as number,
  })
  const overlapKey = spotifyHistoryOverlapKey({
    playedAt,
    trackName,
    artistName,
    msPlayed: msPlayed as number,
  })

  accumulator.validRecords += 1

  if (accumulator.records.has(dedupeKey)) {
    accumulator.duplicateWithinUploadRecords += 1
    return
  }

  const record: NormalizedSpotifyHistoryRecord = {
    playedAt,
    trackUri,
    trackName,
    artistName,
    albumName,
    msPlayed: msPlayed as number,
    skipped,
    dedupeKey,
    overlapKey,
  }

  accumulator.records.set(dedupeKey, record)
  accumulator.totalMsPlayed += record.msPlayed

  if (record.msPlayed >= QUALIFYING_STREAM_MS) {
    accumulator.qualifyingStreams += 1
  }

  if (!accumulator.firstPlayedAt || playedAt < accumulator.firstPlayedAt) {
    accumulator.firstPlayedAt = playedAt
  }
  if (!accumulator.lastPlayedAt || playedAt > accumulator.lastPlayedAt) {
    accumulator.lastPlayedAt = playedAt
  }
}

function recomputeUniqueTotals(accumulator: HistoryParseAccumulator): void {
  accumulator.qualifyingStreams = 0
  accumulator.totalMsPlayed = 0
  accumulator.firstPlayedAt = null
  accumulator.lastPlayedAt = null

  for (const record of accumulator.records.values()) {
    accumulator.totalMsPlayed += record.msPlayed
    if (record.msPlayed >= QUALIFYING_STREAM_MS) {
      accumulator.qualifyingStreams += 1
    }
    if (
      !accumulator.firstPlayedAt ||
      record.playedAt < accumulator.firstPlayedAt
    ) {
      accumulator.firstPlayedAt = record.playedAt
    }
    if (
      !accumulator.lastPlayedAt ||
      record.playedAt > accumulator.lastPlayedAt
    ) {
      accumulator.lastPlayedAt = record.playedAt
    }
  }
}

function recordInvalid(
  accumulator: HistoryParseAccumulator,
  fileName: string,
  rowNumber: number,
  reason: string,
): void {
  accumulator.invalidRecords += 1
  if (accumulator.issues.length < MAX_RECORDED_ISSUES) {
    accumulator.issues.push({ fileName, rowNumber, reason })
  }
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined)
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEpisodeRecord(record: UnknownRecord): boolean {
  return [
    record.episode_name,
    record.episode_show_name,
    record.spotify_episode_uri,
    record.episodeName,
    record.showName,
    record.spotifyEpisodeUri,
  ].some((value) => typeof value === 'string' && value.trim().length > 0)
}

function isHistoryShapedRecord(record: UnknownRecord): boolean {
  return [
    'ts',
    'endTime',
    'ms_played',
    'msPlayed',
    'master_metadata_track_name',
    'master_metadata_album_artist_name',
    'spotify_track_uri',
    'trackName',
    'artistName',
  ].some((key) => key in record)
}

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalString(value: unknown): string | null {
  return normalizeRequiredString(value)
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i,
  )
  if (!match) {
    return null
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const secondText = match[6] ?? '00'
  const fractionText = match[7]
  let timezoneText = match[8] ?? 'Z'
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }

  if (timezoneText !== 'Z' && timezoneText !== 'z') {
    const timezoneDigits = timezoneText.replace(':', '').slice(1)
    const offsetHour = Number(timezoneDigits.slice(0, 2))
    const offsetMinute = Number(timezoneDigits.slice(2, 4))
    if (offsetHour > 23 || offsetMinute > 59) {
      return null
    }
    if (!timezoneText.includes(':')) {
      timezoneText = `${timezoneText.slice(0, 3)}:${timezoneText.slice(3)}`
    }
  }

  const fraction = fractionText ? `.${fractionText.padEnd(3, '0')}` : ''
  const candidate = `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${fraction}${timezoneText.toUpperCase()}`
  const timestamp = new Date(candidate)
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString()
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
