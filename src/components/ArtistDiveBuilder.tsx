import {
  Check,
  Disc3,
  LibraryBig,
  LoaderCircle,
  LockKeyhole,
  Music2,
  Search,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type {
  ArtistDiveArtistOption,
  ArtistDiveMode,
  ArtistDiveOptionsData,
  ArtistDiveProfileData,
  DiscoverySession,
} from '../types'
import { Panel, Skeleton } from './Ui'

const diveModes: Array<{
  value: ArtistDiveMode
  label: string
  detail: string
}> = [
  {
    value: 'close',
    label: 'Close',
    detail: 'Prioritise direct Last.fm track relationships and familiar albums.',
  },
  {
    value: 'albums',
    label: 'Across albums',
    detail: 'Balance close matches with unheard tracks from across the catalogue.',
  },
  {
    value: 'deep',
    label: 'Deep cuts',
    detail: 'Prefer unheard albums and spread the playlist more widely.',
  },
]

function ArtistArtwork({ artist }: { artist: ArtistDiveArtistOption }) {
  return artist.imageUrl ? (
    <img src={artist.imageUrl} alt="" />
  ) : (
    <span className="art-placeholder"><Disc3 size={18} /></span>
  )
}

function countLabel(value: number, label: string): string {
  return `${value} ${label}${value === 1 ? '' : 's'}`
}

export function ArtistDiveBuilder({
  initialArtistId,
  lastFmConfigured,
  onArtistChange,
  onGenerated,
  onError,
}: {
  initialArtistId?: string
  lastFmConfigured: boolean
  onArtistChange: (artistId: string) => void
  onGenerated: (session: DiscoverySession) => void
  onError: (message: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<ArtistDiveOptionsData | null>(null)
  const [profile, setProfile] = useState<ArtistDiveProfileData | null>(null)
  const [selectedSeedIds, setSelectedSeedIds] = useState<string[]>([])
  const [mode, setMode] = useState<ArtistDiveMode>('albums')
  const [includeFavorites, setIncludeFavorites] = useState(true)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => {
      setLoadingOptions(true)
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      api<ArtistDiveOptionsData>(`/api/discovery/artists?${params}`)
        .then((result) => {
          if (active) setOptions(result)
        })
        .catch((caught: unknown) => {
          if (active) {
            onError(caught instanceof Error ? caught.message : 'Artist lookup failed.')
          }
        })
        .finally(() => {
          if (active) setLoadingOptions(false)
        })
    }, query.trim() ? 250 : 0)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [onError, query])

  useEffect(() => {
    if (!initialArtistId || profile?.artist.id === initialArtistId) return
    let active = true
    setLoadingProfile(true)
    onError(null)
    api<ArtistDiveProfileData>(
      `/api/discovery/artists/${encodeURIComponent(initialArtistId)}`,
    )
      .then((result) => {
        if (!active) return
        setProfile(result)
        setSelectedSeedIds(result.seeds.slice(0, 3).map((seed) => seed.spotifyTrackId))
      })
      .catch((caught: unknown) => {
        if (active) {
          onError(caught instanceof Error ? caught.message : 'Artist lookup failed.')
        }
      })
      .finally(() => {
        if (active) setLoadingProfile(false)
      })
    return () => {
      active = false
    }
  }, [initialArtistId, onError, profile?.artist.id])

  const selectedSeedSet = useMemo(() => new Set(selectedSeedIds), [selectedSeedIds])

  const chooseArtist = async (artistId: string) => {
    setLoadingProfile(true)
    onError(null)
    try {
      const result = await api<ArtistDiveProfileData>(
        `/api/discovery/artists/${encodeURIComponent(artistId)}`,
      )
      setProfile(result)
      setSelectedSeedIds(result.seeds.slice(0, 3).map((seed) => seed.spotifyTrackId))
      onArtistChange(artistId)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Artist lookup failed.')
    } finally {
      setLoadingProfile(false)
    }
  }

  const toggleSeed = (spotifyTrackId: string) => {
    setSelectedSeedIds((current) => {
      if (current.includes(spotifyTrackId)) {
        return current.filter((id) => id !== spotifyTrackId)
      }
      return current.length < 3 ? [...current, spotifyTrackId] : current
    })
  }

  const generate = async () => {
    if (!profile) return
    setGenerating(true)
    onError(null)
    try {
      const session = await api<DiscoverySession>('/api/discovery/artist-dive', {
        method: 'POST',
        body: JSON.stringify({
          artistId: profile.artist.id,
          seedTrackIds: selectedSeedIds,
          mode,
          includeFavorites,
          targetCount: 12,
        }),
      })
      onGenerated(session)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Artist Deep Dive failed.')
    } finally {
      setGenerating(false)
    }
  }

  const coverage = options?.coverage
  const coveragePercent = coverage
    ? Math.min((coverage.activeDays / coverage.requiredActiveDays) * 100, 100)
    : 0

  return (
    <div className="artist-dive-layout">
      <Panel
        title="Choose an artist"
        kicker="Step 1 · Find an underexplored favourite"
        className="artist-picker-panel"
      >
        {coverage && (
          <div className={`artist-coverage ${coverage.ready ? 'ready' : ''}`}>
            <div>
              {coverage.ready ? <Sparkles size={18} /> : <LockKeyhole size={18} />}
              <span>
                <strong>
                  {coverage.ready ? 'Automatic suggestions unlocked' : 'Suggestions are still learning'}
                </strong>
                <small>
                  {coverage.activeDays} of {coverage.requiredActiveDays} active listening days recorded.
                  Manual artist selection works now.
                </small>
              </span>
            </div>
            <i><span style={{ width: `${coveragePercent}%` }} /></i>
          </div>
        )}

        {coverage?.ready && (
          <div className="artist-suggestion-section">
            <span className="field-label">Suggested from your ledger</span>
            {options?.suggestions.length ? (
              <div className="artist-suggestion-grid">
                {options.suggestions.map((artist) => (
                  <button
                    type="button"
                    key={artist.id}
                    className={profile?.artist.id === artist.id ? 'active' : ''}
                    onClick={() => void chooseArtist(artist.id)}
                  >
                    <ArtistArtwork artist={artist} />
                    <span>
                      <strong>{artist.name}</strong>
                      <small>
                        {countLabel(artist.distinctTracks, 'track')} · {countLabel(artist.events, 'event')}
                      </small>
                    </span>
                    <em>{artist.score}</em>
                  </button>
                ))}
              </div>
            ) : (
              <p className="artist-list-note">No artist currently meets every suggestion rule. Browse manually below.</p>
            )}
          </div>
        )}

        <label className="search-field discovery-search artist-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search artists in your local ledger…"
          />
        </label>

        {loadingOptions ? (
          <Skeleton rows={5} />
        ) : options?.items.length ? (
          <div className="artist-option-list">
            {options.items.map((artist) => (
              <button
                type="button"
                key={artist.id}
                className={profile?.artist.id === artist.id ? 'active' : ''}
                onClick={() => void chooseArtist(artist.id)}
              >
                <ArtistArtwork artist={artist} />
                <span>
                  <strong>{artist.name}</strong>
                  <small>
                    {countLabel(artist.events, 'observed event')} · {countLabel(artist.distinctTracks, 'recorded track')}
                  </small>
                </span>
                <em>{Math.round(artist.topTwoShare * 100)}% in top two</em>
              </button>
            ))}
          </div>
        ) : (
          <div className="compact-empty">
            <Music2 size={22} />
            <span>No recorded artist matches that search.</span>
          </div>
        )}
      </Panel>

      <Panel
        title={profile ? `Build a ${profile.artist.name} deep dive` : 'Build the deep dive'}
        kicker="Step 2 · Shape the catalogue journey"
        className="artist-dive-controls"
        action={profile ? <span className="selection-count">{selectedSeedIds.length}/3 seeds</span> : undefined}
      >
        {loadingProfile ? (
          <Skeleton rows={5} />
        ) : profile ? (
          <>
            <div className="artist-dive-focus">
              <ArtistArtwork artist={profile.artist} />
              <div>
                <span className="eyebrow">Your focus artist</span>
                <h3>{profile.artist.name}</h3>
                <p>
                  {countLabel(profile.artist.events, 'observed event')} across{' '}
                  {countLabel(profile.artist.distinctTracks, 'track')} and{' '}
                  {countLabel(profile.artist.activeDays, 'active day')}.
                </p>
              </div>
            </div>

            <div className="artist-seed-section">
              <div className="artist-section-heading">
                <span className="field-label">Songs to build from</span>
                <small>Select up to three recorded favourites.</small>
              </div>
              <div className="artist-seed-list">
                {profile.seeds.map((seed) => {
                  const selected = selectedSeedSet.has(seed.spotifyTrackId)
                  return (
                    <button
                      type="button"
                      key={seed.spotifyTrackId}
                      className={selected ? 'active' : ''}
                      onClick={() => toggleSeed(seed.spotifyTrackId)}
                      disabled={!selected && selectedSeedIds.length >= 3}
                      aria-pressed={selected}
                    >
                      {seed.imageUrl ? (
                        <img src={seed.imageUrl} alt="" />
                      ) : (
                        <span className="art-placeholder"><Disc3 size={16} /></span>
                      )}
                      <span>
                        <strong>{seed.trackName}</strong>
                        <small>{seed.albumName ?? profile.artist.name}</small>
                      </span>
                      {seed.events ? <em>{countLabel(seed.events, 'event')}</em> : null}
                      <i>{selected ? <Check size={14} /> : '+'}</i>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="artist-mode-section">
              <span className="field-label">How far should it travel?</span>
              <div className="mode-options artist-mode-options">
                {diveModes.map((item) => (
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
            </div>

            <label className="artist-anchor-option">
              <input
                type="checkbox"
                checked={includeFavorites}
                onChange={(event) => setIncludeFavorites(event.target.checked)}
              />
              <span>
                <strong>Add familiar anchors</strong>
                <small>Place up to two selected favourites among the unheard tracks.</small>
              </span>
            </label>

            <div className="generation-summary artist-generation-summary">
              <span><strong>12</strong> playlist tracks</span>
              <span><strong>{includeFavorites ? 'Up to 2' : '0'}</strong> familiar anchors</span>
              <span><strong>8+</strong> unheard tracks required</span>
            </div>
            <button
              type="button"
              className="button button--primary discovery-generate"
              disabled={!selectedSeedIds.length || generating || !lastFmConfigured}
              onClick={() => void generate()}
            >
              {generating ? <LoaderCircle className="spin" size={17} /> : <LibraryBig size={17} />}
              {generating ? 'Exploring the catalogue…' : `Build ${profile.artist.name} playlist`}
            </button>
            <p className="method-note">
              Album and single tracks come from Spotify. Only direct Last.fm track results are labelled
              similar; catalogue picks make no similarity claim.
            </p>
          </>
        ) : (
          <div className="artist-dive-empty">
            <span><LibraryBig size={28} /></span>
            <h3>Pick an artist from your ledger</h3>
            <p>Then choose the songs you already like and decide how deeply to explore their studio catalogue.</p>
          </div>
        )}
      </Panel>
    </div>
  )
}
