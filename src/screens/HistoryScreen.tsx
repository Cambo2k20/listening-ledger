import { Disc3, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState, PageIntro, Panel, Skeleton } from '../components/Ui'
import { api } from '../lib/api'
import { formatDateTime } from '../lib/format'
import type { HistoryItem } from '../types'

export default function HistoryScreen() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoading(true)
      api<{ items: HistoryItem[] }>(
        `/api/history?q=${encodeURIComponent(query)}&limit=200`,
      )
        .then((result) => setItems(result.items))
        .finally(() => setLoading(false))
    }, 180)
    return () => window.clearTimeout(timeout)
  }, [query])

  return (
    <>
      <PageIntro
        eyebrow="Chronological record"
        title="Every event Spotify returned."
        description="Search the local ledger by track, artist, or album. Times are shown in your current timezone."
      />
      <Panel
        title="Observed history"
        kicker={`${items.length} visible event${items.length === 1 ? '' : 's'}`}
        action={
          <label className="search-field">
            <Search size={17} />
            <input
              type="search"
              placeholder="Search your ledger"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        }
      >
        {loading ? (
          <Skeleton rows={6} />
        ) : items.length ? (
          <div className="history-list">
            {items.map((item) => (
              <article key={item.id}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" />
                ) : (
                  <span className="art-placeholder art-placeholder--large">
                    <Disc3 size={21} />
                  </span>
                )}
                <div className="history-track">
                  <a href={item.spotifyUrl} target="_blank" rel="noreferrer">
                    {item.trackName}
                  </a>
                  <small>{item.artists}</small>
                </div>
                <span className="history-album">{item.albumName}</span>
                <time dateTime={item.playedAt}>{formatDateTime(item.playedAt)}</time>
                <span className="observed-pill">Observed</span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={query ? 'Nothing matches that search' : 'No playback events yet'}
            detail={
              query
                ? 'Try a track, artist, or album name.'
                : 'Connect Spotify and sync to create the first entry.'
            }
          />
        )}
      </Panel>
    </>
  )
}

