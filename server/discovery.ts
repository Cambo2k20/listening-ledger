import { config } from './config.ts'
import {
  createDiscoverySession,
  getCachedDiscoveryTrack,
  getDiscoveryFeedbackMap,
  getDiscoveryPlaylistTracks,
  getDiscoverySession,
  getKnownDiscoveryCatalog,
  getLedgerDiscoverySeeds,
  markDiscoveryPlaylistSaved,
  saveCachedDiscoveryTrack,
  saveDiscoveryCandidates,
  setDiscoveryFeedback,
} from './db.ts'
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
  hasSpotifyScopes,
  resolveSpotifyTrack,
  searchSpotifyTracks,
} from './spotify.ts'
import type {
  DiscoveryFeedbackStatus,
  DiscoveryMode,
  DiscoverySeed,
  DiscoverySeedSource,
  DiscoverySessionRecord,
  ResolvedDiscoveryCandidate,
} from './types.ts'

const generationLimit = 20
const seedLimit = 5

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
  const name = requestedName?.trim().slice(0, 100) || defaultName
  const playlist = await createPrivateSpotifyPlaylist(
    name,
    'Built from your Listening Ledger seeds using Last.fm similarity, then matched on Spotify.',
    tracks.map((track) => track.spotifyUri),
  )
  markDiscoveryPlaylistSaved(sessionId, playlist)
  const saved = getDiscoverySession(sessionId)
  if (!saved) throw new Error('The saved playlist could not be recorded.')
  return saved
}
