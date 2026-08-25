import {
  Album as AlbumIcon,
  CalendarDays,
  Clock3,
  Disc3,
  Flame,
  Flag,
  Music2,
  Radio,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SpotifyDesktopIconButton } from '../components/SpotifyActions'
import {
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  Skeleton,
} from '../components/Ui'
import { useAppContext } from '../context'
import { api } from '../lib/api'
import { formatDate, formatNumber } from '../lib/format'
import { detailPath } from '../lib/routes'
import type {
  DetailEntityType,
  RecordsAppearance,
  RecordsData,
} from '../types'

type AppearanceGroup = keyof RecordsData['firstAppearances']

const appearanceTabs: Array<{ value: AppearanceGroup; label: string }> = [
  { value: 'tracks', label: 'Tracks' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
]

function formatLedgerDay(value?: string | null): string {
  if (!value) return 'Not recorded yet'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`))
}

function formatDayRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return 'No active-day run recorded'
  if (start === end) return formatLedgerDay(start)
  return `${formatLedgerDay(start)} – ${formatLedgerDay(end)}`
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${formatNumber(hours)}h ${minutes}m`
}

function pluralDays(days: number): string {
  return `${formatNumber(days)} day${days === 1 ? '' : 's'}`
}

function AppearancePlaceholder({ type }: { type: DetailEntityType }) {
  if (type === 'artist') return <UserRound size={19} />
  if (type === 'album') return <AlbumIcon size={19} />
  return <Disc3 size={19} />
}

function appearanceCopy(item: RecordsAppearance): string {
  return item.detail || `${formatNumber(item.events)} recorded events`
}

export default function RecordsScreen() {
  const { syncMessage } = useAppContext()
  const [data, setData] = useState<RecordsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appearanceGroup, setAppearanceGroup] =
    useState<AppearanceGroup>('tracks')

  useEffect(() => {
    setLoading(true)
    api<RecordsData>('/api/records')
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error ? reason.message : 'Records could not be loaded.',
        )
      })
      .finally(() => setLoading(false))
  }, [syncMessage])

  const appearances = useMemo(
    () => data?.firstAppearances[appearanceGroup] ?? [],
    [appearanceGroup, data],
  )
  const achievedMilestones = data?.milestones.achieved.slice(-6).reverse() ?? []
  const currentStreakDetail = (() => {
    const current = data?.streaks.current
    if (!current || current.state === 'ended') {
      return data?.summary.latestEvent
        ? `Last event ${formatDate(data.summary.latestEvent)}`
        : 'No active-day run yet'
    }
    if (current.state === 'grace') return 'Continues if you listen today'
    return current.days === 1
      ? 'Started today'
      : `Since ${formatLedgerDay(current.startDay)}`
  })()

  return (
    <>
      <PageIntro
        eyebrow="Records & milestones"
        title="The standout moments in your ledger."
        description="Streaks, peak days, returns, and landmark events calculated from recorded playback timestamps—not estimated listening time."
        actions={
          <span className="source-badge">
            <i /> Observed events
          </span>
        }
      />

      {error ? (
        <Panel title="Records unavailable" kicker="Local ledger">
          <EmptyState
            title="The records endpoint did not respond"
            detail={error}
            actionLabel="Check data health"
            actionTo="/health"
          />
        </Panel>
      ) : !loading && data?.summary.totalEvents === 0 ? (
        <Panel title="No records yet" kicker="Observed-event ledger">
          <EmptyState
            title="Your first milestone is waiting"
            detail="Record one playback event to start streaks, first appearances, and the milestone timeline."
            actionLabel="View listening history"
            actionTo="/history"
          />
        </Panel>
      ) : (
        <>
          <div className="metric-grid records-metric-grid">
            <MetricCard
              label="Current streak"
              value={loading ? '—' : pluralDays(data?.streaks.current.days ?? 0)}
              detail={currentStreakDetail}
              icon={Flame}
              tone="lime"
            />
            <MetricCard
              label="Longest streak"
              value={loading ? '—' : pluralDays(data?.streaks.longest.days ?? 0)}
              detail={formatDayRange(
                data?.streaks.longest.startDay,
                data?.streaks.longest.endDay,
              )}
              icon={Trophy}
              tone="violet"
            />
            <MetricCard
              label="Highest-event day"
              value={
                loading
                  ? '—'
                  : formatNumber(data?.summary.bestDay?.events ?? 0)
              }
              detail={
                data?.summary.bestDay
                  ? `${formatLedgerDay(data.summary.bestDay.day)}${
                      data.summary.bestDay.tiedDays > 1
                        ? ` · tied on ${data.summary.bestDay.tiedDays} days`
                        : ''
                    }`
                  : 'No peak day yet'
              }
              icon={CalendarDays}
              tone="amber"
            />
            <MetricCard
              label="Active days"
              value={loading ? '—' : formatNumber(data?.summary.activeDays ?? 0)}
              detail={`${formatNumber(data?.summary.totalEvents ?? 0)} observed events`}
              icon={Radio}
            />
          </div>

          <div className="records-grid">
            <Panel
              title="Event milestones"
              kicker="Cumulative observed events"
              className="records-milestones-panel"
            >
              {loading ? (
                <Skeleton rows={4} />
              ) : (
                <>
                  {data?.milestones.next && (
                    <div className="record-next-milestone">
                      <span>
                        <Flag size={22} />
                      </span>
                      <div>
                        <small>Next landmark</small>
                        <strong>
                          {formatNumber(data.milestones.next.value)} events
                        </strong>
                        <p>
                          {formatNumber(data.milestones.next.remaining)} to go
                        </p>
                      </div>
                      <em>
                        {Math.round(data.milestones.next.progress * 100)}%
                      </em>
                      <i
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={data.milestones.next.value}
                        aria-valuenow={data.summary.totalEvents}
                        aria-label={`${Math.round(
                          data.milestones.next.progress * 100,
                        )}% progress to the next event milestone`}
                      >
                        <span
                          style={{
                            width: `${Math.min(
                              100,
                              data.milestones.next.progress * 100,
                            )}%`,
                          }}
                        />
                      </i>
                    </div>
                  )}
                  <ol className="record-milestone-list">
                    {achievedMilestones.map((milestone) => (
                      <li key={milestone.value}>
                        <span>
                          <Trophy size={16} />
                        </span>
                        <div>
                          <strong>
                            {formatNumber(milestone.value)} event milestone
                          </strong>
                          <small>Reached {formatDate(milestone.reachedAt)}</small>
                        </div>
                        <time dateTime={milestone.reachedAt}>
                          {new Intl.DateTimeFormat('en-GB', {
                            month: 'short',
                            year: 'numeric',
                          }).format(new Date(milestone.reachedAt))}
                        </time>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Panel>

            <Panel
              title="Rediscoveries"
              kicker={`Artist returns after ${data?.rediscoveryGapDays ?? 90}+ days`}
              className="records-rediscoveries-panel"
            >
              {loading ? (
                <Skeleton rows={5} />
              ) : data?.rediscoveries.length ? (
                <ol className="record-rediscovery-list">
                  {data.rediscoveries.map((item) => (
                    <li key={item.eventId}>
                      <div className="record-rediscovery-main">
                        <Link
                          to={detailPath('artist', item.artistId)}
                          className="record-rediscovery-art"
                          aria-label={`Open ${item.artistName} artist detail`}
                        >
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt="" />
                          ) : (
                            <span className="art-placeholder">
                              <UserRound size={18} />
                            </span>
                          )}
                        </Link>
                        <div>
                          <small>{formatNumber(item.gapDays)}-day return</small>
                          <Link to={detailPath('artist', item.artistId)}>
                            <strong>{item.artistName}</strong>
                          </Link>
                          <span>
                            Back with{' '}
                            <Link to={detailPath('track', item.trackId)}>
                              {item.trackName}
                            </Link>
                          </span>
                        </div>
                      </div>
                      <time dateTime={item.returnedAt}>
                        {formatDate(item.returnedAt)}
                      </time>
                      <SpotifyDesktopIconButton
                        spotifyUri={item.spotifyUri}
                        label={item.artistName}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="record-inline-empty">
                  <Sparkles size={25} />
                  <strong>No 90-day returns yet</strong>
                  <p>
                    A rediscovery appears when a primary artist returns after at
                    least 90 days without a recorded event.
                  </p>
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title="First appearances"
            kicker="Newest additions to the ledger"
            className="records-first-panel"
            action={
              <div className="tab-control" aria-label="First appearance type">
                {appearanceTabs.map((tab) => (
                  <button
                    key={tab.value}
                    className={appearanceGroup === tab.value ? 'active' : ''}
                    aria-pressed={appearanceGroup === tab.value}
                    onClick={() => setAppearanceGroup(tab.value)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            }
          >
            {loading ? (
              <Skeleton rows={6} />
            ) : (
              <ol className="record-appearance-list">
                {appearances.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={detailPath(item.type, item.id)}
                      className="record-appearance-link"
                    >
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" />
                      ) : (
                        <span className="art-placeholder">
                          <AppearancePlaceholder type={item.type} />
                        </span>
                      )}
                      <div>
                        <strong>{item.name}</strong>
                        <small>{appearanceCopy(item)}</small>
                      </div>
                    </Link>
                    <span className="record-event-count">
                      {formatNumber(item.events)} event
                      {item.events === 1 ? '' : 's'}
                    </span>
                    <time dateTime={item.firstPlayed}>
                      First seen {formatDate(item.firstPlayed)}
                    </time>
                    <SpotifyDesktopIconButton
                      spotifyUri={item.spotifyUri}
                      label={item.name}
                    />
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {data?.verifiedListening && (
            <Panel
              title="Verified listening records"
              kicker="Imported Extended Streaming History only"
              className="records-verified-panel"
            >
              <div className="metric-grid metric-grid--three">
                <MetricCard
                  label="Listening time"
                  value={formatDuration(data.verifiedListening.totalMsPlayed)}
                  detail={`${data.verifiedListening.importBatchCount} history import${
                    data.verifiedListening.importBatchCount === 1 ? '' : 's'
                  }`}
                  icon={Clock3}
                  tone="lime"
                />
                <MetricCard
                  label="Highest-time day"
                  value={
                    data.verifiedListening.highestDay
                      ? formatDuration(data.verifiedListening.highestDay.msPlayed)
                      : '0 min'
                  }
                  detail={formatLedgerDay(
                    data.verifiedListening.highestDay?.day,
                  )}
                  icon={Music2}
                  tone="violet"
                />
                <MetricCard
                  label="Verified streams"
                  value={formatNumber(data.verifiedListening.streamCount)}
                  detail="At least 30 seconds listened"
                  icon={ShieldCheck}
                  tone="amber"
                />
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  )
}
