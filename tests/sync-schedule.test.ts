import { describe, expect, it } from 'vitest'
import { isDailyTopSyncDue } from '../server/lib/sync-schedule.ts'

describe('isDailyTopSyncDue', () => {
  const now = new Date('2026-08-25T12:00:00.000Z')

  it('is due when no successful snapshot exists', () => {
    expect(isDailyTopSyncDue(null, now)).toBe(true)
  })

  it('is not due twice on the same UTC day', () => {
    expect(isDailyTopSyncDue('2026-08-25T00:05:00.000Z', now)).toBe(false)
  })

  it('is due on the next UTC day', () => {
    expect(isDailyTopSyncDue('2026-08-24T23:59:59.000Z', now)).toBe(true)
  })

  it('recovers from an invalid stored timestamp', () => {
    expect(isDailyTopSyncDue('not-a-date', now)).toBe(true)
  })
})
