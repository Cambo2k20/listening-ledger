import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

let database: typeof import('../server/db.ts')

beforeAll(async () => {
  vi.stubEnv('LISTENING_LEDGER_DB', ':memory:')
  vi.resetModules()
  database = await import('../server/db.ts')
})

afterAll(() => {
  database.db.close()
  vi.unstubAllEnvs()
})

describe('SQLite synchronization lock', () => {
  it('allows only the owner to hold and release a live lock', () => {
    expect(database.acquireSyncLock('owner-test', 'first', 60_000, 1_000)).toBe(
      true,
    )
    expect(database.acquireSyncLock('owner-test', 'second', 60_000, 1_001)).toBe(
      false,
    )

    database.releaseSyncLock('owner-test', 'not-the-owner')
    expect(database.acquireSyncLock('owner-test', 'second', 60_000, 1_002)).toBe(
      false,
    )

    database.releaseSyncLock('owner-test', 'first')
    expect(database.acquireSyncLock('owner-test', 'second', 60_000, 1_003)).toBe(
      true,
    )
    database.releaseSyncLock('owner-test', 'second')
  })

  it('recovers a lock after its lease expires', () => {
    expect(database.acquireSyncLock('expiry-test', 'first', 100, 2_000)).toBe(true)
    expect(database.acquireSyncLock('expiry-test', 'second', 100, 2_100)).toBe(
      true,
    )
    database.releaseSyncLock('expiry-test', 'second')
  })
})
