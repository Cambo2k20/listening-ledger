import type {
  ArtistCatalogTrack,
  ArtistDiveMode,
  DiscoveryFeedbackStatus,
  DiscoverySeed,
  RankedDiscoveryCandidate,
} from '../types.ts'
import type { AggregatedLastFmCandidate } from './discovery-ranking.ts'
import {
  discoveryTrackKey,
  isUnwantedVariant,
  normalizeDiscoveryText,
} from './discovery-ranking.ts'

const modeWeights: Record<
  ArtistDiveMode,
  {
    similarity: number
    overlap: number
    sameAlbum: number
    unseenAlbum: number
    catalogue: number
  }
> = {
  close: {
    similarity: 68,
    overlap: 14,
    sameAlbum: 14,
    unseenAlbum: 2,
    catalogue: 2,
  },
  albums: {
    similarity: 42,
    overlap: 10,
    sameAlbum: 12,
    unseenAlbum: 28,
    catalogue: 8,
  },
  deep: {
    similarity: 25,
    overlap: 8,
    sameAlbum: 4,
    unseenAlbum: 42,
    catalogue: 14,
  },
}

function seedLabel(seed: DiscoverySeed): string {
  return `${seed.trackName} by ${seed.artistName}`
}

function catalogueReason(
  track: ArtistCatalogTrack,
  knownAlbumIds: Set<string>,
): string {
  return knownAlbumIds.has(track.albumId)
    ? `An unheard studio track from ${track.albumName}. No direct song-similarity claim is being made.`
    : `A studio track from ${track.albumName}, an album that has not appeared in your ledger.`
}

export function rankArtistDiveCandidates({
  catalog,
  seeds,
  similarCandidates,
  mode,
  limit,
  knownTrackIds,
  knownTrackKeys,
  knownAlbumIds,
  feedback,
}: {
  catalog: ArtistCatalogTrack[]
  seeds: DiscoverySeed[]
  similarCandidates: AggregatedLastFmCandidate[]
  mode: ArtistDiveMode
  limit: number
  knownTrackIds: Set<string>
  knownTrackKeys: Set<string>
  knownAlbumIds: Set<string>
  feedback: Map<string, DiscoveryFeedbackStatus>
}): RankedDiscoveryCandidate[] {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 20)
  const weights = modeWeights[mode]
  const similarByKey = new Map(
    similarCandidates.map((candidate) => [candidate.key, candidate]),
  )
  const seedsByAlbum = new Map<string, DiscoverySeed[]>()
  for (const seed of seeds) {
    if (!seed.albumId) continue
    const albumSeeds = seedsByAlbum.get(seed.albumId) ?? []
    albumSeeds.push(seed)
    seedsByAlbum.set(seed.albumId, albumSeeds)
  }

  const ranked = catalog
    .flatMap((track): RankedDiscoveryCandidate[] => {
      const key = discoveryTrackKey(track.artistName, track.trackName)
      const decision = feedback.get(track.spotifyTrackId) ?? feedback.get(key) ?? 'neutral'
      if (
        knownTrackIds.has(track.spotifyTrackId) ||
        knownTrackKeys.has(key) ||
        decision === 'reject' ||
        decision === 'known' ||
        isUnwantedVariant(track.trackName)
      ) {
        return []
      }

      const similar = similarByKey.get(key)
      const albumSeeds = seedsByAlbum.get(track.albumId) ?? []
      const albumIsKnown = knownAlbumIds.has(track.albumId)
      const relationshipKind = similar
        ? ('similar' as const)
        : albumSeeds.length
          ? ('album' as const)
          : ('catalog' as const)
      const relatedSeeds = similar
        ? {
            keys: similar.seedKeys,
            labels: similar.seedLabels,
          }
        : {
            keys: albumSeeds.map((seed) =>
              discoveryTrackKey(seed.artistName, seed.trackName),
            ),
            labels: albumSeeds.map(seedLabel),
          }
      const match = Math.min(Math.max(similar?.match ?? 0, 0), 1)
      const overlap = Math.min(relatedSeeds.keys.length / Math.max(seeds.length, 1), 1)
      const score = Math.round(
        match * weights.similarity +
          overlap * weights.overlap +
          (albumSeeds.length ? weights.sameAlbum : 0) +
          (!albumIsKnown ? weights.unseenAlbum : 0) +
          weights.catalogue +
          (decision === 'love' ? 4 : 0),
      )
      const comparedWith = relatedSeeds.labels.slice(0, 2).join(' and ')
      const reason = similar
        ? `Similar to ${comparedWith}. Last.fm returned this direct track relationship.`
        : albumSeeds.length
          ? `From ${track.albumName}, the same album as ${comparedWith}.`
          : catalogueReason(track, knownAlbumIds)

      return [
        {
          ...track,
          match,
          seedKeys: relatedSeeds.keys,
          seedLabels: relatedSeeds.labels,
          score: Math.min(score, 100),
          reason,
          relationshipKind,
          isNewArtist: false,
          isAnchor: false,
          decision,
        },
      ]
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.match - left.match ||
        left.albumName!.localeCompare(right.albumName!) ||
        left.trackName.localeCompare(right.trackName),
    )

  const selected: RankedDiscoveryCandidate[] = []
  const selectedIds = new Set<string>()
  const albumCounts = new Map<string, number>()
  const maxPerAlbum = mode === 'close' ? 3 : 2
  const add = (candidate: RankedDiscoveryCandidate): boolean => {
    if (selectedIds.has(candidate.spotifyTrackId)) return false
    const albumKey = candidate.albumId ?? candidate.albumName ?? 'unknown'
    if ((albumCounts.get(albumKey) ?? 0) >= maxPerAlbum) return false
    selected.push(candidate)
    selectedIds.add(candidate.spotifyTrackId)
    albumCounts.set(albumKey, (albumCounts.get(albumKey) ?? 0) + 1)
    return true
  }

  if (mode !== 'close') {
    const diverseGoal = Math.min(Math.ceil(boundedLimit / 2), boundedLimit)
    const representedAlbums = new Set<string>()
    for (const candidate of ranked) {
      if (selected.length >= diverseGoal) break
      const albumKey = candidate.albumId ?? candidate.albumName ?? 'unknown'
      if (representedAlbums.has(albumKey)) continue
      if (mode === 'deep' && knownAlbumIds.has(candidate.albumId ?? '')) continue
      if (add(candidate)) representedAlbums.add(albumKey)
    }
  }

  for (const candidate of ranked) {
    if (selected.length >= boundedLimit) break
    add(candidate)
  }
  return selected
}

export function createArtistDiveAnchor(
  seed: DiscoverySeed,
  focusArtistId: string,
): RankedDiscoveryCandidate {
  return {
    spotifyTrackId: seed.spotifyTrackId,
    spotifyUri: seed.spotifyUri,
    trackName: seed.trackName,
    artistId: seed.artistId ?? focusArtistId,
    artistName: seed.artistName,
    albumId: seed.albumId,
    albumUri: seed.albumUri,
    albumName: seed.albumName,
    releaseDate: seed.releaseDate,
    imageUrl: seed.imageUrl,
    spotifyUrl: seed.spotifyUrl,
    match: 1,
    seedKeys: [discoveryTrackKey(seed.artistName, seed.trackName)],
    seedLabels: [seedLabel(seed)],
    score: 100,
    reason: 'A familiar anchor selected from your strongest recorded tracks for this artist.',
    relationshipKind: 'anchor',
    isNewArtist: false,
    isAnchor: true,
    decision: 'neutral',
  }
}

export function orderArtistDivePlaylist(
  recommendations: RankedDiscoveryCandidate[],
  anchors: RankedDiscoveryCandidate[],
  limit: number,
): RankedDiscoveryCandidate[] {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 20)
  const result = recommendations.slice(0, Math.max(0, boundedLimit - anchors.length))
  if (anchors[0]) result.splice(0, 0, anchors[0])
  if (anchors[1]) result.splice(Math.min(4, result.length), 0, anchors[1])
  return result.slice(0, boundedLimit)
}

export function underexploredArtistScore(input: {
  events: number
  activeDays: number
  distinctTracks: number
  topTwoShare: number
  topItemSignal: boolean
  lovedTrackSignal: boolean
}): number {
  const eventStrength = Math.min(input.events / 20, 1)
  const repeatStrength = Math.min(input.activeDays / 5, 1)
  const narrowness = Math.max(0, 1 - Math.max(input.distinctTracks - 2, 0) / 5)
  return Math.round(
    eventStrength * 35 +
      repeatStrength * 20 +
      input.topTwoShare * 20 +
      narrowness * 15 +
      (input.topItemSignal ? 6 : 0) +
      (input.lovedTrackSignal ? 4 : 0),
  )
}

export function normalizedAlbumKey(value: string): string {
  return normalizeDiscoveryText(value)
    .replace(/\bfrom the original motion picture soundtrack\b.*$/g, '')
    .replace(/\boriginal motion picture soundtrack\b.*$/g, '')
    .replace(/\b(deluxe|expanded|anniversary|edition|remaster(?:ed)?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
