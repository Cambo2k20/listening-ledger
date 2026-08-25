import {
  ArchiveRestore,
  FileArchive,
  FileJson,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, apiFile } from '../lib/api'
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatUtcDate,
} from '../lib/format'
import type {
  HistoryImportBatch,
  HistoryImportIssue,
  HistoryImportPreview,
} from '../types'
import { Panel } from './Ui'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The history archive could not be processed.'
}

function formatDateRange(first?: string | null, last?: string | null): string {
  if (!first || !last) return 'No valid dates'
  const firstLabel = formatUtcDate(first)
  const lastLabel = formatUtcDate(last)
  return firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`
}

function formatIssue(issue: HistoryImportIssue): string {
  return `${issue.fileName}, row ${formatNumber(issue.rowNumber)}: ${issue.reason}`
}

export function HistoryImportPanel({
  onImported,
}: {
  onImported?: () => void | Promise<void>
}) {
  const inputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const confirmUndoButton = useRef<HTMLButtonElement>(null)
  const undoTrigger = useRef<HTMLButtonElement>(null)
  const successStatus = useRef<HTMLDivElement>(null)
  const previewRequest = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null)
  const [batches, setBatches] = useState<HistoryImportBatch[]>([])
  const [previewing, setPreviewing] = useState(false)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [batchLoadError, setBatchLoadError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [undoingId, setUndoingId] = useState<number | null>(null)
  const [confirmUndoId, setConfirmUndoId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const loadBatches = useCallback(async () => {
    const result = await api<{ items: HistoryImportBatch[] }>('/api/history-imports')
    setBatches(result.items)
    setBatchLoadError(null)
  }, [])

  useEffect(() => {
    let active = true
    void loadBatches()
      .catch((loadError: unknown) => {
        if (active) setBatchLoadError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoadingBatches(false)
      })
    return () => {
      active = false
      previewRequest.current += 1
    }
  }, [loadBatches])

  useEffect(() => {
    if (confirmUndoId !== null) confirmUndoButton.current?.focus()
  }, [confirmUndoId])

  useEffect(() => {
    if (statusMessage) successStatus.current?.focus()
  }, [statusMessage])

  const clearSelection = () => {
    previewRequest.current += 1
    setFile(null)
    setPreview(null)
    setPreviewing(false)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const selectFile = async (selectedFile: File | null) => {
    const requestId = previewRequest.current + 1
    previewRequest.current = requestId
    setFile(selectedFile)
    setPreview(null)
    setError(null)
    setStatusMessage(null)

    if (!selectedFile) {
      setPreviewing(false)
      return
    }

    const extension = selectedFile.name.toLowerCase().split('.').pop()
    if (extension !== 'zip' && extension !== 'json') {
      setPreviewing(false)
      setError('Choose a Spotify history file ending in .zip or .json.')
      return
    }

    setPreviewing(true)
    try {
      const result = await apiFile<HistoryImportPreview>(
        '/api/history-imports/preview',
        selectedFile,
        { method: 'POST' },
      )
      if (previewRequest.current === requestId) setPreview(result)
    } catch (previewError) {
      if (previewRequest.current === requestId) setError(errorMessage(previewError))
    } finally {
      if (previewRequest.current === requestId) setPreviewing(false)
    }
  }

  const importHistory = async () => {
    if (!file || !preview || preview.importableRecords <= 0) return
    setImporting(true)
    setError(null)
    setStatusMessage(null)

    try {
      const result = await apiFile<{ batch: HistoryImportBatch }>(
        '/api/history-imports',
        file,
        {
          method: 'POST',
          headers: {
            'X-History-Source-Hash': preview.sourceHash,
            'X-History-Expected-Count': String(preview.importableRecords),
          },
        },
      )
      const importedCount = preview.importableRecords
      clearSelection()
      setBatches((current) => [
        result.batch,
        ...current.filter((batch) => batch.id !== result.batch.id),
      ])
      void Promise.resolve(onImported?.()).catch(() => undefined)
      setStatusMessage(
        `${formatNumber(importedCount)} archive event${importedCount === 1 ? '' : 's'} imported as a reversible batch.`,
      )
    } catch (importError) {
      setError(errorMessage(importError))
    } finally {
      setImporting(false)
    }
  }

  const undoImport = async (batch: HistoryImportBatch) => {
    setUndoingId(batch.id)
    setError(null)
    setStatusMessage(null)
    try {
      await api<{ batch: HistoryImportBatch }>(
        `/api/history-imports/${batch.id}`,
        { method: 'DELETE' },
      )
      setBatches((current) => current.filter((item) => item.id !== batch.id))
      void Promise.resolve(onImported?.()).catch(() => undefined)
      setConfirmUndoId(null)
      setStatusMessage(
        `Undid ${batch.sourceName}. Its ${formatNumber(batch.eventCount)} imported event${batch.eventCount === 1 ? '' : 's'} were removed.`,
      )
    } catch (undoError) {
      setError(errorMessage(undoError))
    } finally {
      setUndoingId(null)
    }
  }

  const busy = previewing || importing || undoingId !== null
  const verifiedTimeUnlocked = batches.some((batch) => batch.streamCount > 0)

  const retryLoadBatches = async () => {
    setLoadingBatches(true)
    setBatchLoadError(null)
    try {
      await loadBatches()
    } catch (loadError) {
      setBatchLoadError(errorMessage(loadError))
    } finally {
      setLoadingBatches(false)
    }
  }

  const cancelUndo = () => {
    setConfirmUndoId(null)
    window.requestAnimationFrame(() => undoTrigger.current?.focus())
  }

  return (
    <Panel
      title="Import Spotify history"
      kicker="Verified archive"
      className="history-import-panel"
      action={<ArchiveRestore size={19} aria-hidden="true" />}
    >
      <div className="history-import-content" aria-busy={busy}>
        <div className="history-import-privacy">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Your archive stays local and minimal.</strong>
            <p>
              Listening Ledger parses it on this computer, deletes the temporary upload
              immediately after processing, and never adds the raw ZIP or JSON to its
              database. Sensitive IP address, device, platform, and location fields are
              discarded instead of stored.
            </p>
          </div>
        </div>

        <div className="history-import-picker">
          <label htmlFor={inputId}>Spotify history ZIP or JSON</label>
          <div className="history-import-file-control">
            <Upload size={18} aria-hidden="true" />
            <input
              ref={fileInput}
              id={inputId}
              type="file"
              accept=".zip,.json,application/zip,application/json"
              onChange={(event) => void selectFile(event.currentTarget.files?.[0] ?? null)}
              disabled={importing}
              aria-describedby={`${inputId}-help`}
            />
          </div>
          <small id={`${inputId}-help`}>
            Choose Spotify’s ZIP export or a listening-history JSON file. Selecting it
            creates a preview before anything is added to the ledger.
          </small>
        </div>

        {previewing && (
          <div className="history-import-status" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
            Checking dates, duplicates, and invalid records…
          </div>
        )}

        {error && (
          <div className="history-import-status history-import-status--error" role="alert">
            {error}
          </div>
        )}

        {statusMessage && (
          <div
            ref={successStatus}
            className="history-import-status history-import-status--success"
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            {statusMessage}
          </div>
        )}

        {preview && (
          <section className="history-import-preview" aria-labelledby={`${inputId}-preview`}>
            <div className="history-import-preview-head">
              <div>
                {preview.format === 'zip' ? (
                  <FileArchive size={20} aria-hidden="true" />
                ) : (
                  <FileJson size={20} aria-hidden="true" />
                )}
                <div>
                  <h3 id={`${inputId}-preview`}>{preview.sourceName}</h3>
                  <p>
                    {preview.format.toUpperCase()} · {formatNumber(preview.fileCount)} history
                    file{preview.fileCount === 1 ? '' : 's'} ·{' '}
                    {formatNumber(preview.totalRecords)} total record
                    {preview.totalRecords === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <span>{preview.alreadyImported ? 'Already imported' : 'Ready to review'}</span>
            </div>

            <div className="history-import-preview-grid">
              <article className="history-import-stat history-import-stat--wide">
                <span>Date range</span>
                <strong>{formatDateRange(preview.firstPlayedAt, preview.lastPlayedAt)}</strong>
              </article>
              <article className="history-import-stat">
                <span>Valid events</span>
                <strong>{formatNumber(preview.validRecords)}</strong>
              </article>
              <article className="history-import-stat history-import-stat--accent">
                <span>Ready to import</span>
                <strong>{formatNumber(preview.importableRecords)}</strong>
              </article>
              <article className="history-import-stat">
                <span>Duplicates</span>
                <strong>{formatNumber(preview.duplicateRecords)}</strong>
                <small>
                  {formatNumber(preview.duplicateWithinUploadRecords)} in this file ·{' '}
                  {formatNumber(preview.duplicateExistingRecords)} already stored
                </small>
              </article>
              <article className="history-import-stat">
                <span>Invalid records</span>
                <strong>{formatNumber(preview.invalidRecords)}</strong>
              </article>
              <article className="history-import-stat">
                <span>Ignored records</span>
                <strong>{formatNumber(preview.ignoredRecords)}</strong>
              </article>
              <article className="history-import-stat">
                <span>Verified streams</span>
                <strong>{formatNumber(preview.qualifyingStreams)}</strong>
                <small>Plays lasting at least 30 seconds</small>
              </article>
              <article className="history-import-stat">
                <span>Verified time</span>
                <strong>{formatDuration(preview.totalMsPlayed)}</strong>
                <small>Imported milliseconds only</small>
              </article>
            </div>

            {preview.issues.length > 0 && (
              <div className="history-import-issues">
                <strong>Preview notes</strong>
                <ul>
                  {preview.issues.map((issue, index) => (
                    <li key={`${formatIssue(issue)}-${index}`}>{formatIssue(issue)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="history-import-preview-actions">
              <button className="button button--quiet" type="button" onClick={clearSelection}>
                Clear file
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void importHistory()}
                disabled={
                  importing || preview.importableRecords <= 0 || preview.alreadyImported
                }
              >
                {importing ? (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Upload size={16} aria-hidden="true" />
                )}
                {preview.alreadyImported
                  ? 'Archive already imported'
                  : preview.importableRecords > 0
                    ? `Import ${formatNumber(preview.importableRecords)} events`
                    : 'Nothing new to import'}
              </button>
            </div>
          </section>
        )}

        <section className="history-import-batches" aria-labelledby={`${inputId}-batches`}>
          <div className="history-import-batches-head">
            <div>
              <h3 id={`${inputId}-batches`}>Import batches</h3>
              <p>Each archive import can be removed without touching observed API events.</p>
            </div>
            {!loadingBatches && <span>{formatNumber(batches.length)} saved</span>}
          </div>

          {loadingBatches ? (
            <div className="history-import-status" role="status">
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
              Loading import history…
            </div>
          ) : (
            <>
              {batchLoadError && (
                <div className="history-import-batch-load-error" role="alert">
                  <div>
                    <strong>Full import history could not be loaded</strong>
                    <p>{batchLoadError}</p>
                  </div>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => void retryLoadBatches()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {!batchLoadError && batches.length === 0 && (
                <div className="history-import-empty">
                  <ArchiveRestore size={22} aria-hidden="true" />
                  <div>
                    <strong>No imported history yet</strong>
                    <p>Your first successful archive import will appear here.</p>
                  </div>
                </div>
              )}
              {batches.length > 0 && (
                <div className="history-import-batch-list">
                  {batches.map((batch) => {
                const confirming = confirmUndoId === batch.id
                const undoing = undoingId === batch.id
                return (
                  <article className="history-import-batch" key={batch.id}>
                    <div className="history-import-batch-title">
                      <div>
                        <strong>{batch.sourceName}</strong>
                        <span>Imported {formatDateTime(batch.importedAt)}</span>
                      </div>
                      <small>{formatDateRange(batch.firstPlayedAt, batch.lastPlayedAt)}</small>
                    </div>
                    <dl>
                      <div>
                        <dt>Events</dt>
                        <dd>{formatNumber(batch.eventCount)}</dd>
                      </div>
                      <div>
                        <dt>Verified streams</dt>
                        <dd>{formatNumber(batch.streamCount)}</dd>
                      </div>
                      <div>
                        <dt>Verified time</dt>
                        <dd>
                          {verifiedTimeUnlocked
                            ? formatDuration(batch.totalMsPlayed)
                            : 'Locked'}
                        </dd>
                      </div>
                    </dl>
                    <div className="history-import-batch-actions">
                      {confirming ? (
                        <>
                          <span>
                            Remove {formatNumber(batch.eventCount)} imported record
                            {batch.eventCount === 1 ? '' : 's'} from {batch.sourceName}?
                            Observed Recently Played events stay unchanged.
                          </span>
                          <button
                            ref={confirmUndoButton}
                            className="button button--quiet"
                            type="button"
                            onClick={cancelUndo}
                            disabled={undoing}
                          >
                            Cancel
                          </button>
                          <button
                            className="button button--danger"
                            type="button"
                            onClick={() => void undoImport(batch)}
                            disabled={undoing}
                          >
                            {undoing ? (
                              <LoaderCircle className="spin" size={16} aria-hidden="true" />
                            ) : (
                              <Trash2 size={16} aria-hidden="true" />
                            )}
                            Confirm undo
                          </button>
                        </>
                      ) : (
                        <button
                          className="button button--quiet"
                          type="button"
                          onClick={(event) => {
                            undoTrigger.current = event.currentTarget
                            setConfirmUndoId(batch.id)
                          }}
                          disabled={busy}
                        >
                          <ArchiveRestore size={16} aria-hidden="true" /> Undo import
                        </button>
                      )}
                    </div>
                  </article>
                )
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Panel>
  )
}
