import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Disc3,
  ExternalLink,
  History,
  Radio,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  SpotifyDesktopButton,
  SpotifyDesktopIconButton,
} from '../components/SpotifyActions'
import {
  EmptyState,
  MetricCard,
  Panel,
  Skeleton,
} from '../components/Ui'
import { api } from '../lib/api'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { detailPath } from '../lib/routes'
import type {
  DetailEntityType,
  DetailPeriod,
  DetailReference,
  EntityDetailData,
} from '../types'

const periodOptions: Array<{ value: DetailPeriod; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All recorded' },
]

const typeLabels: Record<DetailEntityType, string> = {
  track: 'Track',
  artist: 'Artist',
  album: 'Album',
}

const bucketLabels = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
} as const

function periodLabel(period: DetailPeriod): string {
  return periodOptions.find((item) => item.value === period)?.label ?? period
}

function formatDuration(durationMs?: number): string | null {
  if (!durationMs) return null
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function formatBucket(bucket: string, kind: 'day' | 'week' | 'month'): string {
  const date = new Date(`${kind === 'month' ? `${bucket}-01` : bucket}T12:00:00`)
  if (Number.isNaN(date.getTime())) return bucket
  if (kind === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      year: '2-digit',
    }).format(date)
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

function entitySubtitle(data: EntityDetailData): string {
  const artists = data.entity.artists.map((artist) => artist.name).join(', ')
  if (data.type === 'track') {
    return [artists, data.entity.album?.name, formatDuration(data.entity.durationMs)]
      .filter(Boolean)
      .join(' · ')
  }
  if (data.type === 'album') return artists || 'Album in your ledger'
  return 'Artist in your local listening ledger'
}

function RelatedItem({ item }: { item: DetailReference }) {
  return (
    <li>
      <Link to={detailPath(item.type, item.id)} className="detail-related-link">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" />
        ) : (
          <span className="art-placeholder">
            <Disc3 size={18} />
          </span>
        )}
        <span>
          <strong>{item.name}</strong>
          <small>{item.detail || typeLabels[item.type]}</small>
        </span>
        {typeof item.events === 'number' && (
          <em>
            {formatNumber(item.events)} event{item.events === 1 ? '' : 's'}
          </em>
        )}
      </Link>
    </li>
  )
}

export default function EntityDetailScreen({
  type,
}: {
  type: DetailEntityType
}) {
  const { id = '' } = useParams()
  const [period, setPeriod] = useState<DetailPeriod>('30d')
  const [data, setData] = useState<EntityDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    api<EntityDetailData>(
      `/api/details/${type}/${encodeURIComponent(id)}?period=${period}`,
    )
      .then((result) => {
        if (active) setData(result)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setData(null)
        setError(reason instanceof Error ? reason.message : 'Detail lookup failed.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id, period, type])

  const maxTimeline = useMemo(
    () => Math.max(1, ...(data?.timeline.items.map((item) => item.events) ?? [1])),
    [data],
  )

  if (loading && !data) {
    return (
      <>
        <Link to="/rankings" className="detail-back-link">
          <ArrowLeft size={15} /> Back to rankings
        </Link>
        <section className="detail-hero detail-hero--loading">
          <Skeleton rows={3} />
        </section>
        <div className="detail-grid">
          <Panel title="Listening timeline" kicker="Loading observed events">
            <Skeleton rows={4} />
          </Panel>
        </div>
      </>
    )
  }

  if (!data) {
    return (
      <>
        <Link to="/rankings" className="detail-back-link">
          <ArrowLeft size={15} /> Back to rankings
        </Link>
        <Panel title={`${typeLabels[type]} unavailable`} kicker="Ledger detail">
          <EmptyState
            title="This item could not be opened"
            detail={error ?? 'The requested ledger item was not found.'}
            actionLabel="Return to rankings"
            actionTo="/rankings"
          />
        </Panel>
      </>
    )
  }

  return (
    <>
      <Link to="/rankings" className="detail-back-link">
        <ArrowLeft size={15} /> Back to rankings
      </Link>

      <section className="detail-hero">
        <div className="detail-cover">
          {data.entity.imageUrl ? (
            <img src={data.entity.imageUrl} alt="" />
          ) : (
            <span><Disc3 size={42} /></span>
          )}
        </div>
        <div className="detail-identity">
          <span className="eyebrow">{typeLabels[data.type]} detail</span>
          <h1>{data.entity.name}</h1>
          <p>{entitySubtitle(data)}</p>
          <span className="detail-source-note">
            <Radio size={13} /> Observed playback events only
          </span>
        </div>
        <div className="detail-actions">
          <SpotifyDesktopButton
            spotifyUri={data.entity.spotifyUri}
            label={typeLabels[data.type].toLowerCase()}
          />
          {data.entity.spotifyUrl && (
            <a
              href={data.entity.spotifyUrl}
              target="_blank"
              rel="noreferrer"
              className="button button--quiet"
            >
              <ExternalLink size={15} /> Spotify web
            </a>
          )}
        </div>
      </section>

      <div className="detail-period-row">
        <span>Measure observed events across</span>
        <div className="segmented-control" aria-label="Detail period">
          {periodOptions.map((option) => (
            <button
              key={option.value}
              className={period === option.value ? 'active' : ''}
              onClick={() => setPeriod(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="metric-grid detail-metrics">
        <MetricCard
          label="Recorded events"
          value={formatNumber(data.summary.events)}
          detail={periodLabel(data.period)}
          icon={Radio}
          tone="violet"
        />
        <MetricCard
          label="Active days"
          value={formatNumber(data.summary.activeDays)}
          detail={`Within ${periodLabel(data.period).toLowerCase()}`}
          icon={CalendarDays}
          tone="amber"
        />
        <MetricCard
          label="First record"
          value={formatDate(data.summary.firstPlayed)}
          detail="First observed appearance"
          icon={History}
        />
        <MetricCard
          label="Latest record"
          value={formatDate(data.summary.lastPlayed)}
          detail="Most recent observed appearance"
          icon={Clock3}
          tone="lime"
        />
      </div>

      <div className="detail-grid">
        <Panel
          title="Listening timeline"
          kicker={`${periodLabel(data.period)} · ${bucketLabels[data.timeline.bucketKind]} buckets`}
          className="detail-timeline-panel"
        >
          {data.timeline.items.length ? (
            <div className="detail-chart-scroll">
              <div
                className="detail-chart"
                style={{
                  gridTemplateColumns: `repeat(${data.timeline.items.length}, minmax(28px, 1fr))`,
                }}
                aria-label={`Observed events by ${data.timeline.bucketKind}`}
              >
                {data.timeline.items.map((item, index) => {
                  const labelEvery = Math.max(
                    1,
                    Math.ceil(data.timeline.items.length / 7),
                  )
                  const showLabel =
                    index === 0 ||
                    index === data.timeline.items.length - 1 ||
                    index % labelEvery === 0
                  return (
                    <div
                      className="detail-chart-column"
                      key={item.bucket}
                      title={`${formatBucket(item.bucket, data.timeline.bucketKind)}: ${item.events} observed events`}
                    >
                      <strong>{item.events}</strong>
                      <i
                        style={{
                          height: `${Math.max(7, (item.events / maxTimeline) * 100)}%`,
                        }}
                      />
                      <small>{showLabel ? formatBucket(item.bucket, data.timeline.bucketKind) : ''}</small>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No events in this period"
              detail="Choose a wider period to see this item's recorded activity."
              actionLabel="Open all rankings"
              actionTo="/rankings"
            />
          )}
        </Panel>

        <Panel title="Rank by period" kicker="Local observed-event position">
          <div className="detail-rank-grid">
            {data.rankings.map((ranking) => (
              <article key={ranking.period}>
                <span>{periodLabel(ranking.period)}</span>
                <strong>
                  {ranking.position ? `#${formatNumber(ranking.position)}` : '—'}
                </strong>
                <small>{formatNumber(ranking.events)} events</small>
              </article>
            ))}
          </div>
          <p className="detail-explainer">
            Positions are recalculated from local playback events for each window;
            they are not Spotify affinity rankings.
          </p>
        </Panel>
      </div>

      <div className="detail-related-grid">
        {data.related.map((section) => (
          <Panel
            key={section.title}
            title={section.title}
            kicker={`Connected to this ${data.type}`}
          >
            {section.items.length ? (
              <ul className="detail-related-list">
                {section.items.map((item) => (
                  <RelatedItem item={item} key={`${item.type}-${item.id}`} />
                ))}
              </ul>
            ) : (
              <p className="detail-explainer">No additional ledger records yet.</p>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Recent appearances" kicker="Latest observed playback events">
        <ol className="detail-event-list">
          {data.recentEvents.map((event) => (
            <li key={event.id}>
              {event.imageUrl ? (
                <Link to={detailPath('track', event.trackId)}>
                  <img src={event.imageUrl} alt="" />
                </Link>
              ) : (
                <span className="art-placeholder"><Disc3 size={18} /></span>
              )}
              <div>
                <Link to={detailPath('track', event.trackId)}>
                  {event.trackName}
                </Link>
                <span>
                  {event.primaryArtistId ? (
                    <Link to={detailPath('artist', event.primaryArtistId)}>
                      {event.artists}
                    </Link>
                  ) : (
                    event.artists
                  )}
                  {event.albumId && event.albumName && (
                    <>
                      <i aria-hidden="true">·</i>
                      <Link to={detailPath('album', event.albumId)}>
                        {event.albumName}
                      </Link>
                    </>
                  )}
                </span>
              </div>
              <time dateTime={event.playedAt}>{formatDateTime(event.playedAt)}</time>
              <SpotifyDesktopIconButton
                spotifyUri={event.spotifyUri}
                label={event.trackName}
              />
            </li>
          ))}
        </ol>
      </Panel>
    </>
  )
}
