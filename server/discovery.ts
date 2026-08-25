import { config } from './config.ts'
import {
  createDiscoverySession,
  getArtistDiveArtist,
  getArtistDiveOptions,
  getArtistDiveSeeds,
  getArtistKnownAlbumIds,
  getCachedArtistCatalog,
  getCachedDiscoveryTrack,
  getDiscoveryFeedbackMap,
  getDiscoveryPlaylistTracks,
  getDiscoverySession,
  getKnownDiscoveryCatalog,
  getLedgerDiscoverySeeds,
  markDiscoveryPlaylistSaved,
  saveCachedDiscoveryTrack,
  saveCachedArtistCatalog,
  saveDiscoveryCandidates,
  setDiscoveryFeedback,
} from './db.ts'
import {
  createArtistDiveAnchor,
  orderArtistDivePlaylist,
  rankArtistDiveCandidates,
} from './lib/artist-dive.ts'
import {
  aggregateLastFmCandidates,
  isUnwantedVariant,
  normalizeDiscoveryText,
  rankDiscoveryCandidates,
} from './lib/discovery-ranking.ts'
import { getLastFmSimilarTracks } from './lastfm.ts'
import {
  createPrivateSpotifyPlaylist,
  getGrantedSpotifyScopes,
  getLikedSpotifyTracks,
  getMissingSpotifyScopes,
  getSpotifyTopTracks,
  getSpotifyArtistCatalog,
  hasSpotifyScopes,
  resolveSpotifyTrack,
  searchSpotifyTracks,
} from './spotify.ts'
import type {
  ArtistDiveMode,
  DiscoveryFeedbackStatus,
  DiscoveryMode,
  DiscoverySeed,
  DiscoverySeedSource,
  DiscoverySessionRecord,
  ResolvedDiscoveryCandidate,
} from './types.ts'

const generationLimit = 20
const seedLimit = 5
const artistDiveTargetCount = 12
const artistDiveMinimumRecommendations = 8

export function getDiscoveryStatus(): Record<string, unknown> {
  return {
    lastFmConfigured: Boolean(config.lastFmApiKey),
    grantedScopes: getGrantedSpotifyScopes(),
    missingScopes: getMissingSpotifyScopes(),
    likedSeedsAvailable: hasSpotifyScopes(['user-library-read']),
    playlistSaveAvailable: hasSpotifyScopes(['playlist-modify-private']),
    latestSession: getDiscoverySession(),
  }
}

export async function getDiscoverySeeds(
  source: DiscoverySeedSource,
  query = '',
): Promise<DiscoverySeed[]> {
  if (source === 'ledger') return getLedgerDiscoverySeeds(query, 30)
  if (source === 'top') return getSpotifyTopTracks()
  if (source === 'liked') return getLikedSpotifyTracks()
  return searchSpotifyTracks(query, 'search')
}

export function getArtistDiveArtistOptions(query = ''): Record<string, unknown> {
  return getArtistDiveOptions(query, 30)
}

export function getArtistDiveProfile(artistId: string): Record<string, unknown> {
  const artist = getArtistDiveArtist(artistId)
  if (!artist) throw new Error('This artist has not appeared in your ledger.')
  return { artist, seeds: getArtistDiveSeeds(artistId, 20) }
}

function validateSeeds(seeds: DiscoverySeed[]): DiscoverySeed[] {
  const unique = new Map<string, DiscoverySeed>()
  for (const seed of seeds) {
    if (
      !seed.spotifyTrackId?.trim() ||
      !seed.spotifyUri?.trim() ||
      !seed.trackName?.trim() ||
      !seed.artistName?.trim()
    ) {
      continue
    }
    unique.set(seed.spotifyTrackId, {
      ...seed,
      trackName: seed.trackName.trim(),
      artistName: seed.artistName.trim(),
    })
  }
  return [...unique.values()].slice(0, seedLimit)
}

export async function generateDiscoverySession(input: {
  seeds: DiscoverySeed[]
  mode: DiscoveryMode
  targetCount?: number
}): Promise<DiscoverySessionRecord> {
  if (!config.lastFmApiKey) {
    throw new Error('LASTFM_API_KEY is not configured.')
  }
  if (!['safe', 'balanced', 'wild'].includes(input.mode)) {
    throw new Error('Discovery mode must be safe, balanced, or wild.')
  }
  const seeds = validateSeeds(input.seeds)
  if (!seeds.length) throw new Error('Select at least one seed track.')
  const targetCount = Math.min(
    Math.max(Math.floor(input.targetCount ?? generationLimit), 1),
    generationLimit,
  )
  const similarLists = await Promise.all(
    seeds.map((seed) => getLastFmSimilarTracks(seed)),
  )
  const aggregated = aggregateLastFmCandidates(similarLists.flat())
  const known = getKnownDiscoveryCatalog()
  const feedback = getDiscoveryFeedbackMap()
  const candidatesToResolve = aggregated
    .filter((candidate) => {
      const decision = feedback.get(candidate.key)
      return (
        !known.trackKeys.has(candidate.key) &&
        decision !== 'reject' &&
        decision !== 'known' &&
        !isUnwantedVariant(candidate.trackName)
      )
    })
    .sort((left, right) => {
      const leftNew = known.artistKeys.has(normalizeDiscoveryText(left.artistName))
        ? 0
        : 1
      const rightNew = known.artistKeys.has(normalizeDiscoveryText(right.artistName))
        ? 0
        : 1
      const noveltyBias =
        input.mode === 'wild' ? rightNew - leftNew : input.mode === 'safe' ? leftNew - rightNew : 0
      return (
        noveltyBias ||
        right.seedKeys.length - left.seedKeys.length ||
        right.match - left.match
      )
    })
    .slice(0, 32)

  const resolved: ResolvedDiscoveryCandidate[] = []
  for (const candidate of candidatesToResolve) {
    const cached = getCachedDiscoveryTrack(candidate.key)
    const spotifyTrack =
      cached ??
      (await resolveSpotifyTrack(candidate.trackName, candidate.artistName))
    if (!spotifyTrack) continue
    if (!cached) saveCachedDiscoveryTrack(candidate.key, spotifyTrack)
    resolved.push({
      ...spotifyTrack,
      match: candidate.match,
      seedKeys: candidate.seedKeys,
      seedLabels: candidate.seedLabels,
    })
    if (resolved.length >= targetCount * 2) break
  }

  const ranked = rankDiscoveryCandidates({
    candidates: resolved,
    mode: input.mode,
    limit: targetCount,
    knownTrackIds: known.trackIds,
    knownTrackKeys: known.trackKeys,
    knownArtists: known.artistKeys,
    feedback,
  })
  if (!ranked.length) {
    throw new Error(
      'No unfamiliar Spotify matches were found for those seeds. Try a different seed or discovery mode.',
    )
  }
  const sessionId = createDiscoverySession(input.mode, targetCount, seeds)
  saveDiscoveryCandidates(sessionId, ranked)
  const session = getDiscoverySession(sessionId)
  if (!session) throw new Error('The discovery session could not be saved.')
  return session
}

export async function generateArtistDiveSession(input: {
  artistId: string
  seedTrackIds: string[]
  mode: ArtistDiveMode
  includeFavorites?: boolean
  targetCount?: number
}): Promise<DiscoverySessionRecord> {
  if (!config.lastFmApiKey) {
    throw new Error('LASTFM_API_KEY is not configured.')
  }
  if (!['close', 'albums', 'deep'].includes(input.mode)) {
    throw new Error('Artist dive mode must be close, albums, or deep.')
  }
  const artistId = input.artistId.trim()
  const artist = getArtistDiveArtist(artistId)
  if (!artist) throw new Error('This artist has not appeared in your ledger.')

  const availableSeeds = getArtistDiveSeeds(artistId, 50)
  const requestedIds = new Set(
    input.seedTrackIds.map((id) => id.trim()).filter(Boolean).slice(0, 3),
  )
  const seeds = availableSeeds.filter((seed) => requestedIds.has(seed.spotifyTrackId))
  if (!seeds.length) {
    throw new Error('Select at least one recorded track by this artist.')
  }

  const targetCount = Math.min(
    Math.max(Math.floor(input.targetCount ?? artistDiveTargetCount), 8),
    generationLimit,
  )
  let catalog = getCachedArtistCatalog(artistId)
  if (!catalog) {
    catalog = await getSpotifyArtistCatalog(artistId)
    saveCachedArtistCatalog(artistId, catalog)
  }

  const similarLists = await Promise.all(
    seeds.map((seed) => getLastFmSimilarTracks(seed)),
  )
  const similarCandidates = aggregateLastFmCandidates(similarLists.flat()).filter(
    (candidate) =>
      normalizeDiscoveryText(candidate.artistName) ===
      normalizeDiscoveryText(artist.name),
  )
  const known = getKnownDiscoveryCatalog()
  const feedback = getDiscoveryFeedbackMap()
  const knownAlbumIds = getArtistKnownAlbumIds(artistId)
  const ranked = rankArtistDiveCandidates({
    catalog,
    seeds,
    similarCandidates,
    mode: input.mode,
    limit: generationLimit,
    knownTrackIds: known.trackIds,
    knownTrackKeys: known.trackKeys,
    knownAlbumIds,
    feedback,
  })
  if (ranked.length < artistDiveMinimumRecommendations) {
    const artistSentence = /[.!?]$/.test(artist.name) ? artist.name : `${artist.name}.`
    throw new Error(
      `Artist Deep Dive needs at least ${artistDiveMinimumRecommendations} unheard studio tracks. Only ${ranked.length} eligible track${ranked.length === 1 ? ' was' : 's were'} found for ${artistSentence}`,
    )
  }

  const anchors =
    input.includeFavorites === false
      ? []
      : seeds.slice(0, 2).map((seed) => createArtistDiveAnchor(seed, artistId))
  const candidates = orderArtistDivePlaylist(ranked, anchors, targetCount)
  const focusArtist = {
    id: artist.id,
    name: artist.name,
    spotifyUri: artist.spotifyUri,
    spotifyUrl: artist.spotifyUrl,
    imageUrl: artist.imageUrl,
  }
  const sessionId = createDiscoverySession(input.mode, targetCount, seeds, {
    kind: 'artist_dive',
    focusArtist,
  })
  saveDiscoveryCandidates(sessionId, candidates)
  const session = getDiscoverySession(sessionId)
  if (!session) throw new Error('The Artist Deep Dive session could not be saved.')
  return session
}

export function updateDiscoveryFeedback(
  candidateId: number,
  status: DiscoveryFeedbackStatus,
): DiscoverySessionRecord | null {
  if (!['love', 'reject', 'known', 'neutral'].includes(status)) {
    throw new Error('Unknown discovery feedback status.')
  }
  setDiscoveryFeedback(candidateId, status)
  return getDiscoverySession()
}

export async function saveDiscoveryPlaylist(
  sessionId: number,
  requestedName?: string,
): Promise<DiscoverySessionRecord> {
  const session = getDiscoverySession(sessionId)
  if (!session) throw new Error('Discovery session not found.')
  const tracks = getDiscoveryPlaylistTracks(sessionId)
  if (!tracks.length) {
    throw new Error('Keep at least one recommendation before saving the playlist.')
  }
  const defaultName = `Listening Ledger discoveries ${new Date().toISOString().slice(0, 10)}`
  const artistDiveName = session.focusArtist
    ? `${session.focusArtist.name} — Beyond the favourites`
    : defaultName
  const name =
    requestedName?.trim().slice(0, 100) ||
    (session.kind === 'artist_dive' ? artistDiveName : defaultName)
  const description =
    session.kind === 'artist_dive' && session.focusArtist
      ? `An explainable ${session.focusArtist.name} deep dive built from your local Listening Ledger, Last.fm track relationships, and Spotify catalogue metadata.`
      : 'Built from your Listening Ledger seeds using Last.fm similarity, then matched on Spotify.'
  const playlist = await createPrivateSpotifyPlaylist(
    name,
    description,
    tracks.map((track) => track.spotifyUri),
  )
  markDiscoveryPlaylistSaved(sessionId, playlist)
  const saved = getDiscoverySession(sessionId)
  if (!saved) throw new Error('The saved playlist could not be recorded.')
  return saved
}
