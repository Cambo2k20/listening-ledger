import type { TrendEvent, TrendInsight } from '../types.ts'

const DAY = 86_400_000

interface ArtistWindow {
  recent: number
  previous: number
  total: number
  latest: number
}

export function buildTrendInsights(
  events: TrendEvent[],
  now = new Date(),
): { state: 'insufficient' | 'ready'; insights: TrendInsight[] } {
  if (events.length < 20) {
    return { state: 'insufficient', insights: [] }
  }

  const nowMs = now.getTime()
  const recentStart = nowMs - 7 * DAY
  const previousStart = nowMs - 35 * DAY
  const windows = new Map<string, ArtistWindow>()

  for (const event of events) {
    const timestamp = new Date(event.playedAt).getTime()
    const window = windows.get(event.artistName) ?? {
      recent: 0,
      previous: 0,
      total: 0,
      latest: 0,
    }
    window.total += 1
    window.latest = Math.max(window.latest, timestamp)
    if (timestamp >= recentStart) window.recent += 1
    else if (timestamp >= previousStart) window.previous += 1
    windows.set(event.artistName, window)
  }

  const entries = [...windows.entries()]
  const insights: TrendInsight[] = []

  const obsession = entries
    .filter(([, value]) => value.recent >= 3 && value.previous === 0)
    .sort((a, b) => b[1].recent - a[1].recent)[0]
  if (obsession) {
    insights.push({
      kind: 'new-obsession',
      title: 'New obsession',
      subject: obsession[0],
      detail: `${obsession[1].recent} recorded plays this week after none in the previous four weeks.`,
    })
  }

  const rising = entries
    .filter(([, value]) => value.recent >= 3 && value.previous > 0)
    .map(([name, value]) => ({
      name,
      value,
      lift: value.recent / Math.max(value.previous / 4, 1),
    }))
    .filter((entry) => entry.lift >= 1.5)
    .sort((a, b) => b.lift - a.lift)[0]
  if (rising) {
    insights.push({
      kind: 'rising',
      title: 'Rising quickly',
      subject: rising.name,
      detail: `Your weekly pace is ${rising.lift.toFixed(1)}× the preceding four-week pace.`,
    })
  }

  const forgotten = entries
    .filter(([, value]) => value.total >= 5 && value.latest < nowMs - 30 * DAY)
    .sort((a, b) => b[1].total - a[1].total)[0]
  if (forgotten) {
    insights.push({
      kind: 'forgotten',
      title: 'Forgotten favourite',
      subject: forgotten[0],
      detail: `${forgotten[1].total} recorded plays, but nothing in the last 30 days.`,
    })
  }

  return { state: 'ready', insights: insights.slice(0, 3) }
}

