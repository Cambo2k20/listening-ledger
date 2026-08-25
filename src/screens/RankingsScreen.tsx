import { Disc3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageIntro, Panel, Skeleton } from '../components/Ui'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { RankingItem } from '../types'
import {
  SpotifyDestinationLinks,
  TrackPlayButton,
} from '../components/SpotifyActions'

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
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" />
                ) : (
                  <span className="art-placeholder art-placeholder--large">
                    <Disc3 size={20} />
                  </span>
                )}
                <div className="ranking-name">
                  {type === 'track' ? (
                    <span className="track-title-actions">
                      <TrackPlayButton spotifyUri={item.spotifyUri}>
                        {item.name}
                      </TrackPlayButton>
                      <SpotifyDestinationLinks
                        spotifyUri={item.spotifyUri}
                        spotifyUrl={item.spotifyUrl}
                        label={item.name}
                      />
                    </span>
                  ) : (
                    <span className="spotify-name-actions">
                      <span className="spotify-name-link">{item.name}</span>
                      <SpotifyDestinationLinks
                        spotifyUri={item.spotifyUri}
                        spotifyUrl={item.spotifyUrl}
                        label={item.name}
                      />
                    </span>
                  )}
                  <small>{item.artists || item.albumName || 'Primary artist'}</small>
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
