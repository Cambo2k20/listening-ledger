import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request } from 'express'
import { openPromise } from 'yauzl'
import {
  commitHistoryImport,
  filterImportableHistoryRecords,
  getVerifiedHistoryIdentityIndex,
  hasHistoryImportSource,
  type HistoryImportBatchSummary,
  type HistoryImportFormat,
} from './db.ts'
import {
  createHistoryAccumulator,
  finalizeHistoryAccumulator,
  HistoryRecordLimitError,
  parseSpotifyHistoryJsonStream,
  type HistoryParseAccumulator,
  type HistoryParseIssue,
  type NormalizedSpotifyHistoryRecord,
} from './lib/spotify-history.ts'

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024
const MAX_ZIP_ENTRIES = 500
const MAX_JSON_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_JSON_BYTES = 1024 * 1024 * 1024
const MAX_HISTORY_RECORDS = 1_000_000
const MAX_PREVIEW_ISSUES = 20

export class HistoryImportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export interface ReceivedHistoryUpload {
  sourceName: string
  filePath: string
  temporaryDirectory: string
  size: number
}

export interface ParsedHistoryUpload {
  sourceName: string
  sourceHash: string
  format: HistoryImportFormat
  fileCount: number
  totalRecords: number
  validRecords: number
  duplicateWithinUploadRecords: number
  invalidRecords: number
  ignoredRecords: number
  firstPlayedAt: string | null
  lastPlayedAt: string | null
  issues: HistoryParseIssue[]
  records: NormalizedSpotifyHistoryRecord[]
}

export interface HistoryImportPreview {
  sourceName: string
  sourceHash: string
  format: HistoryImportFormat
  fileCount: number
  totalRecords: number
  validRecords: number
  importableRecords: number
  duplicateRecords: number
  duplicateWithinUploadRecords: number
  duplicateExistingRecords: number
  invalidRecords: number
  ignoredRecords: number
  qualifyingStreams: number
  totalMsPlayed: number
  firstPlayedAt: string | null
  lastPlayedAt: string | null
  alreadyImported: boolean
  issues: HistoryParseIssue[]
}

export async function receiveHistoryUpload(
  request: Request,
): Promise<ReceivedHistoryUpload> {
  const declaredLength = Number(request.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    throw new HistoryImportError(
      'The selected archive is larger than the 256 MB upload limit.',
      413,
    )
  }

  const sourceName = decodeSourceName(request.headers['x-history-file-name'])
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'listening-ledger-history-'),
  )
  const filePath = join(temporaryDirectory, 'upload.bin')
  let size = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > MAX_UPLOAD_BYTES) {
        callback(
          new HistoryImportError(
            'The selected archive is larger than the 256 MB upload limit.',
            413,
          ),
        )
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(request, limit, createWriteStream(filePath, { flags: 'wx' }))
    if (size === 0) {
      throw new HistoryImportError('The selected history file is empty.', 400)
    }
    return { sourceName, filePath, temporaryDirectory, size }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function cleanupHistoryUpload(
  upload: ReceivedHistoryUpload,
): Promise<void> {
  await rm(upload.temporaryDirectory, { recursive: true, force: true })
}

export async function parseHistoryUpload(
  upload: ReceivedHistoryUpload,
): Promise<ParsedHistoryUpload> {
  const format = await detectFormat(upload.filePath, upload.sourceName)
  const accumulator = createHistoryAccumulator()

  if (format === 'zip') {
    await parseZip(upload.filePath, accumulator)
  } else {
    try {
      await parseSpotifyHistoryJsonStream(
        createReadStream(upload.filePath),
        upload.sourceName,
        accumulator,
        { maxRecords: MAX_HISTORY_RECORDS },
      )
    } catch (error) {
      if (error instanceof HistoryRecordLimitError) {
        throw historyRecordLimitError()
      }
      throw new HistoryImportError(
        'This JSON file is not a valid Spotify listening-history array.',
        400,
      )
    }
  }

  if (format === 'zip' && accumulator.fileCount === 0) {
    throw new HistoryImportError(
      'No Spotify listening-history JSON files were found in this ZIP.',
      400,
    )
  }
  if (
    format === 'json' &&
    accumulator.historyShapedRecords === 0 &&
    !looksLikeHistoryFile(upload.sourceName)
  ) {
    throw new HistoryImportError(
      'This JSON file does not contain recognizable Spotify listening history.',
      400,
    )
  }

  finalizeHistoryAccumulator(accumulator)
  const records = [...accumulator.records.values()]
  const sourceHash = createHash('sha256')
    .update('listening-ledger-history-v1\n')
    .update(records.map((record) => record.dedupeKey).sort().join('\n'))
    .digest('hex')

  return {
    sourceName: upload.sourceName,
    sourceHash,
    format,
    fileCount: accumulator.fileCount,
    totalRecords: accumulator.totalRecords,
    validRecords: accumulator.validRecords,
    duplicateWithinUploadRecords: accumulator.duplicateWithinUploadRecords,
    invalidRecords: accumulator.invalidRecords,
    ignoredRecords: accumulator.ignoredRecords,
    firstPlayedAt: accumulator.firstPlayedAt,
    lastPlayedAt: accumulator.lastPlayedAt,
    issues: accumulator.issues,
    records,
  }
}

export function previewHistoryImport(
  parsed: ParsedHistoryUpload,
): HistoryImportPreview {
  const existingIdentities = getVerifiedHistoryIdentityIndex()
  const importable = filterImportableHistoryRecords(
    parsed.records,
    existingIdentities,
  )
  const duplicateExistingRecords = parsed.records.length - importable.length

  return {
    sourceName: parsed.sourceName,
    sourceHash: parsed.sourceHash,
    format: parsed.format,
    fileCount: parsed.fileCount,
    totalRecords: parsed.totalRecords,
    validRecords: parsed.validRecords,
    importableRecords: importable.length,
    duplicateRecords:
      parsed.duplicateWithinUploadRecords + duplicateExistingRecords,
    duplicateWithinUploadRecords: parsed.duplicateWithinUploadRecords,
    duplicateExistingRecords,
    invalidRecords: parsed.invalidRecords,
    ignoredRecords: parsed.ignoredRecords,
    qualifyingStreams: importable.filter(
      (record) => record.msPlayed >= 30_000,
    ).length,
    totalMsPlayed: importable.reduce(
      (total, record) => total + record.msPlayed,
      0,
    ),
    firstPlayedAt: parsed.firstPlayedAt,
    lastPlayedAt: parsed.lastPlayedAt,
    alreadyImported: hasHistoryImportSource(parsed.sourceHash),
    issues: parsed.issues,
  }
}

export function importHistoryUpload(
  parsed: ParsedHistoryUpload,
  expectedSourceHash: string,
  expectedImportableRecords: number,
): HistoryImportBatchSummary {
  if (!/^[a-f0-9]{64}$/i.test(expectedSourceHash)) {
    throw new HistoryImportError(
      'Preview this archive before importing it.',
      409,
    )
  }
  if (parsed.sourceHash !== expectedSourceHash) {
    throw new HistoryImportError(
      'The selected archive changed after preview. Preview it again.',
      409,
    )
  }
  if (!Number.isInteger(expectedImportableRecords) || expectedImportableRecords < 1) {
    throw new HistoryImportError(
      'The preview has no new playback records to import.',
      409,
    )
  }

  try {
    return commitHistoryImport({
      sourceName: parsed.sourceName,
      sourceHash: parsed.sourceHash,
      format: parsed.format,
      fileCount: parsed.fileCount,
      totalRecords: parsed.totalRecords,
      validRecords: parsed.validRecords,
      duplicateWithinUploadRecords: parsed.duplicateWithinUploadRecords,
      invalidRecords: parsed.invalidRecords,
      ignoredRecords: parsed.ignoredRecords,
      expectedImportableRecords,
      records: parsed.records,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'History import failed.'
    if (
      message.includes('already') ||
      message.includes('changed after preview') ||
      message.includes('no valid')
    ) {
      throw new HistoryImportError(message, 409)
    }
    throw error
  }
}

async function parseZip(
  filePath: string,
  accumulator: HistoryParseAccumulator,
): Promise<void> {
  const zip = await openPromise(filePath, {
    autoClose: false,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  }).catch(() => {
    throw new HistoryImportError('The selected ZIP archive is invalid.', 400)
  })

  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES) {
      throw new HistoryImportError(
        'This ZIP contains more than 500 files and cannot be safely processed.',
        413,
      )
    }

    let totalJsonBytes = 0
    let processedJsonRecords = 0
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName.endsWith('/') || extname(entry.fileName).toLowerCase() !== '.json') {
        continue
      }
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new HistoryImportError(
          `The ZIP entry ${basename(entry.fileName)} is encrypted or unsupported.`,
          400,
        )
      }
      if (entry.uncompressedSize > MAX_JSON_ENTRY_BYTES) {
        throw new HistoryImportError(
          `The ZIP entry ${basename(entry.fileName)} exceeds the 256 MB JSON limit.`,
          413,
        )
      }
      totalJsonBytes += entry.uncompressedSize
      if (totalJsonBytes > MAX_TOTAL_JSON_BYTES) {
        throw new HistoryImportError(
          'The ZIP expands beyond the 1 GB processing limit.',
          413,
        )
      }

      const local = createHistoryAccumulator()
      const entryName = basename(entry.fileName)
      try {
        const stream = await zip.openReadStreamPromise(entry)
        await parseSpotifyHistoryJsonStream(stream, entryName, local, {
          maxRecords: MAX_HISTORY_RECORDS - processedJsonRecords,
        })
      } catch (error) {
        processedJsonRecords += local.totalRecords
        if (error instanceof HistoryRecordLimitError) {
          throw historyRecordLimitError()
        }
        if (looksLikeHistoryFile(entryName)) {
          throw new HistoryImportError(
            `${entryName} is not a valid Spotify listening-history array.`,
            400,
          )
        }
        continue
      }
      processedJsonRecords += local.totalRecords

      const recognized =
        local.validRecords > 0 ||
        local.ignoredRecords > 0 ||
        local.historyShapedRecords > 0 ||
        looksLikeHistoryFile(entryName)
      if (!recognized) continue
      mergeAccumulator(accumulator, local)
    }
  } catch (error) {
    if (error instanceof HistoryImportError) throw error
    throw new HistoryImportError('The selected ZIP archive is invalid.', 400)
  } finally {
    if (zip.isOpen) zip.close()
  }
}

function mergeAccumulator(
  target: HistoryParseAccumulator,
  source: HistoryParseAccumulator,
): void {
  target.fileCount += source.fileCount
  target.totalRecords += source.totalRecords
  target.historyShapedRecords += source.historyShapedRecords
  target.validRecords += source.validRecords
  target.invalidRecords += source.invalidRecords
  target.ignoredRecords += source.ignoredRecords
  target.duplicateWithinUploadRecords += source.duplicateWithinUploadRecords
  for (const issue of source.issues) {
    if (target.issues.length >= MAX_PREVIEW_ISSUES) break
    target.issues.push(issue)
  }

  for (const record of source.records.values()) {
    if (target.records.has(record.dedupeKey)) {
      target.duplicateWithinUploadRecords += 1
      continue
    }
    target.records.set(record.dedupeKey, record)
    target.totalMsPlayed += record.msPlayed
    if (record.msPlayed >= 30_000) target.qualifyingStreams += 1
    if (!target.firstPlayedAt || record.playedAt < target.firstPlayedAt) {
      target.firstPlayedAt = record.playedAt
    }
    if (!target.lastPlayedAt || record.playedAt > target.lastPlayedAt) {
      target.lastPlayedAt = record.playedAt
    }
  }
}

function historyRecordLimitError(): HistoryImportError {
  return new HistoryImportError(
    'This archive contains more than 1,000,000 history records.',
    413,
  )
}

async function detectFormat(
  filePath: string,
  sourceName: string,
): Promise<HistoryImportFormat> {
  const handle = await open(filePath, 'r')
  const signature = Buffer.alloc(4)
  try {
    await handle.read(signature, 0, signature.length, 0)
  } finally {
    await handle.close()
  }

  if (signature[0] === 0x50 && signature[1] === 0x4b) return 'zip'
  if (extname(sourceName).toLowerCase() === '.zip') {
    throw new HistoryImportError('The selected file is not a valid ZIP archive.', 400)
  }
  if (extname(sourceName).toLowerCase() !== '.json') {
    throw new HistoryImportError('Choose a Spotify history ZIP or JSON file.', 400)
  }
  return 'json'
}

function decodeSourceName(value: string | string[] | undefined): string {
  const encoded = Array.isArray(value) ? value[0] : value
  let decoded = 'spotify-history.json'
  if (encoded) {
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      decoded = encoded
    }
  }
  const safe = [...basename(decoded)]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .trim()
    .slice(0, 180)
  return safe || 'spotify-history.json'
}

function looksLikeHistoryFile(fileName: string): boolean {
  return /(stream|history|endsong)/i.test(fileName)
}
