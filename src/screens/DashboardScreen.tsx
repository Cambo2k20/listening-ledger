import {
  Activity,
  CalendarDays,
  Clock3,
  Disc3,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppContext } from '../context'
import { api } from '../lib/api'
import {
  formatDuration,
  formatNumber,
  formatUtcDate,
} from '../lib/format'
import type { DashboardData, SourceCoverage } from '../types'
import {
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  Skeleton,
} from '../components/Ui'
import { SpotifyDesktopIconButton } from '../components/SpotifyActions'
import { detailPath } from '../lib/routes'

const periods = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All recorded' },
]

function coverageRange(coverage?: SourceCoverage): string {
  if (!coverage?.first || !coverage.latest) return 'No coverage yet'
  return `${formatUtcDate(coverage.first)} – ${formatUtcDate(coverage.latest)}`
}

export default function DashboardScreen() {
  const { status, syncMessage } = useAppContext()
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setData(null)
    setError(null)
    api<DashboardData>(`/api/dashboard?period=${period}`)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error ? reason.message : 'Dashboard data could not be loaded.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [period, syncMessage])

  const maxDaily = useMemo(
    () => Math.max(1, ...(data?.daily.map((item) => item.events) ?? [1])),
    [data],
  )

  return (
    <>
      <PageIntro
        eyebrow="Your listening, kept honestly"
        title="A record you can trust."
        description="Playback events Spotify has actually returned—stored locally, deduplicated, and never passed off as verified streams."
        actions={
          <div className="segmented-control" aria-label="Dashboard period">
            {periods.map((option) => (
              <button
                key={option.value}
                className={period === option.value ? 'active' : ''}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {!status?.configured && (
        <div className="notice notice--setup">
          <ShieldCheck size={21} />
          <div>
            <strong>Local app ready. Spotify setup still required.</strong>
            <span>
              Add the developer app Client ID to begin recording your history.
            </span>
          </div>
          <Link to="/settings" className="button button--primary">
            Finish setup
          </Link>
        </div>
      )}

      {error ? (
        <Panel title="Dashboard unavailable" kicker="Local ledger">
          <EmptyState
            title="The dashboard endpoint did not respond"
            detail={error}
            actionLabel="Check data health"
            actionTo="/health"
          />
        </Panel>
      ) : (
        <>
          <div className="metric-grid">
        <MetricCard
          label="Observed events"
          value={loading ? '—' : formatNumber(data?.metrics.events ?? 0)}
          detail="Recently Played · selected period"
          icon={Radio}
          tone="lime"
        />
        <MetricCard
          label="Verified streams"
          value={loading ? '—' : formatNumber(data?.metrics.verifiedStreams ?? 0)}
          detail="Imported plays lasting at least 30 seconds"
          icon={ShieldCheck}
          tone="violet"
        />
        <MetricCard
          label="Verified time"
          value={
            loading
              ? '—'
              : data?.metrics.verifiedTimeMs === null
                ? 'Locked'
                : formatDuration(data?.metrics.verifiedTimeMs ?? 0)
          }
          detail={
            loading
              ? 'Loading selected period'
              : data?.metrics.verifiedTimeMs === null
                ? 'Unlocks after a qualifying history import'
                : 'Sum of imported msPlayed values'
          }
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="Combined coverage"
          value={loading ? '—' : formatNumber(data?.metrics.combinedActiveDays ?? 0)}
          detail="Active dates only · event totals stay separate"
          icon={CalendarDays}
        />
          </div>

          <div className="dashboard-grid">
        <Panel
          title="Source coverage"
          kicker="All-time source dates · cautious union"
          className="source-coverage-panel"
        >
          {loading ? (
            <Skeleton rows={3} />
          ) : (
            <div className="source-coverage-grid">
            <article>
              <span className="coverage-source-label coverage-source-label--observed">
                Observed
              </span>
              <strong>
                {formatNumber(data?.coverage.observed.activeDays ?? 0)} active days
              </strong>
              <small>{coverageRange(data?.coverage.observed)}</small>
              <p>Playback events captured through Spotify Recently Played.</p>
            </article>
            <article>
              <span className="coverage-source-label coverage-source-label--verified">
                Verified
              </span>
              <strong>
                {formatNumber(data?.coverage.verified.activeDays ?? 0)} active days
              </strong>
              <small>{coverageRange(data?.coverage.verified)}</small>
              <p>Imported Spotify plays lasting at least 30 seconds.</p>
            </article>
            <article>
              <span className="coverage-source-label coverage-source-label--combined">
                Combined coverage
              </span>
              <strong>
                {formatNumber(data?.coverage.combined.activeDays ?? 0)} active days
              </strong>
              <small>{coverageRange(data?.coverage.combined)}</small>
              <p>
                Observed dates and qualifying imported dates are unioned; play counts
                and time are never added together.
              </p>
            </article>
            </div>
          )}
        </Panel>

        <Panel
          title="Playback pulse"
          kicker="Last 14 days"
          className="pulse-panel"
          action={
            <span className="source-badge">
              <i /> Observed
            </span>
          }
        >
          {loading ? (
            <Skeleton rows={3} />
          ) : data?.daily.length ? (
            <div className="bar-chart" aria-label="Recorded events by day">
              {data.daily.map((item) => (
                <div className="bar-column" key={item.day}>
                  <span className="bar-value">{item.events}</span>
                  <i
                    style={{
                      height: `${Math.max(8, (item.events / maxDaily) * 100)}%`,
                    }}
                  />
                  <small>
                    {new Intl.DateTimeFormat('en-GB', {
                      weekday: 'short',
                    }).format(new Date(`${item.day}T12:00:00`))}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Your ledger is waiting"
              detail="Connect Spotify and run the first sync to turn this blank pulse into your listening record."
            />
          )}
          <div className="coverage-line">
            <span>
              <Activity size={15} /> First record
              <strong>
                {data?.coverage.first ? formatUtcDate(data.coverage.first) : '—'}
              </strong>
            </span>
            <span>
              Latest record
              <strong>
                {data?.coverage.latest ? formatUtcDate(data.coverage.latest) : '—'}
              </strong>
            </span>
          </div>
        </Panel>

        <Panel
          title="Top tracks"
          kicker={periods.find((item) => item.value === period)?.label}
          action={
            <Link to="/rankings" className="text-link">
              Full ranking
            </Link>
          }
        >
          {loading ? (
            <Skeleton rows={5} />
          ) : data?.topTracks.length ? (
            <ol className="rank-list rank-list--compact">
              {data.topTracks.map((track, index) => (
                <li key={track.id}>
                  <span className="rank-number">{index + 1}</span>
                  <Link
                    to={detailPath('track', track.id)}
                    className="ledger-art-link"
                    aria-label={`Open ${track.name} track detail`}
                  >
                    {track.imageUrl ? (
                      <img src={track.imageUrl} alt="" />
                    ) : (
                      <span className="art-placeholder">
                        <Disc3 size={18} />
                      </span>
                    )}
                  </Link>
                  <div>
                    <Link
                      to={detailPath('track', track.id)}
                      className="ledger-name-link"
                    >
                      {track.name}
                    </Link>
                    <span className="overview-track-meta">
                      {track.primaryArtistId ? (
                        <Link to={detailPath('artist', track.primaryArtistId)}>
                          {track.artists}
                        </Link>
                      ) : (
                        <span>{track.artists}</span>
                      )}
                      {track.albumName && (
                        <>
                          <i aria-hidden="true">·</i>
                          {track.albumId ? (
                            <Link to={detailPath('album', track.albumId)}>
                              {track.albumName}
                            </Link>
                          ) : (
                            <span>{track.albumName}</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  <strong>{track.events}</strong>
                  <SpotifyDesktopIconButton
                    spotifyUri={track.spotifyUri}
                    label={track.name}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No ranking yet"
              detail="Top tracks appear once at least one playback event has been recorded."
            />
          )}
        </Panel>

        <Panel
          title="Top artists"
          kicker="Primary artist"
          className="artists-panel"
        >
          {loading ? (
            <Skeleton rows={5} />
          ) : data?.topArtists.length ? (
            <ol className="artist-bars">
              {data.topArtists.map((artist, index) => (
                <li key={artist.id}>
                  <div>
                    <span>{index + 1}</span>
                    <Link
                      to={detailPath('artist', artist.id)}
                      className="ledger-name-link"
                    >
                      {artist.name}
                    </Link>
                    <strong>{artist.events}</strong>
                    <SpotifyDesktopIconButton
                      spotifyUri={artist.spotifyUri}
                      label={artist.name}
                    />
                  </div>
                  <i>
                    <span
                      style={{
                        width: `${(artist.events / (data.topArtists[0]?.events || 1)) * 100}%`,
                      }}
                    />
                  </i>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="Artists will surface here"
              detail="The ledger needs recorded events before it can rank your artists."
            />
          )}
        </Panel>
          </div>
        </>
      )}
    </>
  )
}
