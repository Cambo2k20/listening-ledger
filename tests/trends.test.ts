import { describe, expect, it } from 'vitest'
import { buildTrendInsights } from '../server/lib/trends.ts'
import type { TrendEvent } from '../server/types.ts'

const now = new Date('2026-08-25T12:00:00.000Z')

function trendEvent(
  artistName: string,
  daysAgo: number,
  index: number,
): TrendEvent {
  return {
    artistName,
    trackId: `${artistName}-${index}`,
    trackName: `Track ${index}`,
    playedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  }
}

describe('trend insights', () => {
  it('waits for enough evidence', () => {
    const events = Array.from({ length: 19 }, (_, index) =>
      trendEvent('Artist', 1, index),
    )
    expect(buildTrendInsights(events, now)).toEqual({
      state: 'insufficient',
      insights: [],
    })
  })

  it('identifies a new obsession without inventing prior activity', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, index) =>
        trendEvent('New Artist', 1, index),
      ),
      ...Array.from({ length: 15 }, (_, index) =>
        trendEvent('Other Artist', 10 + index, index),
      ),
    ]
    const result = buildTrendInsights(events, now)
    expect(result.state).toBe('ready')
    expect(result.insights[0]).toMatchObject({
      kind: 'new-obsession',
      subject: 'New Artist',
    })
  })

  it('identifies a forgotten favourite after thirty days', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, index) =>
        trendEvent('Old Favourite', 40 + index, index),
      ),
      ...Array.from({ length: 13 }, (_, index) =>
        trendEvent('Current Artist', 2 + (index % 3), index),
      ),
    ]
    const result = buildTrendInsights(events, now)
    expect(result.insights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'forgotten',
          subject: 'Old Favourite',
        }),
      ]),
    )
  })
})

