import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let directory = ''
let database: typeof import('../server/db.ts')

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'listening-ledger-migration-test-'))
  const databasePath = join(directory, 'legacy.sqlite')
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_hash TEXT NOT NULL UNIQUE,
      event_count INTEGER NOT NULL
    );
    CREATE TABLE verified_streams (
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
    INSERT INTO import_batches
      (imported_at, source_name, source_hash, event_count)
    VALUES ('2026-08-25T12:00:00.000Z', 'legacy.json', 'legacy-source', 2);
    INSERT INTO verified_streams
      (played_at, track_uri, track_name, artist_name, album_name,
        ms_played, skipped, batch_id)
    VALUES
      ('2026-08-20T10:00:00.000Z', NULL, 'Legacy Track',
        'Legacy Artist', NULL, 45000, 0, 1),
      ('2026-08-20T10:00:00.000Z', NULL, 'Legacy Track',
        'Legacy Artist', NULL, 45000, 0, 1);
  `)
  legacy.close()

  vi.stubEnv('LISTENING_LEDGER_DB', databasePath)
  vi.resetModules()
  database = await import('../server/db.ts')
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

describe('history import schema migration', () => {
  it('removes exact legacy duplicates and backfills canonical identities', () => {
    const rows = database.db.prepare(`
      SELECT id, dedupe_key AS dedupeKey, overlap_key AS overlapKey
      FROM verified_streams
      ORDER BY id
    `).all() as Array<{ id: number; dedupeKey: string; overlapKey: string }>

    expect(rows).toHaveLength(1)
    expect(rows[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[0].overlapKey).toMatch(/^[a-f0-9]{64}$/)

    expect(
      database.db.prepare(`
        SELECT event_count AS eventCount, duplicate_count AS duplicateCount,
          qualifying_stream_count AS qualifyingStreamCount
        FROM import_batches WHERE id = 1
      `).get(),
    ).toMatchObject({
      eventCount: 1,
      duplicateCount: 1,
      qualifyingStreamCount: 1,
    })

    expect(() =>
      database.db.prepare(`
        INSERT INTO verified_streams
          (played_at, track_uri, track_name, artist_name, album_name,
            ms_played, skipped, batch_id, dedupe_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        '2026-08-20T10:00:00.000Z',
        null,
        'Legacy Track',
        'Legacy Artist',
        null,
        45000,
        0,
        1,
        rows[0].dedupeKey,
      ),
    ).toThrow()
  })
})
