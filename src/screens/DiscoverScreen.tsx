import {
  Check,
  Disc3,
  ExternalLink,
  Eye,
  Heart,
  ListMusic,
  LoaderCircle,
  Music2,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, PageIntro, Panel, Skeleton } from '../components/Ui'
import { useAppContext } from '../context'
import { api } from '../lib/api'
import type {
  DiscoveryFeedbackStatus,
  DiscoveryMode,
  DiscoverySeed,
  DiscoverySeedSource,
  DiscoverySession,
  DiscoveryStatus,
} from '../types'
import { SpotifyDesktopTextLink } from '../components/SpotifyActions'

const sources: Array<{
  value: DiscoverySeedSource
  label: string
  detail: string
}> = [
  { value: 'ledger', label: 'Your ledger', detail: 'Most played locally' },
  { value: 'top', label: 'Spotify top', detail: 'Latest short-term snapshot' },
  { value: 'liked', label: 'Liked songs', detail: 'Needs library access' },
  { value: 'search', label: 'Search', detail: 'Any Spotify track' },
]

const modes: Array<{ value: DiscoveryMode; label: string; detail: string }> = [
  { value: 'safe', label: 'Safe', detail: 'Close matches, about 40% new artists' },
  { value: 'balanced', label: 'Balanced', detail: 'Strong match, about 70% new artists' },
  { value: 'wild', label: 'Wild', detail: 'Prioritises unfamiliar artists' },
]

function feedbackLabel(status: DiscoveryFeedbackStatus): string {
  if (status === 'love') return 'Loved'
  if (status === 'reject') return 'Rejected'
  if (status === 'known') return 'Already known'
  return 'Unreviewed'
}

export default function DiscoverScreen() {
  const { status: appStatus } = useAppContext()
  const [status, setStatus] = useState<DiscoveryStatus | null>(null)
  const [source, setSource] = useState<DiscoverySeedSource>('ledger')
  const [query, setQuery] = useState('')
  const [seeds, setSeeds] = useState<DiscoverySeed[]>([])
  const [selected, setSelected] = useState<DiscoverySeed[]>([])
  const [mode, setMode] = useState<DiscoveryMode>('balanced')
  const [session, setSession] = useState<DiscoverySession | null>(null)
  const [loadingSeeds, setLoadingSeeds] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)

  useEffect(() => {
    api<DiscoveryStatus>('/api/discovery/status')
      .then((result) => {
        setStatus(result)
        setSession(result.latestSession)
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Discovery status failed.')
      })
  }, [])

  useEffect(() => {
    if (!appStatus?.connected) {
      setLoadingSeeds(false)
      return
    }
    if (source === 'search' && query.trim().length < 2) {
      setSeeds([])
      setLoadingSeeds(false)
      return
    }
    const timeout = window.setTimeout(
      () => {
        setLoadingSeeds(true)
        setSeedError(null)
        const params = new URLSearchParams({ source })
        if (query.trim()) params.set('q', query.trim())
        api<{ items: DiscoverySeed[] }>(`/api/discovery/seeds?${params}`)
          .then((result) => setSeeds(result.items))
          .catch((caught) => {
            setSeeds([])
            setSeedError(caught instanceof Error ? caught.message : 'Seed lookup failed.')
          })
          .finally(() => setLoadingSeeds(false))
      },
      source === 'search' || source === 'ledger' ? 250 : 0,
    )
    return () => window.clearTimeout(timeout)
  }, [appStatus?.connected, query, source])

  const selectedIds = useMemo(
    () => new Set(selected.map((seed) => seed.spotifyTrackId)),
    [selected],
  )
  const keptCount =
    session?.candidates.filter(
      (candidate) => candidate.decision !== 'reject' && candidate.decision !== 'known',
    ).length ?? 0

  const selectSeed = (seed: DiscoverySeed) => {
    setSelected((current) => {
      if (current.some((item) => item.spotifyTrackId === seed.spotifyTrackId)) {
        return current.filter((item) => item.spotifyTrackId !== seed.spotifyTrackId)
      }
      return current.length < 5 ? [...current, seed] : current
    })
  }

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await api<DiscoverySession>('/api/discovery/generate', {
        method: 'POST',
        body: JSON.stringify({ seeds: selected, mode, targetCount: 20 }),
      })
      setSession(result)
      setPlaylistName('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Discovery failed.')
    } finally {
      setGenerating(false)
    }
  }

  const setFeedback = async (
    candidateId: number,
    current: DiscoveryFeedbackStatus,
    next: DiscoveryFeedbackStatus,
  ) => {
    setError(null)
    try {
      const result = await api<DiscoverySession | null>(
        `/api/discovery/candidates/${candidateId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: current === next ? 'neutral' : next }),
        },
      )
      if (result) setSession(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Feedback failed.')
    }
  }

  const savePlaylist = async () => {
    if (!session) return
    setSaving(true)
    setError(null)
    try {
      const result = await api<DiscoverySession>(
        `/api/discovery/sessions/${session.id}/playlist`,
        {
          method: 'POST',
          body: JSON.stringify({ name: playlistName }),
        },
      )
      setSession(result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Playlist save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!appStatus?.connected) {
    return (
      <>
        <PageIntro
          eyebrow="On-demand discovery"
          title="Find the next track worth keeping."
          description="Choose songs you already love, explore explainable matches, then review them before creating a private Spotify playlist."
        />
        <Panel title="Connect Spotify first" kicker="Discovery is ready">
          <EmptyState
            title="Spotify is not connected"
            detail="Discovery needs Spotify search to match Last.fm suggestions to playable tracks."
            actionLabel="Connect in settings"
          />
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageIntro
        eyebrow="On-demand discovery"
        title="Turn favourites into fresh finds."
        description="Last.fm finds related tracks, Spotify supplies the playable match, and your local ledger keeps familiar songs out. No AI training and no invented listening claims."
      />

      {(!status?.lastFmConfigured || Boolean(status?.missingScopes.length)) && (
        <div className="notice notice--warning discovery-notice">
          <Sparkles size={20} />
          <div>
            <strong>
              {!status?.lastFmConfigured
                ? 'Add your Last.fm API key before generating.'
                : 'Update Spotify access to unlock every source and playlist saving.'}
            </strong>
            <span>
              {!status?.lastFmConfigured
                ? 'Set LASTFM_API_KEY in .env.local, then restart the app.'
                : `Still needed: ${status?.missingScopes.join(', ')}`}
            </span>
          </div>
          <Link className="button button--quiet" to="/settings">
            Open settings
          </Link>
        </div>
      )}

      {error && (
        <div className="notice notice--warning">
          <X size={20} />
          <span>{error}</span>
        </div>
      )}

      <div className="discovery-layout">
        <Panel
          title="Choose 1–5 seed tracks"
          kicker="Step 1 · Start with what you love"
          className="discovery-seeds-panel"
          action={<span className="selection-count">{selected.length}/5 selected</span>}
        >
          <div className="seed-source-tabs" role="tablist" aria-label="Seed source">
            {sources.map((item) => {
              const disabled = item.value === 'liked' && status?.likedSeedsAvailable === false
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={source === item.value}
                  className={source === item.value ? 'active' : ''}
                  disabled={disabled}
                  title={disabled ? 'Reconnect Spotify to grant user-library-read.' : item.detail}
                  onClick={() => {
                    setSource(item.value)
                    setQuery('')
                  }}
                >
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </button>
              )
            })}
          </div>

          {(source === 'ledger' || source === 'search') && (
            <label className="search-field discovery-search">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  source === 'search'
                    ? 'Search Spotify by track or artist…'
                    : 'Filter your local ledger…'
                }
              />
            </label>
          )}

          {selected.length > 0 && (
            <div className="selected-seeds" aria-label="Selected seed tracks">
              {selected.map((seed) => (
                <button
                  key={seed.spotifyTrackId}
                  type="button"
                  onClick={() => selectSeed(seed)}
                  aria-label={`Remove ${seed.trackName}`}
                >
                  <span>{seed.trackName}</span>
                  <X size={13} />
                </button>
              ))}
            </div>
          )}

          {seedError ? (
            <p className="inline-error">{seedError}</p>
          ) : loadingSeeds ? (
            <Skeleton rows={5} />
          ) : seeds.length ? (
            <div className="seed-results">
              {seeds.map((seed) => {
                const isSelected = selectedIds.has(seed.spotifyTrackId)
                return (
                  <div
                    className={`seed-result-row ${isSelected ? 'selected' : ''}`}
                    key={seed.spotifyTrackId}
                  >
                    <SpotifyDesktopTextLink
                      spotifyUri={seed.spotifyUri}
                      label={seed.trackName}
                      className="seed-result-details"
                    >
                      {seed.imageUrl ? (
                        <img src={seed.imageUrl} alt="" />
                      ) : (
                        <span className="art-placeholder"><Disc3 size={17} /></span>
                      )}
                      <span>
                        <strong>{seed.trackName}</strong>
                        <small>{seed.artistName}</small>
                      </span>
                      {seed.events ? <em>{seed.events} events</em> : null}
                    </SpotifyDesktopTextLink>
                    <button
                      type="button"
                      className="seed-result-toggle"
                      onClick={() => selectSeed(seed)}
                      disabled={!isSelected && selected.length >= 5}
                      aria-pressed={isSelected}
                      aria-label={
                        isSelected
                          ? `Remove ${seed.trackName}`
                          : `Select ${seed.trackName}`
                      }
                    >
                      <i>{isSelected ? <Check size={16} /> : '+'}</i>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="compact-empty">
              <Music2 size={22} />
              <span>
                {source === 'search'
                  ? 'Type at least two characters to search Spotify.'
                  : 'No seed tracks are available from this source yet.'}
              </span>
            </div>
          )}
        </Panel>

        <Panel
          title="Set the distance"
          kicker="Step 2 · Control novelty"
          className="discovery-mode-panel"
        >
          <div className="mode-options">
            {modes.map((item) => (
              <button
                key={item.value}
                type="button"
                className={mode === item.value ? 'active' : ''}
                onClick={() => setMode(item.value)}
                aria-pressed={mode === item.value}
              >
                <span><i /> {item.label}</span>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
          <div className="generation-summary">
            <span><strong>20</strong> recommendations</span>
            <span><strong>2</strong> max per artist</span>
            <span><strong>0</strong> exact known tracks</span>
          </div>
          <button
            className="button button--primary discovery-generate"
            type="button"
            disabled={!selected.length || generating || !status?.lastFmConfigured}
            onClick={() => void generate()}
          >
            {generating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
            {generating ? 'Building matches…' : 'Build discovery set'}
          </button>
          <p className="method-note">
            Generated only when you ask. Similarity comes from Last.fm; availability
            and playlist creation come from Spotify.
          </p>
        </Panel>
      </div>

      {session && (
        <Panel
          title="Review the recommendations"
          kicker={`Step 3 · ${session.candidates.length} matches · ${session.mode} mode`}
          className="discovery-results-panel"
          action={<span className="selection-count">{keptCount} kept</span>}
        >
          <div className="discovery-results">
            {session.candidates.map((candidate) => (
              <article
                key={candidate.id}
                className={`discovery-result discovery-result--${candidate.decision}`}
              >
                <span className="result-position">
                  {String(candidate.position).padStart(2, '0')}
                </span>
                <SpotifyDesktopTextLink
                  spotifyUri={candidate.spotifyUri}
                  label={candidate.trackName}
                  className="spotify-desktop-art-link discovery-result-art-link"
                >
                  {candidate.imageUrl ? (
                    <img src={candidate.imageUrl} alt="" />
                  ) : (
                    <span className="art-placeholder art-placeholder--large">
                      <Disc3 size={20} />
                    </span>
                  )}
                </SpotifyDesktopTextLink>
                <div className="result-copy">
                  <div className="result-title-row">
                    <div>
                      <SpotifyDesktopTextLink
                        spotifyUri={candidate.spotifyUri}
                        label={candidate.trackName}
                      >
                        {candidate.trackName}
                      </SpotifyDesktopTextLink>
                      <SpotifyDesktopTextLink
                        spotifyUri={candidate.spotifyUri}
                        label={`${candidate.trackName} by ${candidate.artistName}`}
                        className="spotify-desktop-text-link--meta"
                      >
                        {candidate.artistName}
                        {candidate.albumName ? ` · ${candidate.albumName}` : ''}
                      </SpotifyDesktopTextLink>
                    </div>
                    <span className={candidate.isNewArtist ? 'new-artist' : 'deep-cut'}>
                      {candidate.isNewArtist ? 'New artist' : 'Familiar artist'}
                    </span>
                  </div>
                  <p>{candidate.reason}</p>
                  <small className="result-status">{feedbackLabel(candidate.decision)}</small>
                </div>
                <div className="feedback-actions" aria-label={`Review ${candidate.trackName}`}>
                  <button
                    className={candidate.decision === 'love' ? 'active love' : ''}
                    onClick={() => void setFeedback(candidate.id, candidate.decision, 'love')}
                    aria-pressed={candidate.decision === 'love'}
                    title="Love this recommendation"
                  >
                    <Heart size={15} /> <span>Love</span>
                  </button>
                  <button
                    className={candidate.decision === 'known' ? 'active known' : ''}
                    onClick={() => void setFeedback(candidate.id, candidate.decision, 'known')}
                    aria-pressed={candidate.decision === 'known'}
                    title="Mark as already known"
                  >
                    <Eye size={15} /> <span>I know it</span>
                  </button>
                  <button
                    className={candidate.decision === 'reject' ? 'active reject' : ''}
                    onClick={() => void setFeedback(candidate.id, candidate.decision, 'reject')}
                    aria-pressed={candidate.decision === 'reject'}
                    title="Reject this recommendation"
                  >
                    <X size={15} /> <span>Reject</span>
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="playlist-builder">
            <div>
              <span className="eyebrow">Step 4 · Private by default</span>
              <h3>{session.playlistId ? 'Playlist saved.' : 'Ready to keep the winners?'}</h3>
              <p>
                Rejected and already-known tracks stay in your local review history but
                will not be added to Spotify.
              </p>
            </div>
            {session.playlistUrl ? (
              <a
                className="button button--primary"
                href={session.playlistUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ListMusic size={17} /> Open {session.playlistName}
              </a>
            ) : (
              <div className="playlist-actions">
                <input
                  value={playlistName}
                  onChange={(event) => setPlaylistName(event.target.value)}
                  placeholder="Playlist name (optional)"
                  maxLength={100}
                  aria-label="Playlist name"
                />
                <button
                  className="button button--primary"
                  disabled={!keptCount || saving || !status?.playlistSaveAvailable}
                  onClick={() => void savePlaylist()}
                >
                  {saving ? <LoaderCircle className="spin" size={17} /> : <ListMusic size={17} />}
                  {saving ? 'Saving…' : `Save ${keptCount} to Spotify`}
                </button>
              </div>
            )}
          </div>

          <p className="attribution">
            Similar-track data provided by{' '}
            <a href="https://www.last.fm/" target="_blank" rel="noreferrer">
              Last.fm <ExternalLink size={11} />
            </a>
            . Spotify track matches remain Spotify content and are not used to train a model.
          </p>
        </Panel>
      )}
    </>
  )
}
