import { ArrowUpRight, History, Sparkles, Telescope } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageIntro, Panel, Skeleton } from '../components/Ui'
import { api } from '../lib/api'
import type { TrendsData } from '../types'

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const insightIcons = {
  'new-obsession': Sparkles,
  rising: ArrowUpRight,
  returning: History,
  forgotten: Telescope,
}

export default function TrendsScreen() {
  const [data, setData] = useState<TrendsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<TrendsData>('/api/trends')
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  const heatmap = useMemo(() => {
    const counts = new Map(
      data?.heatmap.map((item) => [`${item.day}-${item.hour}`, item.events]) ?? [],
    )
    const max = Math.max(1, ...(data?.heatmap.map((item) => item.events) ?? [1]))
    return { counts, max }
  }, [data])

  return (
    <>
      <PageIntro
        eyebrow="Patterns, not guesses"
        title="How your listening moves."
        description="Trend labels only appear when the local history contains enough evidence to support them."
      />

      <div className="trend-grid">
        <Panel title="Listening clock" kicker="Day and hour" className="heatmap-panel">
          {loading ? (
            <Skeleton rows={5} />
          ) : data?.eventCount ? (
            <div className="heatmap-wrap">
              <div className="hour-labels">
                <span>12am</span>
                <span>6am</span>
                <span>12pm</span>
                <span>6pm</span>
              </div>
              <div className="heatmap">
                {dayLabels.map((day, dayIndex) => (
                  <div className="heatmap-row" key={day}>
                    <span>{day}</span>
                    <div>
                      {Array.from({ length: 24 }, (_, hour) => {
                        const count = heatmap.counts.get(`${dayIndex}-${hour}`) ?? 0
                        const level = count
                          ? Math.max(1, Math.ceil((count / heatmap.max) * 4))
                          : 0
                        return (
                          <i
                            key={hour}
                            data-level={level}
                            title={`${day} ${String(hour).padStart(2, '0')}:00 — ${count} events`}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="heatmap-legend">
                Less <i data-level="0" /> <i data-level="1" />{' '}
                <i data-level="2" /> <i data-level="3" />{' '}
                <i data-level="4" /> More
              </div>
            </div>
          ) : (
            <EmptyState
              title="No listening clock yet"
              detail="The heatmap activates as soon as events enter the ledger."
            />
          )}
        </Panel>

        <Panel title="Evidence-led insights" kicker="Rolling comparison">
          {loading ? (
            <Skeleton rows={3} />
          ) : data?.state === 'ready' && data.insights.length ? (
            <div className="insight-list">
              {data.insights.map((insight) => {
                const Icon = insightIcons[insight.kind]
                return (
                  <article key={`${insight.kind}-${insight.subject}`}>
                    <span>
                      <Icon size={18} />
                    </span>
                    <div>
                      <small>{insight.title}</small>
                      <strong>{insight.subject}</strong>
                      <p>{insight.detail}</p>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="insufficient-state">
              <span>{data?.eventCount ?? 0}<small>/20</small></span>
              <div>
                <h3>Not enough evidence yet</h3>
                <p>
                  Listening Ledger waits for at least 20 recorded events before
                  describing an obsession, rise, or forgotten favourite.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}

