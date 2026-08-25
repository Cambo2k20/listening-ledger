import {
  Activity,
  CalendarDays,
  Disc3,
  Music2,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppContext } from '../context'
import { api } from '../lib/api'
import { formatDate, formatNumber } from '../lib/format'
import type { DashboardData } from '../types'
import {
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  Skeleton,
} from '../components/Ui'
import {
  SpotifyAppLink,
  TrackPlayButton,
} from '../components/SpotifyActions'

const periods = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All recorded' },
]

export default function DashboardScreen() {
  const { status, syncMessage } = useAppContext()
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api<DashboardData>(`/api/dashboard?period=${period}`)
      .then(setData)
      .finally(() => setLoading(false))
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

      <div className="metric-grid">
        <MetricCard
          label="Recorded events"
          value={formatNumber(data?.metrics.events ?? 0)}
          detail="Observed playback events"
          icon={Radio}
          tone="lime"
        />
        <MetricCard
          label="Unique tracks"
          value={formatNumber(data?.metrics.uniqueTracks ?? 0)}
          detail="Within this period"
          icon={Music2}
          tone="violet"
        />
        <MetricCard
          label="Active days"
          value={formatNumber(data?.metrics.activeDays ?? 0)}
          detail="Days with recorded activity"
          icon={CalendarDays}
          tone="amber"
        />
        <MetricCard
          label="Verified streams"
          value={formatNumber(data?.metrics.verifiedStreams ?? 0)}
          detail="Requires history import"
          icon={ShieldCheck}
        />
      </div>

      <div className="dashboard-grid">
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
              <strong>{formatDate(data?.coverage.first)}</strong>
            </span>
            <span>
              Latest record
              <strong>{formatDate(data?.coverage.latest)}</strong>
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
                  {track.imageUrl ? (
                    <img src={track.imageUrl} alt="" />
                  ) : (
                    <span className="art-placeholder">
                      <Disc3 size={18} />
                    </span>
                  )}
                  <div>
                    <span className="track-title-actions">
                      <TrackPlayButton spotifyUri={track.spotifyUri}>
                        {track.name}
                      </TrackPlayButton>
                      <SpotifyAppLink
                        spotifyUri={track.spotifyUri}
                        label={`Open ${track.name} in Spotify Desktop`}
                      />
                    </span>
                    <small>{track.artists}</small>
                  </div>
                  <strong>{track.events}</strong>
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
          {data?.topArtists.length ? (
            <ol className="artist-bars">
              {data.topArtists.map((artist, index) => (
                <li key={artist.id}>
                  <div>
                    <span>{index + 1}</span>
                    <SpotifyAppLink
                      spotifyUri={artist.spotifyUri}
                      label={`Open ${artist.name} in Spotify Desktop`}
                      className="spotify-name-link"
                    >
                      {artist.name}
                    </SpotifyAppLink>
                    <strong>{artist.events}</strong>
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
  )
}
