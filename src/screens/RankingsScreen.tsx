import { Disc3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageIntro, Panel, Skeleton } from '../components/Ui'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { RankingItem } from '../types'
import { SpotifyDesktopTextLink } from '../components/SpotifyActions'

const types = ['track', 'artist', 'album'] as const
const periods = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All recorded'],
] as const

export default function RankingsScreen() {
  const [type, setType] = useState<(typeof types)[number]>('track')
  const [period, setPeriod] = useState('30d')
  const [items, setItems] = useState<RankingItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api<{ items: RankingItem[] }>(
      `/api/rankings?type=${type}&period=${period}`,
    )
      .then((result) => setItems(result.items))
      .finally(() => setLoading(false))
  }, [type, period])

  return (
    <>
      <PageIntro
        eyebrow="Local rankings"
        title="The repeat players."
        description="Ranked from recorded playback events—not Spotify affinity scores and not estimated streams."
        actions={
          <select
            className="select-field"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="Ranking period"
          >
            {periods.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        }
      />
      <Panel
        title={`${type[0].toUpperCase()}${type.slice(1)} ranking`}
        kicker="Observed playback events"
        action={
          <div className="tab-control">
            {types.map((item) => (
              <button
                key={item}
                onClick={() => setType(item)}
                className={type === item ? 'active' : ''}
              >
                {item}s
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <Skeleton rows={7} />
        ) : items.length ? (
          <ol className="ranking-table">
            {items.map((item, index) => (
              <li key={item.id}>
                <span className="ranking-position">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <SpotifyDesktopTextLink
                  spotifyUri={item.spotifyUri}
                  label={item.name}
                  className="spotify-desktop-art-link"
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" />
                  ) : (
                    <span className="art-placeholder art-placeholder--large">
                      <Disc3 size={20} />
                    </span>
                  )}
                </SpotifyDesktopTextLink>
                <div className="ranking-name">
                  <SpotifyDesktopTextLink
                    spotifyUri={item.spotifyUri}
                    label={item.name}
                    className="spotify-name-link"
                  >
                    {item.name}
                  </SpotifyDesktopTextLink>
                  {(item.artists || item.albumName) && (
                    <span className="ranking-detail-links">
                      {item.artists && (
                        <SpotifyDesktopTextLink
                          spotifyUri={item.spotifyUri}
                          label={`${item.name} by ${item.artists}`}
                          className="spotify-desktop-text-link--meta"
                        >
                          {item.artists}
                        </SpotifyDesktopTextLink>
                      )}
                      {type === 'track' && item.albumName && (
                        <>
                          <i aria-hidden="true">·</i>
                          <SpotifyDesktopTextLink
                            spotifyUri={item.albumUri ?? item.spotifyUri}
                            label={item.albumName}
                            className="spotify-desktop-text-link--meta"
                          >
                            {item.albumName}
                          </SpotifyDesktopTextLink>
                        </>
                      )}
                    </span>
                  )}
                </div>
                <span className="ranking-last">
                  {item.lastPlayed ? formatDateTime(item.lastPlayed) : '—'}
                </span>
                <strong>{item.events}</strong>
                <small className="ranking-unit">events</small>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="Nothing to rank yet"
            detail="Once Spotify is connected, recorded events will build this table automatically."
          />
        )}
      </Panel>
    </>
  )
}
