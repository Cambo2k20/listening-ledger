import type {
  DiscoveryFeedbackStatus,
  DiscoveryMode,
  LastFmCandidate,
  RankedDiscoveryCandidate,
  ResolvedDiscoveryCandidate,
} from '../types.ts'

const variantPattern =
  /\b(live|remaster(?:ed)?|acoustic|demo|instrumental|karaoke|sped up|slowed|radio edit|edit|version|mix)\b/i

export function normalizeDiscoveryText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function discoveryTrackKey(artistName: string, trackName: string): string {
  return `${normalizeDiscoveryText(artistName)}::${normalizeDiscoveryText(trackName)}`
}

export function isUnwantedVariant(trackName: string): boolean {
  return variantPattern.test(trackName)
}

export interface AggregatedLastFmCandidate {
  key: string
  trackName: string
  artistName: string
  match: number
  seedKeys: string[]
  seedLabels: string[]
}

export function aggregateLastFmCandidates(
  candidates: LastFmCandidate[],
): AggregatedLastFmCandidate[] {
  const grouped = new Map<
    string,
    AggregatedLastFmCandidate & { seeds: Map<string, string> }
  >()

  for (const candidate of candidates) {
    if (!candidate.trackName.trim() || !candidate.artistName.trim()) continue
    const key = discoveryTrackKey(candidate.artistName, candidate.trackName)
    const existing = grouped.get(key) ?? {
      key,
      trackName: candidate.trackName.trim(),
      artistName: candidate.artistName.trim(),
      match: 0,
      seedKeys: [],
      seedLabels: [],
      seeds: new Map<string, string>(),
    }
    existing.match = Math.max(existing.match, Math.max(0, candidate.match))
    existing.seeds.set(candidate.seedKey, candidate.seedLabel)
    grouped.set(key, existing)
  }

  return [...grouped.values()]
    .map(({ seeds, ...candidate }) => ({
      ...candidate,
      seedKeys: [...seeds.keys()],
      seedLabels: [...seeds.values()],
    }))
    .sort(
      (left, right) =>
        right.seedKeys.length - left.seedKeys.length ||
        right.match - left.match ||
        left.artistName.localeCompare(right.artistName),
    )
}

const weights: Record<
  DiscoveryMode,
  { similarity: number; overlap: number; newArtist: number; newTrack: number }
> = {
  safe: { similarity: 58, overlap: 22, newArtist: 8, newTrack: 12 },
  balanced: { similarity: 42, overlap: 20, newArtist: 26, newTrack: 12 },
  wild: { similarity: 28, overlap: 15, newArtist: 45, newTrack: 12 },
}

const newArtistTargets: Record<DiscoveryMode, number> = {
  safe: 0.4,
  balanced: 0.7,
  wild: 0.9,
}

export function rankDiscoveryCandidates({
  candidates,
  mode,
  limit,
  knownTrackIds,
  knownTrackKeys,
  knownArtists,
  feedback,
}: {
  candidates: ResolvedDiscoveryCandidate[]
  mode: DiscoveryMode
  limit: number
  knownTrackIds: Set<string>
  knownTrackKeys: Set<string>
  knownArtists: Set<string>
  feedback: Map<string, DiscoveryFeedbackStatus>
}): RankedDiscoveryCandidate[] {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 50)
  const scoring = weights[mode]
  const unique = new Map<string, ResolvedDiscoveryCandidate>()

  for (const candidate of candidates) {
    const key = discoveryTrackKey(candidate.artistName, candidate.trackName)
    const decision =
      feedback.get(candidate.spotifyTrackId) ?? feedback.get(key) ?? 'neutral'
    if (
      knownTrackIds.has(candidate.spotifyTrackId) ||
      knownTrackKeys.has(key) ||
      decision === 'reject' ||
      decision === 'known' ||
      isUnwantedVariant(candidate.trackName)
    ) {
      continue
    }
    const current = unique.get(candidate.spotifyTrackId)
    if (!current || candidate.seedKeys.length > current.seedKeys.length) {
      unique.set(candidate.spotifyTrackId, candidate)
    }
  }

  const ranked = [...unique.values()]
    .map((candidate): RankedDiscoveryCandidate => {
      const artistKey = normalizeDiscoveryText(candidate.artistName)
      const isNewArtist = !knownArtists.has(artistKey)
      const overlapRatio = Math.min(candidate.seedKeys.length / 3, 1)
      const match = Math.min(Math.max(candidate.match, 0), 1)
      const decision =
        feedback.get(candidate.spotifyTrackId) ??
        feedback.get(discoveryTrackKey(candidate.artistName, candidate.trackName)) ??
        'neutral'
      const loveBonus = decision === 'love' ? 4 : 0
      const score = Math.round(
        match * scoring.similarity +
          overlapRatio * scoring.overlap +
          (isNewArtist ? scoring.newArtist : 0) +
          scoring.newTrack +
          loveBonus,
      )
      const sourceText = candidate.seedLabels.slice(0, 2).join(' and ')
      const relationship = `${
        candidate.seedLabels.length > 1
          ? `Connected to ${candidate.seedLabels.length} selected seeds, including ${sourceText}`
          : `Similar to ${sourceText}`
      }`
      const reason = `${relationship.endsWith('.') ? relationship : `${relationship}.`} ${
        isNewArtist
          ? 'This artist has not appeared in your ledger.'
          : 'A deeper cut from an artist already in your ledger.'
      }`
      return { ...candidate, score, reason, isNewArtist, decision }
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.seedKeys.length - left.seedKeys.length ||
        right.match - left.match,
    )

  const selected: RankedDiscoveryCandidate[] = []
  const selectedIds = new Set<string>()
  const artistCounts = new Map<string, number>()
  const newArtistGoal = Math.ceil(boundedLimit * newArtistTargets[mode])

  const addCandidate = (candidate: RankedDiscoveryCandidate): boolean => {
    if (selectedIds.has(candidate.spotifyTrackId)) return false
    const artistKey = normalizeDiscoveryText(candidate.artistName)
    if ((artistCounts.get(artistKey) ?? 0) >= 2) return false
    selected.push(candidate)
    selectedIds.add(candidate.spotifyTrackId)
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1)
    return true
  }

  for (const candidate of ranked) {
    if (selected.length >= newArtistGoal) break
    if (candidate.isNewArtist) addCandidate(candidate)
  }
  for (const candidate of ranked) {
    if (selected.length >= boundedLimit) break
    addCandidate(candidate)
  }

  return selected.map((candidate) => ({
    ...candidate,
    score: Math.min(candidate.score, 100),
  }))
}
