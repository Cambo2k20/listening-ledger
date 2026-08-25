import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import type {
  ArtistCatalogTrack,
  ArtistDiveArtistOption,
  DiscoveryFeedbackStatus,
  DiscoverySeed,
  DiscoverySessionKind,
  DiscoverySessionMode,
  DiscoverySessionRecord,
  RankedDiscoveryCandidate,
  SpotifyTrack,
  StoredToken,
  TrendEvent,
  TrendInsight,
} from './types.ts'
import { buildTrendInsights } from './lib/trends.ts'
import { underexploredArtistScore } from './lib/artist-dive.ts'
import {
  discoveryTrackKey,
  normalizeDiscoveryText,
} from './lib/discovery-ranking.ts'

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

  CREATE TABLE IF NOT EXISTS discovery_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'related_tracks',
    mode TEXT NOT NULL,
    target_count INTEGER NOT NULL,
    seed_json TEXT NOT NULL,
    focus_artist_json TEXT,
    playlist_id TEXT,
    playlist_name TEXT,
    playlist_url TEXT,
    saved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS discovery_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    spotify_track_id TEXT NOT NULL,
    spotify_uri TEXT NOT NULL,
    track_name TEXT NOT NULL,
    artist_id TEXT,
    artist_name TEXT NOT NULL,
    album_id TEXT,
    album_uri TEXT,
    album_name TEXT,
    release_date TEXT,
    image_url TEXT,
    spotify_url TEXT,
    duration_ms INTEGER,
    similarity REAL NOT NULL,
    seed_hits INTEGER NOT NULL,
    seed_keys_json TEXT NOT NULL DEFAULT '[]',
    seed_labels_json TEXT NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL,
    reason TEXT NOT NULL,
    relationship_kind TEXT NOT NULL DEFAULT 'similar',
    is_new_artist INTEGER NOT NULL,
    is_anchor INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL DEFAULT 'neutral',
    UNIQUE (session_id, spotify_track_id),
    FOREIGN KEY (session_id) REFERENCES discovery_sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_discovery_candidates_session
    ON discovery_candidates(session_id, position);

  CREATE TABLE IF NOT EXISTS discovery_feedback (
    canonical_key TEXT PRIMARY KEY,
    spotify_track_id TEXT,
    track_name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_resolution_cache (
    canonical_key TEXT PRIMARY KEY,
    spotify_track_id TEXT NOT NULL,
    spotify_uri TEXT NOT NULL,
    track_name TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    image_url TEXT,
    spotify_url TEXT,
    duration_ms INTEGER,
    resolved_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artist_catalog_cache (
    artist_id TEXT PRIMARY KEY,
    fetched_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
`)

const syncRunColumns = db.prepare('PRAGMA table_info(sync_runs)').all() as Array<{
  name: string
}>
if (!syncRunColumns.some((column) => column.name === 'kind')) {
  db.exec("ALTER TABLE sync_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'recent'")
}

const discoveryCandidateColumns = db
  .prepare('PRAGMA table_info(discovery_candidates)')
  .all() as Array<{ name: string }>
if (!discoveryCandidateColumns.some((column) => column.name === 'seed_keys_json')) {
  db.exec(
    "ALTER TABLE discovery_candidates ADD COLUMN seed_keys_json TEXT NOT NULL DEFAULT '[]'",
  )
}
if (!discoveryCandidateColumns.some((column) => column.name === 'seed_labels_json')) {
  db.exec(
    "ALTER TABLE discovery_candidates ADD COLUMN seed_labels_json TEXT NOT NULL DEFAULT '[]'",
  )
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

const discoverySessionColumns = db
  .prepare('PRAGMA table_info(discovery_sessions)')
  .all() as Array<{ name: string }>
if (!discoverySessionColumns.some((column) => column.name === 'kind')) {
  db.exec(
    "ALTER TABLE discovery_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'related_tracks'",
  )
}
if (!discoverySessionColumns.some((column) => column.name === 'focus_artist_json')) {
  db.exec('ALTER TABLE discovery_sessions ADD COLUMN focus_artist_json TEXT')
}

const discoveryCandidateMigrations = [
  ['artist_id', 'TEXT'],
  ['album_id', 'TEXT'],
  ['album_uri', 'TEXT'],
  ['release_date', 'TEXT'],
  ['relationship_kind', "TEXT NOT NULL DEFAULT 'similar'"],
  ['is_anchor', 'INTEGER NOT NULL DEFAULT 0'],
] as const
for (const [column, definition] of discoveryCandidateMigrations) {
  if (!discoveryCandidateColumns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE discovery_candidates ADD COLUMN ${column} ${definition}`)
  }
}

export type DetailEntityType = 'track' | 'artist' | 'album'

const detailPeriods = ['7d', '30d', '90d', 'all'] as const

function detailEventCondition(
  type: DetailEntityType,
  alias = 'pe',
): string {
  if (type === 'track') return `${alias}.track_id = ?`
  if (type === 'artist') {
    return `EXISTS (
      SELECT 1 FROM track_artists detail_ta
      WHERE detail_ta.track_id = ${alias}.track_id
        AND detail_ta.artist_id = ?
        AND detail_ta.position = 0
    )`
  }
  return `EXISTS (
    SELECT 1 FROM tracks detail_t
    WHERE detail_t.id = ${alias}.track_id AND detail_t.album_id = ?
  )`
}

function detailEventFilter(
  type: DetailEntityType,
  id: string,
  period = 'all',
  alias = 'pe',
): { sql: string; params: string[] } {
  const start = periodStart(period)
  return {
    sql: `WHERE ${detailEventCondition(type, alias)}${start ? ` AND ${alias}.played_at >= ?` : ''}`,
    params: start ? [id, start] : [id],
  }
}

function getDetailEntity(
  type: DetailEntityType,
  id: string,
): Record<string, unknown> | null {
  if (type === 'track') {
    const track = db.prepare(`
      SELECT t.id, t.name, t.uri AS spotifyUri,
        t.spotify_url AS spotifyUrl, t.duration_ms AS durationMs,
        al.id AS albumId, al.name AS albumName, al.uri AS albumUri,
        al.spotify_url AS albumSpotifyUrl, al.image_url AS imageUrl
      FROM tracks t
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE t.id = ?
    `).get(id) as Record<string, unknown> | undefined
    if (!track) return null
    const artists = db.prepare(`
      SELECT 'artist' AS type, ar.id, ar.name, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl, ta.position
      FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = ?
      ORDER BY ta.position, ar.name
    `).all(id)
    return {
      ...track,
      artists,
      album: track.albumId
        ? {
            type: 'album',
            id: track.albumId,
            name: track.albumName,
            spotifyUri: track.albumUri,
            spotifyUrl: track.albumSpotifyUrl,
            imageUrl: track.imageUrl,
          }
        : null,
    }
  }

  if (type === 'artist') {
    const artist = db.prepare(`
      SELECT ar.id, ar.name, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl,
        (
          SELECT al.image_url
          FROM play_events image_pe
          JOIN tracks image_t ON image_t.id = image_pe.track_id
          JOIN albums al ON al.id = image_t.album_id
          JOIN track_artists image_ta
            ON image_ta.track_id = image_t.id AND image_ta.position = 0
          WHERE image_ta.artist_id = ar.id AND al.image_url IS NOT NULL
          GROUP BY al.id
          ORDER BY COUNT(*) DESC, MAX(image_pe.played_at) DESC
          LIMIT 1
        ) AS imageUrl
      FROM artists ar
      WHERE ar.id = ?
    `).get(id) as Record<string, unknown> | undefined
    return artist ? { ...artist, artists: [], album: null } : null
  }

  const album = db.prepare(`
    SELECT al.id, al.name, al.uri AS spotifyUri,
      al.spotify_url AS spotifyUrl, al.image_url AS imageUrl
    FROM albums al
    WHERE al.id = ?
  `).get(id) as Record<string, unknown> | undefined
  if (!album) return null
  const artists = db.prepare(`
    SELECT 'artist' AS type, ar.id, ar.name, ar.uri AS spotifyUri,
      ar.spotify_url AS spotifyUrl, MIN(ta.position) AS position
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.id
    JOIN artists ar ON ar.id = ta.artist_id
    WHERE t.album_id = ?
    GROUP BY ar.id
    ORDER BY position, ar.name
  `).all(id)
  return { ...album, artists, album: null }
}

function getDetailRanking(
  type: DetailEntityType,
  id: string,
  period: string,
): { position: number | null; events: number } {
  const filter = periodClause(period)
  const grouping =
    type === 'track'
      ? { joins: '', expression: 'pe.track_id' }
      : type === 'artist'
        ? {
            joins:
              'JOIN track_artists ranking_ta ON ranking_ta.track_id = pe.track_id AND ranking_ta.position = 0',
            expression: 'ranking_ta.artist_id',
          }
        : {
            joins: 'JOIN tracks ranking_t ON ranking_t.id = pe.track_id',
            expression: 'ranking_t.album_id',
          }
  const row = db.prepare(`
    WITH grouped AS (
      SELECT ${grouping.expression} AS entityId,
        COUNT(*) AS events, MAX(pe.played_at) AS lastPlayed
      FROM play_events pe
      ${grouping.joins}
      ${filter.sql}
      GROUP BY ${grouping.expression}
    ), ranked AS (
      SELECT entityId, events,
        ROW_NUMBER() OVER (
          ORDER BY events DESC, lastPlayed DESC, entityId
        ) AS position
      FROM grouped
      WHERE entityId IS NOT NULL
    )
    SELECT position, events FROM ranked WHERE entityId = ?
  `).get(...filter.params, id) as
    | { position: number; events: number }
    | undefined
  return row ?? { position: null, events: 0 }
}

function getDetailRelated(
  type: DetailEntityType,
  id: string,
  entity: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (type === 'track') {
    const artists = db.prepare(`
      SELECT 'artist' AS type, ar.id, ar.name, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl,
        CASE WHEN ta.position = 0 THEN 'Primary artist' ELSE 'Contributing artist' END AS detail
      FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = ?
      ORDER BY ta.position, ar.name
    `).all(id)
    const album = entity.album as Record<string, unknown> | null
    const connected = album
      ? [...artists, { ...album, detail: 'Album' }]
      : artists
    const moreFromAlbum = entity.albumId
      ? db.prepare(`
          SELECT 'track' AS type, t.id, t.name, t.uri AS spotifyUri,
            t.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
            COUNT(pe.id) AS events, 'Track on this album' AS detail
          FROM tracks t
          JOIN albums al ON al.id = t.album_id
          LEFT JOIN play_events pe ON pe.track_id = t.id
          WHERE t.album_id = ? AND t.id != ?
          GROUP BY t.id
          ORDER BY events DESC, t.name
          LIMIT 8
        `).all(String(entity.albumId), id)
      : []
    return [
      { title: 'Artists and album', items: connected },
      { title: 'More from this album', items: moreFromAlbum },
    ]
  }

  if (type === 'artist') {
    const topTracks = db.prepare(`
      SELECT 'track' AS type, t.id, t.name, t.uri AS spotifyUri,
        t.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
        al.name AS detail, COUNT(pe.id) AS events
      FROM track_artists ta
      JOIN tracks t ON t.id = ta.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      LEFT JOIN play_events pe ON pe.track_id = t.id
      WHERE ta.artist_id = ? AND ta.position = 0
      GROUP BY t.id
      ORDER BY events DESC, MAX(pe.played_at) DESC, t.name
      LIMIT 8
    `).all(id)
    const topAlbums = db.prepare(`
      SELECT 'album' AS type, al.id, al.name, al.uri AS spotifyUri,
        al.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
        'Album' AS detail, COUNT(pe.id) AS events
      FROM track_artists ta
      JOIN tracks t ON t.id = ta.track_id
      JOIN albums al ON al.id = t.album_id
      LEFT JOIN play_events pe ON pe.track_id = t.id
      WHERE ta.artist_id = ? AND ta.position = 0
      GROUP BY al.id
      ORDER BY events DESC, MAX(pe.played_at) DESC, al.name
      LIMIT 8
    `).all(id)
    return [
      { title: 'Top tracks', items: topTracks },
      { title: 'Top albums', items: topAlbums },
    ]
  }

  const artists = db.prepare(`
    SELECT 'artist' AS type, ar.id, ar.name, ar.uri AS spotifyUri,
      ar.spotify_url AS spotifyUrl,
      CASE WHEN MIN(ta.position) = 0 THEN 'Primary artist' ELSE 'Contributing artist' END AS detail
    FROM tracks t
    JOIN track_artists ta ON ta.track_id = t.id
    JOIN artists ar ON ar.id = ta.artist_id
    WHERE t.album_id = ?
    GROUP BY ar.id
    ORDER BY MIN(ta.position), ar.name
  `).all(id)
  const tracks = db.prepare(`
    SELECT 'track' AS type, t.id, t.name, t.uri AS spotifyUri,
      t.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
      'Track on this album' AS detail, COUNT(pe.id) AS events
    FROM tracks t
    JOIN albums al ON al.id = t.album_id
    LEFT JOIN play_events pe ON pe.track_id = t.id
    WHERE t.album_id = ?
    GROUP BY t.id
    ORDER BY events DESC, MAX(pe.played_at) DESC, t.name
  `).all(id)
  return [
    { title: 'Artists', items: artists },
    { title: 'Tracks', items: tracks },
  ]
}

export function getEntityDetail(
  type: DetailEntityType,
  id: string,
  period = '30d',
): Record<string, unknown> | null {
  const entity = getDetailEntity(type, id)
  if (!entity) return null

  const selectedFilter = detailEventFilter(type, id, period)
  const allFilter = detailEventFilter(type, id)
  const selected = db.prepare(`
    SELECT COUNT(*) AS events,
      COUNT(DISTINCT date(pe.played_at)) AS activeDays
    FROM play_events pe
    ${selectedFilter.sql}
  `).get(...selectedFilter.params) as { events: number; activeDays: number }
  const coverage = db.prepare(`
    SELECT MIN(pe.played_at) AS firstPlayed,
      MAX(pe.played_at) AS lastPlayed
    FROM play_events pe
    ${allFilter.sql}
  `).get(...allFilter.params) as {
    firstPlayed: string | null
    lastPlayed: string | null
  }

  const bucketKind = period === 'all' ? 'month' : period === '90d' ? 'week' : 'day'
  const bucketExpression =
    bucketKind === 'month'
      ? "substr(pe.played_at, 1, 7)"
      : bucketKind === 'week'
        ? "date(pe.played_at, printf('-%d days', (CAST(strftime('%w', pe.played_at) AS INTEGER) + 6) % 7))"
        : 'date(pe.played_at)'
  const timeline = db.prepare(`
    SELECT ${bucketExpression} AS bucket, COUNT(*) AS events
    FROM play_events pe
    ${selectedFilter.sql}
    GROUP BY bucket
    ORDER BY bucket
  `).all(...selectedFilter.params)

  const recentEvents = db.prepare(`
    SELECT pe.id, pe.played_at AS playedAt,
      t.id AS trackId, t.name AS trackName, t.uri AS spotifyUri,
      al.id AS albumId, al.name AS albumName, al.image_url AS imageUrl,
      GROUP_CONCAT(ar.name, ', ') AS artists,
      MAX(CASE WHEN ta.position = 0 THEN ar.id END) AS primaryArtistId
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN track_artists ta ON ta.track_id = t.id
    LEFT JOIN artists ar ON ar.id = ta.artist_id
    ${allFilter.sql}
    GROUP BY pe.id
    ORDER BY pe.played_at DESC
    LIMIT 12
  `).all(...allFilter.params)

  return {
    type,
    period,
    entity,
    summary: { ...selected, ...coverage },
    timeline: { bucketKind, items: timeline },
    rankings: detailPeriods.map((rankingPeriod) => ({
      period: rankingPeriod,
      ...getDetailRanking(type, id, rankingPeriod),
    })),
    related: getDetailRelated(type, id, entity),
    recentEvents,
  }
}

const rediscoveryGapDays = 90

function dayDistance(left: string, right: string): number {
  return Math.round(
    (Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) /
      86_400_000,
  )
}

function getActiveDayStreaks(
  days: Array<{ day: string; events: number }>,
  now: Date,
): {
  current: {
    days: number
    startDay: string | null
    endDay: string | null
    state: 'active' | 'grace' | 'ended'
  }
  longest: { days: number; startDay: string | null; endDay: string | null }
} {
  if (!days.length) {
    return {
      current: { days: 0, startDay: null, endDay: null, state: 'ended' },
      longest: { days: 0, startDay: null, endDay: null },
    }
  }

  let longestDays = 1
  let longestStart = days[0].day
  let longestEnd = days[0].day
  let runDays = 1
  let runStart = days[0].day

  for (let index = 1; index < days.length; index += 1) {
    if (dayDistance(days[index - 1].day, days[index].day) === 1) {
      runDays += 1
    } else {
      runDays = 1
      runStart = days[index].day
    }
    if (runDays > longestDays) {
      longestDays = runDays
      longestStart = runStart
      longestEnd = days[index].day
    }
  }

  const latestDay = days.at(-1)?.day ?? null
  const today = now.toISOString().slice(0, 10)
  const daysSinceLatest = latestDay ? dayDistance(latestDay, today) : 2
  if (!latestDay || daysSinceLatest > 1) {
    return {
      current: { days: 0, startDay: null, endDay: latestDay, state: 'ended' },
      longest: {
        days: longestDays,
        startDay: longestStart,
        endDay: longestEnd,
      },
    }
  }

  let currentDays = 1
  let currentStart = latestDay
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (dayDistance(days[index - 1].day, days[index].day) !== 1) break
    currentDays += 1
    currentStart = days[index - 1].day
  }

  return {
    current: {
      days: currentDays,
      startDay: currentStart,
      endDay: latestDay,
      state: daysSinceLatest === 0 ? 'active' : 'grace',
    },
    longest: {
      days: longestDays,
      startDay: longestStart,
      endDay: longestEnd,
    },
  }
}

function eventMilestoneThresholds(totalEvents: number): number[] {
  const thresholds = [1]
  for (let magnitude = 10; magnitude <= 1_000_000_000; magnitude *= 10) {
    thresholds.push(magnitude, magnitude * 2.5, magnitude * 5)
    if (magnitude > totalEvents && thresholds.at(-1)! > totalEvents) break
  }
  return thresholds
}

function getFirstAppearances(type: DetailEntityType): Record<string, unknown>[] {
  if (type === 'track') {
    return db.prepare(`
      SELECT 'track' AS type, t.id, t.name, t.uri AS spotifyUri,
        t.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
        MIN(pe.played_at) AS firstPlayed, COUNT(*) AS events,
        (
          SELECT GROUP_CONCAT(ar2.name, ', ')
          FROM track_artists ta2
          JOIN artists ar2 ON ar2.id = ta2.artist_id
          WHERE ta2.track_id = t.id
        ) AS detail
      FROM play_events pe
      JOIN tracks t ON t.id = pe.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      GROUP BY t.id
      ORDER BY firstPlayed DESC, t.name
      LIMIT 8
    `).all() as Record<string, unknown>[]
  }

  if (type === 'artist') {
    return db.prepare(`
      SELECT 'artist' AS type, ar.id, ar.name, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl, MIN(pe.played_at) AS firstPlayed,
        COUNT(*) AS events,
        (
          SELECT al2.image_url
          FROM play_events pe2
          JOIN tracks t2 ON t2.id = pe2.track_id
          LEFT JOIN albums al2 ON al2.id = t2.album_id
          JOIN track_artists ta2
            ON ta2.track_id = t2.id AND ta2.position = 0
          WHERE ta2.artist_id = ar.id
          ORDER BY pe2.played_at, pe2.id
          LIMIT 1
        ) AS imageUrl,
        'First heard on ' || (
          SELECT t2.name
          FROM play_events pe2
          JOIN tracks t2 ON t2.id = pe2.track_id
          JOIN track_artists ta2
            ON ta2.track_id = t2.id AND ta2.position = 0
          WHERE ta2.artist_id = ar.id
          ORDER BY pe2.played_at, pe2.id
          LIMIT 1
        ) AS detail
      FROM play_events pe
      JOIN track_artists ta
        ON ta.track_id = pe.track_id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
      GROUP BY ar.id
      ORDER BY firstPlayed DESC, ar.name
      LIMIT 8
    `).all() as Record<string, unknown>[]
  }

  return db.prepare(`
    SELECT 'album' AS type, al.id, al.name, al.uri AS spotifyUri,
      al.spotify_url AS spotifyUrl, al.image_url AS imageUrl,
      MIN(pe.played_at) AS firstPlayed, COUNT(*) AS events,
      'First heard via ' || (
        SELECT ar2.name
        FROM play_events pe2
        JOIN tracks t2 ON t2.id = pe2.track_id
        JOIN track_artists ta2
          ON ta2.track_id = t2.id AND ta2.position = 0
        JOIN artists ar2 ON ar2.id = ta2.artist_id
        WHERE t2.album_id = al.id
        ORDER BY pe2.played_at, pe2.id
        LIMIT 1
      ) AS detail
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    JOIN albums al ON al.id = t.album_id
    GROUP BY al.id
    ORDER BY firstPlayed DESC, al.name
    LIMIT 8
  `).all() as Record<string, unknown>[]
}

export function getRecordsAndMilestones(now = new Date()): Record<string, unknown> {
  const daily = db.prepare(`
    SELECT date(played_at) AS day, COUNT(*) AS events
    FROM play_events
    GROUP BY date(played_at)
    ORDER BY day
  `).all() as Array<{ day: string; events: number }>
  const eventRows = db.prepare(`
    SELECT played_at AS playedAt
    FROM play_events
    ORDER BY played_at, id
  `).all() as Array<{ playedAt: string }>
  const totalEvents = eventRows.length
  const bestEventCount = Math.max(0, ...daily.map((item) => Number(item.events)))
  const bestDays = daily.filter(
    (item) => Number(item.events) === bestEventCount && bestEventCount > 0,
  )
  const bestDay = bestDays.at(-1)
  const streaks = getActiveDayStreaks(daily, now)
  const thresholds = eventMilestoneThresholds(totalEvents)
  const achieved = thresholds
    .filter((value) => value <= totalEvents)
    .map((value) => ({ value, reachedAt: eventRows[value - 1].playedAt }))
  const nextValue = thresholds.find((value) => value > totalEvents) ?? null

  const rediscoveries = db.prepare(`
    WITH artist_events AS (
      SELECT pe.id AS eventId, pe.played_at AS returnedAt,
        ar.id AS artistId, ar.name AS artistName, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl, t.id AS trackId, t.name AS trackName,
        al.image_url AS imageUrl,
        LAG(pe.played_at) OVER (
          PARTITION BY ar.id ORDER BY pe.played_at, pe.id
        ) AS previousPlayedAt
      FROM play_events pe
      JOIN tracks t ON t.id = pe.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      JOIN track_artists ta
        ON ta.track_id = t.id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
    ), artist_gaps AS (
      SELECT *, CAST(
        julianday(returnedAt) - julianday(previousPlayedAt) AS INTEGER
      ) AS gapDays
      FROM artist_events
      WHERE previousPlayedAt IS NOT NULL
    )
    SELECT * FROM artist_gaps
    WHERE gapDays >= ?
    ORDER BY returnedAt DESC, artistName
    LIMIT 8
  `).all(rediscoveryGapDays) as Record<string, unknown>[]

  const importBatchCount = Number(
    (db.prepare('SELECT COUNT(*) AS count FROM import_batches').get() as {
      count: number
    }).count,
  )
  let verifiedListening: Record<string, unknown> | null = null
  if (importBatchCount > 0) {
    const totals = db.prepare(`
      SELECT COALESCE(SUM(ms_played), 0) AS totalMsPlayed,
        SUM(CASE WHEN ms_played >= 30000 THEN 1 ELSE 0 END) AS streamCount
      FROM verified_streams
    `).get() as { totalMsPlayed: number; streamCount: number }
    const highestDay = db.prepare(`
      SELECT date(played_at) AS day, SUM(ms_played) AS msPlayed
      FROM verified_streams
      GROUP BY date(played_at)
      ORDER BY msPlayed DESC, day DESC
      LIMIT 1
    `).get() as { day: string; msPlayed: number } | undefined
    verifiedListening = {
      importBatchCount,
      totalMsPlayed: Number(totals.totalMsPlayed),
      streamCount: Number(totals.streamCount),
      highestDay: highestDay ?? null,
    }
  }

  return {
    source: 'observed',
    rediscoveryGapDays,
    summary: {
      totalEvents,
      activeDays: daily.length,
      firstEvent: eventRows[0]?.playedAt ?? null,
      latestEvent: eventRows.at(-1)?.playedAt ?? null,
      bestDay: bestDay
        ? {
            day: bestDay.day,
            events: Number(bestDay.events),
            tiedDays: bestDays.length,
          }
        : null,
    },
    streaks,
    milestones: {
      achieved,
      next: nextValue
        ? {
            value: nextValue,
            remaining: nextValue - totalEvents,
            progress: totalEvents / nextValue,
          }
        : null,
    },
    rediscoveries,
    firstAppearances: {
      tracks: getFirstAppearances('track'),
      artists: getFirstAppearances('artist'),
      albums: getFirstAppearances('album'),
    },
    verifiedListening,
  }
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
    SELECT t.id, t.name, t.uri AS spotifyUri, t.spotify_url AS spotifyUrl,
      al.id AS albumId, al.name AS albumName, al.uri AS albumUri,
      al.image_url AS imageUrl,
      MAX(CASE WHEN ta.position = 0 THEN ar.id END) AS primaryArtistId,
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
    SELECT ar.id, ar.name, ar.uri AS spotifyUri,
      ar.spotify_url AS spotifyUrl, COUNT(*) AS events
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
      t.name AS trackName, t.uri AS spotifyUri, t.spotify_url AS spotifyUrl,
      al.name AS albumName, al.uri AS albumUri, al.image_url AS imageUrl,
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
      SELECT ar.id, ar.name, ar.uri AS spotifyUri,
        ar.spotify_url AS spotifyUrl, COUNT(*) AS events,
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
      SELECT al.id, al.name, al.uri AS spotifyUri, al.spotify_url AS spotifyUrl,
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
    SELECT t.id, t.name, t.uri AS spotifyUri, t.spotify_url AS spotifyUrl,
      al.id AS albumId, al.name AS albumName, al.uri AS albumUri,
      al.image_url AS imageUrl,
      MAX(CASE WHEN ta.position = 0 THEN ar.id END) AS primaryArtistId,
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

export function getLedgerDiscoverySeeds(
  query = '',
  limit = 30,
): DiscoverySeed[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const search = `%${query.trim()}%`
  const rows = db
    .prepare(`
      SELECT t.id AS spotifyTrackId, t.uri AS spotifyUri,
        t.name AS trackName, ar.name AS artistName,
        al.name AS albumName, al.image_url AS imageUrl,
        t.spotify_url AS spotifyUrl, COUNT(pe.id) AS events
      FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
      LEFT JOIN albums al ON al.id = t.album_id
      LEFT JOIN play_events pe ON pe.track_id = t.id
      WHERE (? = '%%' OR t.name LIKE ? OR ar.name LIKE ? OR al.name LIKE ?)
      GROUP BY t.id
      ORDER BY events DESC, MAX(pe.played_at) DESC, t.name
      LIMIT ?
    `)
    .all(search, search, search, search, safeLimit) as Array<
    Omit<DiscoverySeed, 'source'>
  >
  return rows.map((row) => ({ ...row, source: 'ledger' }))
}

const artistDiveRequiredActiveDays = 14

function queryArtistDiveArtists(
  query = '',
  artistId?: string,
  limit = 30,
): ArtistDiveArtistOption[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100)
  const search = `%${query.trim()}%`
  const rows = db.prepare(`
    WITH track_counts AS (
      SELECT ar.id AS artistId, t.id AS trackId,
        COUNT(pe.id) AS trackEvents, MAX(pe.played_at) AS lastPlayed
      FROM play_events pe
      JOIN tracks t ON t.id = pe.track_id
      JOIN track_artists ta
        ON ta.track_id = t.id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
      GROUP BY ar.id, t.id
    ), ranked_tracks AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY artistId ORDER BY trackEvents DESC, lastPlayed DESC, trackId
      ) AS trackRank
      FROM track_counts
    ), artist_rollup AS (
      SELECT artistId, SUM(trackEvents) AS events,
        COUNT(*) AS distinctTracks,
        SUM(CASE WHEN trackRank <= 2 THEN trackEvents ELSE 0 END) AS topTwoEvents,
        MAX(lastPlayed) AS latestEvent
      FROM ranked_tracks
      GROUP BY artistId
    ), day_rollup AS (
      SELECT ta.artist_id AS artistId,
        COUNT(DISTINCT date(pe.played_at)) AS activeDays
      FROM play_events pe
      JOIN track_artists ta
        ON ta.track_id = pe.track_id AND ta.position = 0
      GROUP BY ta.artist_id
    )
    SELECT ar.id, ar.name, ar.uri AS spotifyUri,
      ar.spotify_url AS spotifyUrl, rollup.events,
      rollup.distinctTracks, day_rollup.activeDays,
      rollup.topTwoEvents, rollup.latestEvent,
      EXISTS (
        SELECT 1 FROM top_snapshots ts
        WHERE ts.entity_type = 'artist' AND ts.entity_id = ar.id
      ) AS topItemSignal,
      EXISTS (
        SELECT 1
        FROM discovery_feedback df
        JOIN tracks feedback_t ON feedback_t.id = df.spotify_track_id
        JOIN track_artists feedback_ta
          ON feedback_ta.track_id = feedback_t.id AND feedback_ta.position = 0
        WHERE feedback_ta.artist_id = ar.id AND df.status = 'love'
      ) AS lovedTrackSignal,
      (
        SELECT image_al.image_url
        FROM play_events image_pe
        JOIN tracks image_t ON image_t.id = image_pe.track_id
        LEFT JOIN albums image_al ON image_al.id = image_t.album_id
        JOIN track_artists image_ta
          ON image_ta.track_id = image_t.id AND image_ta.position = 0
        WHERE image_ta.artist_id = ar.id AND image_al.image_url IS NOT NULL
        GROUP BY image_al.id
        ORDER BY COUNT(*) DESC, MAX(image_pe.played_at) DESC
        LIMIT 1
      ) AS imageUrl
    FROM artist_rollup rollup
    JOIN artists ar ON ar.id = rollup.artistId
    JOIN day_rollup ON day_rollup.artistId = rollup.artistId
    WHERE (? IS NULL OR ar.id = ?)
      AND (? = '%%' OR ar.name LIKE ?)
    ORDER BY rollup.events DESC, rollup.latestEvent DESC, ar.name
    LIMIT ?
  `).all(
    artistId ?? null,
    artistId ?? null,
    search,
    search,
    safeLimit,
  ) as Array<{
    id: string
    name: string
    spotifyUri: string
    spotifyUrl?: string
    imageUrl?: string
    events: number
    activeDays: number
    distinctTracks: number
    topTwoEvents: number
    topItemSignal: number
    lovedTrackSignal: number
  }>

  return rows.map((row) => {
    const topTwoShare = row.events ? row.topTwoEvents / row.events : 0
    const values = {
      events: Number(row.events),
      activeDays: Number(row.activeDays),
      distinctTracks: Number(row.distinctTracks),
      topTwoShare,
      topItemSignal: Boolean(row.topItemSignal),
      lovedTrackSignal: Boolean(row.lovedTrackSignal),
    }
    return {
      id: row.id,
      name: row.name,
      spotifyUri: row.spotifyUri,
      spotifyUrl: row.spotifyUrl,
      imageUrl: row.imageUrl,
      ...values,
      score: underexploredArtistScore(values),
    }
  })
}

export function getArtistDiveOptions(
  query = '',
  limit = 30,
): {
  coverage: { activeDays: number; requiredActiveDays: number; ready: boolean }
  suggestions: ArtistDiveArtistOption[]
  items: ArtistDiveArtistOption[]
} {
  const coverageActiveDays = Number(
    (
      db
        .prepare('SELECT COUNT(DISTINCT date(played_at)) AS count FROM play_events')
        .get() as { count: number }
    ).count,
  )
  const items = queryArtistDiveArtists(query, undefined, limit)
  const ready = coverageActiveDays >= artistDiveRequiredActiveDays
  const suggestions = ready
    ? queryArtistDiveArtists('', undefined, 100)
        .filter(
          (artist) =>
            artist.events >= 6 &&
            artist.activeDays >= 2 &&
            artist.distinctTracks >= 2 &&
            artist.distinctTracks <= 5 &&
            artist.topTwoShare >= 0.6,
        )
        .sort((left, right) => right.score - left.score || right.events - left.events)
        .slice(0, 6)
    : []
  return {
    coverage: {
      activeDays: coverageActiveDays,
      requiredActiveDays: artistDiveRequiredActiveDays,
      ready,
    },
    suggestions,
    items,
  }
}

export function getArtistDiveArtist(
  artistId: string,
): ArtistDiveArtistOption | null {
  return queryArtistDiveArtists('', artistId, 1)[0] ?? null
}

export function getArtistDiveSeeds(
  artistId: string,
  limit = 20,
): DiscoverySeed[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const rows = db.prepare(`
    SELECT t.id AS spotifyTrackId, t.uri AS spotifyUri,
      t.name AS trackName, ar.id AS artistId, ar.name AS artistName,
      al.id AS albumId, al.uri AS albumUri, al.name AS albumName,
      al.image_url AS imageUrl, t.spotify_url AS spotifyUrl,
      COUNT(pe.id) AS events,
      MAX(CASE WHEN df.status = 'love' THEN 1 ELSE 0 END) AS loved
    FROM play_events pe
    JOIN tracks t ON t.id = pe.track_id
    JOIN track_artists ta
      ON ta.track_id = t.id AND ta.position = 0
    JOIN artists ar ON ar.id = ta.artist_id
    LEFT JOIN albums al ON al.id = t.album_id
    LEFT JOIN discovery_feedback df ON df.spotify_track_id = t.id
    WHERE ar.id = ?
    GROUP BY t.id
    ORDER BY loved DESC, events DESC, MAX(pe.played_at) DESC, t.name
    LIMIT ?
  `).all(artistId, safeLimit) as Array<
    Omit<DiscoverySeed, 'source'> & { loved: number }
  >
  return rows.map((row) => ({
    spotifyTrackId: row.spotifyTrackId,
    spotifyUri: row.spotifyUri,
    trackName: row.trackName,
    artistId: row.artistId,
    artistName: row.artistName,
    albumId: row.albumId,
    albumUri: row.albumUri,
    albumName: row.albumName,
    imageUrl: row.imageUrl,
    spotifyUrl: row.spotifyUrl,
    events: row.events,
    source: 'ledger',
  }))
}

export function getArtistKnownAlbumIds(artistId: string): Set<string> {
  const rows = db.prepare(`
    SELECT DISTINCT t.album_id AS albumId
    FROM tracks t
    JOIN track_artists ta
      ON ta.track_id = t.id AND ta.position = 0
    WHERE ta.artist_id = ? AND t.album_id IS NOT NULL
  `).all(artistId) as Array<{ albumId: string }>
  return new Set(rows.map((row) => row.albumId))
}

export function getCachedArtistCatalog(
  artistId: string,
  maxAgeMs = 7 * 86_400_000,
  now = Date.now(),
): ArtistCatalogTrack[] | null {
  const row = db.prepare(`
    SELECT fetched_at AS fetchedAt, payload_json AS payloadJson
    FROM artist_catalog_cache
    WHERE artist_id = ?
  `).get(artistId) as { fetchedAt: string; payloadJson: string } | undefined
  if (!row || now - Date.parse(row.fetchedAt) > maxAgeMs) return null
  try {
    const parsed = JSON.parse(row.payloadJson) as ArtistCatalogTrack[]
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveCachedArtistCatalog(
  artistId: string,
  tracks: ArtistCatalogTrack[],
  fetchedAt = new Date().toISOString(),
): void {
  db.prepare(`
    INSERT INTO artist_catalog_cache (artist_id, fetched_at, payload_json)
    VALUES (?, ?, ?)
    ON CONFLICT(artist_id) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json
  `).run(artistId, fetchedAt, JSON.stringify(tracks))
}

export function getKnownDiscoveryCatalog(): {
  trackIds: Set<string>
  trackKeys: Set<string>
  artistKeys: Set<string>
} {
  const rows = db
    .prepare(`
      SELECT t.id AS trackId, t.name AS trackName, ar.name AS artistName
      FROM tracks t
      JOIN track_artists ta ON ta.track_id = t.id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
    `)
    .all() as Array<{ trackId: string; trackName: string; artistName: string }>
  return {
    trackIds: new Set(rows.map((row) => row.trackId)),
    trackKeys: new Set(
      rows.map((row) => discoveryTrackKey(row.artistName, row.trackName)),
    ),
    artistKeys: new Set(
      rows.map((row) => normalizeDiscoveryText(row.artistName)),
    ),
  }
}

export function getDiscoveryFeedbackMap(): Map<
  string,
  DiscoveryFeedbackStatus
> {
  const rows = db
    .prepare(`
      SELECT canonical_key AS canonicalKey, spotify_track_id AS spotifyTrackId,
        status
      FROM discovery_feedback
    `)
    .all() as Array<{
    canonicalKey: string
    spotifyTrackId: string | null
    status: DiscoveryFeedbackStatus
  }>
  const result = new Map<string, DiscoveryFeedbackStatus>()
  for (const row of rows) {
    result.set(row.canonicalKey, row.status)
    if (row.spotifyTrackId) result.set(row.spotifyTrackId, row.status)
  }
  return result
}

export function getCachedDiscoveryTrack(canonicalKey: string):
  | {
      spotifyTrackId: string
      spotifyUri: string
      trackName: string
      artistName: string
      albumName?: string
      imageUrl?: string
      spotifyUrl?: string
      durationMs?: number
    }
  | null {
  const row = db
    .prepare(`
      SELECT spotify_track_id AS spotifyTrackId, spotify_uri AS spotifyUri,
        track_name AS trackName, artist_name AS artistName,
        album_name AS albumName, image_url AS imageUrl,
        spotify_url AS spotifyUrl, duration_ms AS durationMs
      FROM discovery_resolution_cache
      WHERE canonical_key = ?
    `)
    .get(canonicalKey) as
    | {
        spotifyTrackId: string
        spotifyUri: string
        trackName: string
        artistName: string
        albumName?: string
        imageUrl?: string
        spotifyUrl?: string
        durationMs?: number
      }
    | undefined
  return row ?? null
}

export function saveCachedDiscoveryTrack(
  canonicalKey: string,
  track: {
    spotifyTrackId: string
    spotifyUri: string
    trackName: string
    artistName: string
    albumName?: string
    imageUrl?: string
    spotifyUrl?: string
    durationMs?: number
  },
): void {
  db.prepare(`
    INSERT INTO discovery_resolution_cache
      (canonical_key, spotify_track_id, spotify_uri, track_name, artist_name,
       album_name, image_url, spotify_url, duration_ms, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      spotify_track_id = excluded.spotify_track_id,
      spotify_uri = excluded.spotify_uri,
      track_name = excluded.track_name,
      artist_name = excluded.artist_name,
      album_name = excluded.album_name,
      image_url = excluded.image_url,
      spotify_url = excluded.spotify_url,
      duration_ms = excluded.duration_ms,
      resolved_at = excluded.resolved_at
  `).run(
    canonicalKey,
    track.spotifyTrackId,
    track.spotifyUri,
    track.trackName,
    track.artistName,
    track.albumName ?? null,
    track.imageUrl ?? null,
    track.spotifyUrl ?? null,
    track.durationMs ?? null,
    new Date().toISOString(),
  )
}

export function createDiscoverySession(
  mode: DiscoverySessionMode,
  targetCount: number,
  seeds: DiscoverySeed[],
  options: {
    kind?: DiscoverySessionKind
    focusArtist?: DiscoverySessionRecord['focusArtist']
  } = {},
): number {
  const result = db
    .prepare(`
      INSERT INTO discovery_sessions
        (created_at, kind, mode, target_count, seed_json, focus_artist_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      new Date().toISOString(),
      options.kind ?? 'related_tracks',
      mode,
      targetCount,
      JSON.stringify(seeds),
      options.focusArtist ? JSON.stringify(options.focusArtist) : null,
    )
  return Number(result.lastInsertRowid)
}

export function saveDiscoveryCandidates(
  sessionId: number,
  candidates: RankedDiscoveryCandidate[],
): void {
  const statement = db.prepare(`
    INSERT INTO discovery_candidates
      (session_id, position, spotify_track_id, spotify_uri, track_name,
       artist_id, artist_name, album_id, album_uri, album_name, release_date,
       image_url, spotify_url, duration_ms,
       similarity, seed_hits, seed_keys_json, seed_labels_json, score, reason,
       relationship_kind, is_new_artist, is_anchor, decision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.exec('BEGIN')
  try {
    candidates.forEach((candidate, index) => {
      statement.run(
        sessionId,
        index + 1,
        candidate.spotifyTrackId,
        candidate.spotifyUri,
        candidate.trackName,
        candidate.artistId ?? null,
        candidate.artistName,
        candidate.albumId ?? null,
        candidate.albumUri ?? null,
        candidate.albumName ?? null,
        candidate.releaseDate ?? null,
        candidate.imageUrl ?? null,
        candidate.spotifyUrl ?? null,
        candidate.durationMs ?? null,
        candidate.match,
        candidate.seedKeys.length,
        JSON.stringify(candidate.seedKeys),
        JSON.stringify(candidate.seedLabels),
        candidate.score,
        candidate.reason,
        candidate.relationshipKind,
        candidate.isNewArtist ? 1 : 0,
        candidate.isAnchor ? 1 : 0,
        candidate.decision,
      )
    })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getDiscoverySession(
  id?: number,
): DiscoverySessionRecord | null {
  const session = (
    id
      ? db
          .prepare(`
            SELECT id, created_at AS createdAt, kind, mode,
              target_count AS targetCount, seed_json AS seedJson,
              focus_artist_json AS focusArtistJson,
              playlist_id AS playlistId, playlist_name AS playlistName,
              playlist_url AS playlistUrl, saved_at AS savedAt
            FROM discovery_sessions WHERE id = ?
          `)
          .get(id)
      : db
          .prepare(`
            SELECT id, created_at AS createdAt, kind, mode,
              target_count AS targetCount, seed_json AS seedJson,
              focus_artist_json AS focusArtistJson,
              playlist_id AS playlistId, playlist_name AS playlistName,
              playlist_url AS playlistUrl, saved_at AS savedAt
            FROM discovery_sessions ORDER BY id DESC LIMIT 1
          `)
          .get()
  ) as
    | {
        id: number
        createdAt: string
        kind: DiscoverySessionKind
        mode: DiscoverySessionMode
        targetCount: number
        seedJson: string
        focusArtistJson?: string
        playlistId?: string
        playlistName?: string
        playlistUrl?: string
        savedAt?: string
      }
    | undefined
  if (!session) return null
  const candidates = db
    .prepare(`
      SELECT id, position, spotify_track_id AS spotifyTrackId,
        spotify_uri AS spotifyUri, track_name AS trackName,
        artist_id AS artistId, artist_name AS artistName,
        album_id AS albumId, album_uri AS albumUri,
        album_name AS albumName, release_date AS releaseDate,
        image_url AS imageUrl, spotify_url AS spotifyUrl,
        duration_ms AS durationMs, similarity AS match,
        seed_keys_json AS seedKeysJson, seed_labels_json AS seedLabelsJson,
        score, reason, relationship_kind AS relationshipKind,
        is_new_artist AS isNewArtist, is_anchor AS isAnchor, decision
      FROM discovery_candidates
      WHERE session_id = ?
      ORDER BY position
    `)
    .all(session.id) as Array<{
    id: number
    position: number
    spotifyTrackId: string
    spotifyUri: string
    trackName: string
    artistId?: string
    artistName: string
    albumId?: string
    albumUri?: string
    albumName?: string
    releaseDate?: string
    imageUrl?: string
    spotifyUrl?: string
    durationMs?: number
    match: number
    seedKeysJson: string
    seedLabelsJson: string
    score: number
    reason: string
    relationshipKind: RankedDiscoveryCandidate['relationshipKind']
    isNewArtist: number
    isAnchor: number
    decision: DiscoveryFeedbackStatus
  }>
  return {
    id: session.id,
    createdAt: session.createdAt,
    kind: session.kind,
    mode: session.mode,
    targetCount: session.targetCount,
    playlistId: session.playlistId,
    playlistName: session.playlistName,
    playlistUrl: session.playlistUrl,
    savedAt: session.savedAt,
    seeds: JSON.parse(session.seedJson) as DiscoverySeed[],
    focusArtist: session.focusArtistJson
      ? (JSON.parse(session.focusArtistJson) as DiscoverySessionRecord['focusArtist'])
      : undefined,
    candidates: candidates.map(
      ({ seedKeysJson, seedLabelsJson, ...candidate }) => ({
        ...candidate,
        isNewArtist: Boolean(candidate.isNewArtist),
        isAnchor: Boolean(candidate.isAnchor),
        seedKeys: JSON.parse(seedKeysJson) as string[],
        seedLabels: JSON.parse(seedLabelsJson) as string[],
      }),
    ),
  }
}

export function setDiscoveryFeedback(
  candidateId: number,
  status: DiscoveryFeedbackStatus,
): void {
  const candidate = db
    .prepare(`
      SELECT spotify_track_id AS spotifyTrackId, track_name AS trackName,
        artist_name AS artistName, is_anchor AS isAnchor,
        session_id AS sessionId
      FROM discovery_candidates WHERE id = ?
    `)
    .get(candidateId) as
    | {
        spotifyTrackId: string
        trackName: string
        artistName: string
        isAnchor: number
        sessionId: number
      }
    | undefined
  if (!candidate) throw new Error('Discovery candidate not found.')
  const key = discoveryTrackKey(candidate.artistName, candidate.trackName)
  if (candidate.isAnchor) {
    db.prepare('UPDATE discovery_candidates SET decision = ? WHERE id = ?').run(
      status,
      candidateId,
    )
    return
  }
  db.prepare(`
    UPDATE discovery_candidates SET decision = ? WHERE spotify_track_id = ?
  `).run(status, candidate.spotifyTrackId)
  if (status === 'neutral') {
    db.prepare('DELETE FROM discovery_feedback WHERE canonical_key = ?').run(key)
    return
  }
  db.prepare(`
    INSERT INTO discovery_feedback
      (canonical_key, spotify_track_id, track_name, artist_name, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      spotify_track_id = excluded.spotify_track_id,
      track_name = excluded.track_name,
      artist_name = excluded.artist_name,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    key,
    candidate.spotifyTrackId,
    candidate.trackName,
    candidate.artistName,
    status,
    new Date().toISOString(),
  )
}

export function getDiscoveryPlaylistTracks(sessionId: number): Array<{
  spotifyUri: string
  trackName: string
  artistName: string
}> {
  return db
    .prepare(`
      SELECT spotify_uri AS spotifyUri, track_name AS trackName,
        artist_name AS artistName
      FROM discovery_candidates
      WHERE session_id = ? AND decision NOT IN ('reject', 'known')
      ORDER BY position
    `)
    .all(sessionId) as Array<{
    spotifyUri: string
    trackName: string
    artistName: string
  }>
}

export function markDiscoveryPlaylistSaved(
  sessionId: number,
  playlist: { id: string; name: string; url?: string },
): void {
  db.prepare(`
    UPDATE discovery_sessions
    SET playlist_id = ?, playlist_name = ?, playlist_url = ?, saved_at = ?
    WHERE id = ?
  `).run(
    playlist.id,
    playlist.name,
    playlist.url ?? null,
    new Date().toISOString(),
    sessionId,
  )
}
