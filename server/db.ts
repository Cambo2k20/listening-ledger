import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type {
  SpotifyTrack,
  StoredToken,
  TrendEvent,
  TrendInsight,
} from './types.ts'
import { buildTrendInsights } from './lib/trends.ts'

const serverDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(serverDir, '..')
const dataDir = join(projectRoot, '.data')
mkdirSync(dataDir, { recursive: true })

const databasePath = process.env.LISTENING_LEDGER_DB ?? join(dataDir, 'listening-ledger.sqlite')
export const db = new DatabaseSync(databasePath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    spotify_url TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    scope TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    image_url TEXT,
    spotify_url TEXT
  );

  CREATE TABLE IF NOT EXISTS artists (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    spotify_url TEXT
  );

  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    album_id TEXT,
    spotify_url TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id)
  );

  CREATE TABLE IF NOT EXISTS track_artists (
    track_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (track_id, artist_id),
    FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS play_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at TEXT NOT NULL,
    track_id TEXT NOT NULL,
    context_uri TEXT,
    source TEXT NOT NULL DEFAULT 'recently-played',
    recorded_at TEXT NOT NULL,
    UNIQUE (played_at, track_id, source),
    FOREIGN KEY (track_id) REFERENCES tracks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_play_events_played_at
    ON play_events(played_at DESC);

  CREATE TABLE IF NOT EXISTS top_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    captured_at TEXT NOT NULL,
    time_range TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    rank INTEGER NOT NULL,
    spotify_url TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_top_snapshots_lookup
    ON top_snapshots(time_range, entity_type, captured_at DESC);

  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'recent',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    imported_events INTEGER NOT NULL DEFAULT 0,
    message TEXT
  );

  CREATE TABLE IF NOT EXISTS sync_locks (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    acquired_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imported_at TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_hash TEXT NOT NULL UNIQUE,
    event_count INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at TEXT NOT NULL,
    track_uri TEXT,
    track_name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    ms_played INTEGER NOT NULL,
    skipped INTEGER,
    batch_id INTEGER NOT NULL,
    UNIQUE (played_at, track_uri, ms_played),
    FOREIGN KEY (batch_id) REFERENCES import_batches(id)
  );
`)

const syncRunColumns = db.prepare('PRAGMA table_info(sync_runs)').all() as Array<{
  name: string
}>
if (!syncRunColumns.some((column) => column.name === 'kind')) {
  db.exec("ALTER TABLE sync_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'recent'")
}

const upsertAlbum = db.prepare(`
  INSERT INTO albums (id, uri, name, image_url, spotify_url)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    image_url = excluded.image_url,
    spotify_url = excluded.spotify_url
`)

const upsertArtist = db.prepare(`
  INSERT INTO artists (id, uri, name, spotify_url)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    spotify_url = excluded.spotify_url
`)

const upsertTrackStatement = db.prepare(`
  INSERT INTO tracks (id, uri, name, duration_ms, album_id, spotify_url)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    duration_ms = excluded.duration_ms,
    album_id = excluded.album_id,
    spotify_url = excluded.spotify_url
`)

const linkTrackArtist = db.prepare(`
  INSERT INTO track_artists (track_id, artist_id, position)
  VALUES (?, ?, ?)
  ON CONFLICT(track_id, artist_id) DO UPDATE SET position = excluded.position
`)

export function upsertTrack(track: SpotifyTrack): void {
  const albumImage = [...(track.album.images ?? [])].sort(
    (a, b) => (a.width ?? 0) - (b.width ?? 0),
  )[0]?.url

  upsertAlbum.run(
    track.album.id,
    track.album.uri,
    track.album.name,
    albumImage ?? null,
    track.album.external_urls?.spotify ?? null,
  )
  upsertTrackStatement.run(
    track.id,
    track.uri,
    track.name,
    track.duration_ms,
    track.album.id,
    track.external_urls?.spotify ?? null,
  )
  track.artists.forEach((artist, index) => {
    upsertArtist.run(
      artist.id,
      artist.uri,
      artist.name,
      artist.external_urls?.spotify ?? null,
    )
    linkTrackArtist.run(track.id, artist.id, index)
  })
}

export function insertPlaybackEvent(
  track: SpotifyTrack,
  playedAt: string,
  contextUri?: string,
): boolean {
  upsertTrack(track)
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO play_events
        (played_at, track_id, context_uri, source, recorded_at)
      VALUES (?, ?, ?, 'recently-played', ?)
    `)
    .run(playedAt, track.id, contextUri ?? null, new Date().toISOString())
  return result.changes > 0
}

export function getStoredToken(): StoredToken | null {
  const row = db.prepare(`
    SELECT access_token, refresh_token, expires_at, scope
    FROM auth_tokens WHERE singleton = 1
  `).get() as
    | {
        access_token: string
        refresh_token: string
        expires_at: number
        scope: string
      }
    | undefined

  if (!row) return null
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    scope: row.scope,
  }
}

export function saveStoredToken(token: StoredToken): void {
  db.prepare(`
    INSERT INTO auth_tokens
      (singleton, access_token, refresh_token, expires_at, scope, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = excluded.updated_at
  `).run(
    token.accessToken,
    token.refreshToken,
    token.expiresAt,
    token.scope,
    new Date().toISOString(),
  )
}

export function clearAuthentication(): void {
  db.exec('DELETE FROM auth_tokens; DELETE FROM account;')
}

export function saveAccount(account: {
  id: string
  display_name?: string
  external_urls?: { spotify?: string }
}): void {
  db.prepare(`
    INSERT INTO account (id, display_name, spotify_url, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      spotify_url = excluded.spotify_url,
      updated_at = excluded.updated_at
  `).run(
    account.id,
    account.display_name ?? null,
    account.external_urls?.spotify ?? null,
    new Date().toISOString(),
  )
}

export function getAccount(): Record<string, unknown> | null {
  return (
    (db.prepare(`
      SELECT id, display_name AS displayName, spotify_url AS spotifyUrl
      FROM account LIMIT 1
    `).get() as Record<string, unknown> | undefined) ?? null
  )
}

export function getLatestPlayedAt(): string | null {
  const row = db
    .prepare('SELECT MAX(played_at) AS latest FROM play_events')
    .get() as { latest: string | null }
  return row.latest
}

export type SyncKind = 'recent' | 'top'

export function acquireSyncLock(
  name: string,
  owner: string,
  ttlMs: number,
  now = Date.now(),
): boolean {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('DELETE FROM sync_locks WHERE name = ? AND expires_at <= ?').run(
      name,
      now,
    )
    const result = db
      .prepare(`
        INSERT OR IGNORE INTO sync_locks (name, owner, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(name, owner, new Date(now).toISOString(), now + ttlMs)
    db.exec('COMMIT')
    return result.changes > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function releaseSyncLock(name: string, owner: string): void {
  db.prepare('DELETE FROM sync_locks WHERE name = ? AND owner = ?').run(
    name,
    owner,
  )
}

export function startSyncRun(kind: SyncKind): number {
  const result = db
    .prepare(`
      INSERT INTO sync_runs (kind, started_at, status)
      VALUES (?, ?, 'running')
    `)
    .run(kind, new Date().toISOString())
  return Number(result.lastInsertRowid)
}

export function finishSyncRun(
  id: number,
  status: 'success' | 'failed',
  importedEvents: number,
  message?: string,
): void {
  db.prepare(`
    UPDATE sync_runs
    SET completed_at = ?, status = ?, imported_events = ?, message = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    status,
    importedEvents,
    message ?? null,
    id,
  )
}

export function saveTopSnapshot(
  capturedAt: string,
  timeRange: string,
  entityType: string,
  items: Array<{
    id: string
    name: string
    external_urls?: { spotify?: string }
  }>,
): void {
  const statement = db.prepare(`
    INSERT INTO top_snapshots
      (captured_at, time_range, entity_type, entity_id, entity_name, rank, spotify_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  items.forEach((item, index) => {
    statement.run(
      capturedAt,
      timeRange,
      entityType,
      item.id,
      item.name,
      index + 1,
      item.external_urls?.spotify ?? null,
    )
  })
}

export function getLatestSuccessfulSyncAt(kind: SyncKind): string | null {
  const row = db
    .prepare(`
      SELECT completed_at AS completedAt
      FROM sync_runs
      WHERE kind = ? AND status = 'success'
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(kind) as { completedAt?: string } | undefined
  return row?.completedAt ?? null
}

function periodStart(period: string): string | null {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
  if (!days) return null
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function periodClause(period: string, alias = 'pe'): { sql: string; params: string[] } {
  const start = periodStart(period)
  return start
    ? { sql: `WHERE ${alias}.played_at >= ?`, params: [start] }
    : { sql: '', params: [] }
}

export function getDashboard(period = '30d'): Record<string, unknown> {
  const filter = periodClause(period)
  const total = db
    .prepare(`SELECT COUNT(*) AS count FROM play_events pe ${filter.sql}`)
    .get(...filter.params) as { count: number }
  const uniqueTracks = db
    .prepare(`SELECT COUNT(DISTINCT pe.track_id) AS count FROM play_events pe ${filter.sql}`)
    .get(...filter.params) as { count: number }
  const activeDays = db
    .prepare(`SELECT COUNT(DISTINCT date(pe.played_at)) AS count FROM play_events pe ${filter.sql}`)
    .get(...filter.params) as { count: number }
  const coverage = db.prepare(`
    SELECT MIN(played_at) AS first, MAX(played_at) AS latest FROM play_events
  `).get() as { first: string | null; latest: string | null }

  const topTracks = db.prepare(`
    SELECT t.id, t.name, t.spotify_url AS spotifyUrl,
      al.name AS albumName, al.image_url AS imageUrl,
      GROUP_CONCAT(DISTINCT ar.name) AS artists,
      COUNT(*) AS events
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN track_artists ta ON ta.track_id = t.id
    LEFT JOIN artists ar ON ar.id = ta.artist_id
    ${filter.sql}
    GROUP BY t.id
    ORDER BY events DESC, MAX(pe.played_at) DESC
    LIMIT 5
  `).all(...filter.params)

  const topArtists = db.prepare(`
    SELECT ar.id, ar.name, ar.spotify_url AS spotifyUrl, COUNT(*) AS events
    FROM play_events pe
    JOIN track_artists ta ON ta.track_id = pe.track_id AND ta.position = 0
    JOIN artists ar ON ar.id = ta.artist_id
    ${filter.sql}
    GROUP BY ar.id
    ORDER BY events DESC, MAX(pe.played_at) DESC
    LIMIT 5
  `).all(...filter.params)

  const daily = db.prepare(`
    SELECT date(played_at) AS day, COUNT(*) AS events
    FROM play_events
    WHERE played_at >= ?
    GROUP BY date(played_at)
    ORDER BY day
  `).all(new Date(Date.now() - 13 * 86_400_000).toISOString())

  return {
    period,
    metrics: {
      events: total.count,
      uniqueTracks: uniqueTracks.count,
      activeDays: activeDays.count,
      verifiedStreams: Number(
        (db.prepare('SELECT COUNT(*) AS count FROM verified_streams WHERE ms_played >= 30000').get() as { count: number }).count,
      ),
    },
    coverage,
    topTracks,
    topArtists,
    daily,
  }
}

export function getHistory(query = '', limit = 100): Record<string, unknown>[] {
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  const search = `%${query.trim()}%`
  return db.prepare(`
    SELECT pe.id, pe.played_at AS playedAt, pe.context_uri AS contextUri,
      t.name AS trackName, t.spotify_url AS spotifyUrl,
      al.name AS albumName, al.image_url AS imageUrl,
      GROUP_CONCAT(ar.name, ', ') AS artists
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN track_artists ta ON ta.track_id = t.id
    LEFT JOIN artists ar ON ar.id = ta.artist_id
    WHERE (? = '%%' OR t.name LIKE ? OR ar.name LIKE ? OR al.name LIKE ?)
    GROUP BY pe.id
    ORDER BY pe.played_at DESC
    LIMIT ?
  `).all(search, search, search, search, safeLimit) as Record<string, unknown>[]
}

export function getRankings(
  type: 'track' | 'artist' | 'album',
  period = '30d',
): Record<string, unknown>[] {
  const filter = periodClause(period)
  if (type === 'artist') {
    return db.prepare(`
      SELECT ar.id, ar.name, ar.spotify_url AS spotifyUrl, COUNT(*) AS events,
        MAX(pe.played_at) AS lastPlayed
      FROM play_events pe
      JOIN track_artists ta ON ta.track_id = pe.track_id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
      ${filter.sql}
      GROUP BY ar.id ORDER BY events DESC, lastPlayed DESC LIMIT 100
    `).all(...filter.params) as Record<string, unknown>[]
  }
  if (type === 'album') {
    return db.prepare(`
      SELECT al.id, al.name, al.spotify_url AS spotifyUrl,
        al.image_url AS imageUrl, COUNT(*) AS events,
        MAX(pe.played_at) AS lastPlayed
      FROM play_events pe
      JOIN tracks t ON t.id = pe.track_id
      JOIN albums al ON al.id = t.album_id
      ${filter.sql}
      GROUP BY al.id ORDER BY events DESC, lastPlayed DESC LIMIT 100
    `).all(...filter.params) as Record<string, unknown>[]
  }
  return db.prepare(`
    SELECT t.id, t.name, t.spotify_url AS spotifyUrl,
      al.name AS albumName, al.image_url AS imageUrl,
      GROUP_CONCAT(DISTINCT ar.name) AS artists,
      COUNT(*) AS events, MAX(pe.played_at) AS lastPlayed
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN track_artists ta ON ta.track_id = t.id
    LEFT JOIN artists ar ON ar.id = ta.artist_id
    ${filter.sql}
    GROUP BY t.id ORDER BY events DESC, lastPlayed DESC LIMIT 100
  `).all(...filter.params) as Record<string, unknown>[]
}

export function getTrends(): {
  state: 'insufficient' | 'ready'
  insights: TrendInsight[]
  heatmap: Array<{ day: number; hour: number; events: number }>
  eventCount: number
} {
  const rows = db.prepare(`
    SELECT pe.played_at AS playedAt, t.id AS trackId,
      t.name AS trackName, ar.name AS artistName
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    JOIN track_artists ta ON ta.track_id = t.id AND ta.position = 0
    JOIN artists ar ON ar.id = ta.artist_id
    ORDER BY pe.played_at DESC
  `).all() as unknown as TrendEvent[]

  const trend = buildTrendInsights(rows)
  const heatmap = db.prepare(`
    SELECT CAST(strftime('%w', played_at) AS INTEGER) AS day,
      CAST(strftime('%H', played_at) AS INTEGER) AS hour,
      COUNT(*) AS events
    FROM play_events
    GROUP BY day, hour
    ORDER BY day, hour
  `).all() as Array<{ day: number; hour: number; events: number }>

  return { ...trend, heatmap, eventCount: rows.length }
}

export function getHealth(): Record<string, unknown> {
  const latest = db.prepare(`
    SELECT kind, started_at AS startedAt, completed_at AS completedAt,
      status, imported_events AS importedEvents, message
    FROM sync_runs ORDER BY id DESC LIMIT 1
  `).get() as Record<string, unknown> | undefined
  const lastSuccess = db.prepare(`
    SELECT completed_at AS completedAt FROM sync_runs
    WHERE kind = 'recent' AND status = 'success' ORDER BY id DESC LIMIT 1
  `).get() as { completedAt?: string } | undefined
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM play_events) AS observed,
      (SELECT COUNT(*) FROM verified_streams WHERE ms_played >= 30000) AS verified,
      (SELECT COUNT(*) FROM sync_runs WHERE status = 'failed') AS failures
  `).get() as { observed: number; verified: number; failures: number }

  const ageHours = lastSuccess?.completedAt
    ? (Date.now() - new Date(lastSuccess.completedAt).getTime()) / 3_600_000
    : null
  const risk = ageHours === null
    ? 'not-started'
    : ageHours > 3
      ? 'elevated'
      : ageHours > 1
        ? 'attention'
        : 'healthy'

  return {
    connected: Boolean(getStoredToken()),
    configured: Boolean(process.env.SPOTIFY_CLIENT_ID),
    latestSync: latest ?? null,
    lastSuccessAt: lastSuccess?.completedAt ?? null,
    risk,
    counts,
    databasePath,
    targetSyncIntervalMinutes: 15,
  }
}

export function getExportData(): Record<string, unknown>[] {
  return db
    .prepare(`
      SELECT
        pe.id,
        pe.played_at AS playedAt,
        pe.context_uri AS contextUri,
        pe.source,
        t.name AS trackName,
        t.uri AS trackUri,
        t.spotify_url AS spotifyUrl,
        al.name AS albumName,
        al.image_url AS imageUrl,
        GROUP_CONCAT(ar.name, ', ') AS artists
      FROM play_events pe
      JOIN tracks t ON t.id = pe.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      LEFT JOIN track_artists ta ON ta.track_id = t.id
      LEFT JOIN artists ar ON ar.id = ta.artist_id
      GROUP BY pe.id
      ORDER BY pe.played_at DESC
    `)
    .all() as Record<string, unknown>[]
}
