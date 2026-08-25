export interface Account {
  id: string
  displayName?: string
  spotifyUrl?: string
}

export interface AppStatus {
  configured: boolean
  connected: boolean
  account: Account | null
  redirectUri: string
  scopes: string[]
  grantedScopes: string[]
  missingScopes: string[]
  lastFmConfigured: boolean
}

export type DiscoveryMode = 'safe' | 'balanced' | 'wild'
export type ArtistDiveMode = 'close' | 'albums' | 'deep'
export type DiscoverySessionMode = DiscoveryMode | ArtistDiveMode
export type DiscoverySessionKind = 'related_tracks' | 'artist_dive'
export type DiscoveryRelationshipKind =
  | 'similar'
  | 'album'
  | 'catalog'
  | 'anchor'
export type DiscoverySeedSource = 'ledger' | 'top' | 'liked' | 'search'
export type DiscoveryFeedbackStatus = 'love' | 'reject' | 'known' | 'neutral'

export interface DiscoverySeed {
  spotifyTrackId: string
  spotifyUri: string
  trackName: string
  artistId?: string
  artistName: string
  albumId?: string
  albumUri?: string
  albumName?: string
  releaseDate?: string
  imageUrl?: string
  spotifyUrl?: string
  source: DiscoverySeedSource
  events?: number
}

export interface DiscoveryCandidate {
  id: number
  position: number
  spotifyTrackId: string
  spotifyUri: string
  trackName: string
  artistId?: string
  artistName: string
  albumId?: string
  albumUri?: string
  albumName?: string
  releaseDate?: string
  imageUrl?: string
  spotifyUrl?: string
  durationMs?: number
  match: number
  seedKeys: string[]
  seedLabels: string[]
  score: number
  reason: string
  relationshipKind: DiscoveryRelationshipKind
  isNewArtist: boolean
  isAnchor: boolean
  decision: DiscoveryFeedbackStatus
}

export interface DiscoverySession {
  id: number
  createdAt: string
  kind: DiscoverySessionKind
  mode: DiscoverySessionMode
  targetCount: number
  seeds: DiscoverySeed[]
  focusArtist?: {
    id: string
    name: string
    spotifyUri: string
    spotifyUrl?: string
    imageUrl?: string
  }
  playlistId?: string
  playlistName?: string
  playlistUrl?: string
  savedAt?: string
  candidates: DiscoveryCandidate[]
}

export interface ArtistDiveArtistOption {
  id: string
  name: string
  spotifyUri: string
  spotifyUrl?: string
  imageUrl?: string
  events: number
  activeDays: number
  distinctTracks: number
  topTwoShare: number
  topItemSignal: boolean
  lovedTrackSignal: boolean
  score: number
}

export interface ArtistDiveOptionsData {
  coverage: {
    activeDays: number
    requiredActiveDays: number
    ready: boolean
  }
  suggestions: ArtistDiveArtistOption[]
  items: ArtistDiveArtistOption[]
}

export interface ArtistDiveProfileData {
  artist: ArtistDiveArtistOption
  seeds: DiscoverySeed[]
}

export interface DiscoveryStatus {
  lastFmConfigured: boolean
  grantedScopes: string[]
  missingScopes: string[]
  likedSeedsAvailable: boolean
  playlistSaveAvailable: boolean
  latestSession: DiscoverySession | null
}

export interface PlaybackDevice {
  id: string
  name: string
  type: string
  isActive: boolean
  isRestricted: boolean
  volumePercent?: number
  supportsVolume: boolean
}

export interface PlayerTrack {
  spotifyTrackId: string
  spotifyUri: string
  trackName: string
  artistName: string
  albumName?: string
  imageUrl?: string
  spotifyUrl?: string
  durationMs: number
}

export interface PlaybackState {
  isPlaying: boolean
  progressMs: number
  sampledAt: string
  device: PlaybackDevice | null
  track: PlayerTrack | null
}

export interface DashboardData {
  period: string
  metrics: {
    events: number
    uniqueTracks: number
    activeDays: number
    verifiedStreams: number
  }
  coverage: { first: string | null; latest: string | null }
  topTracks: Array<{
    id: string
    name: string
    artists: string
    primaryArtistId?: string
    albumId?: string
    albumName?: string
    albumUri?: string
    imageUrl?: string
    spotifyUri: string
    spotifyUrl?: string
    events: number
  }>
  topArtists: Array<{
    id: string
    name: string
    spotifyUri: string
    spotifyUrl?: string
    events: number
  }>
  daily: Array<{ day: string; events: number }>
}

export interface HistoryItem {
  id: number
  playedAt: string
  trackName: string
  artists: string
  albumName?: string
  albumUri?: string
  imageUrl?: string
  spotifyUri: string
  spotifyUrl?: string
  contextUri?: string
}

export interface RankingItem {
  id: string
  name: string
  artists?: string
  primaryArtistId?: string
  albumId?: string
  albumName?: string
  albumUri?: string
  imageUrl?: string
  spotifyUri: string
  spotifyUrl?: string
  events: number
  lastPlayed?: string
}

export type DetailEntityType = 'track' | 'artist' | 'album'
export type DetailPeriod = '7d' | '30d' | '90d' | 'all'

export interface DetailReference {
  type: DetailEntityType
  id: string
  name: string
  spotifyUri: string
  spotifyUrl?: string
  imageUrl?: string
  detail?: string
  events?: number
  position?: number
}

export interface EntityDetailData {
  type: DetailEntityType
  period: DetailPeriod
  entity: {
    id: string
    name: string
    spotifyUri: string
    spotifyUrl?: string
    imageUrl?: string
    durationMs?: number
    artists: Array<DetailReference & { position: number }>
    album: DetailReference | null
  }
  summary: {
    events: number
    activeDays: number
    firstPlayed: string | null
    lastPlayed: string | null
  }
  timeline: {
    bucketKind: 'day' | 'week' | 'month'
    items: Array<{ bucket: string; events: number }>
  }
  rankings: Array<{
    period: DetailPeriod
    position: number | null
    events: number
  }>
  related: Array<{
    title: string
    items: DetailReference[]
  }>
  recentEvents: Array<{
    id: number
    playedAt: string
    trackId: string
    trackName: string
    spotifyUri: string
    albumId?: string
    albumName?: string
    imageUrl?: string
    artists: string
    primaryArtistId?: string
  }>
}

export interface TrendInsight {
  kind: 'new-obsession' | 'rising' | 'returning' | 'forgotten'
  title: string
  subject: string
  detail: string
}

export interface TrendsData {
  state: 'insufficient' | 'ready'
  insights: TrendInsight[]
  heatmap: Array<{ day: number; hour: number; events: number }>
  eventCount: number
}

export interface RecordsAppearance {
  type: DetailEntityType
  id: string
  name: string
  spotifyUri: string
  spotifyUrl?: string
  imageUrl?: string
  detail?: string
  firstPlayed: string
  events: number
}

export interface RecordsData {
  source: 'observed'
  rediscoveryGapDays: number
  summary: {
    totalEvents: number
    activeDays: number
    firstEvent: string | null
    latestEvent: string | null
    bestDay: {
      day: string
      events: number
      tiedDays: number
    } | null
  }
  streaks: {
    current: {
      days: number
      startDay: string | null
      endDay: string | null
      state: 'active' | 'grace' | 'ended'
    }
    longest: {
      days: number
      startDay: string | null
      endDay: string | null
    }
  }
  milestones: {
    achieved: Array<{ value: number; reachedAt: string }>
    next: {
      value: number
      remaining: number
      progress: number
    } | null
  }
  rediscoveries: Array<{
    eventId: number
    returnedAt: string
    previousPlayedAt: string
    gapDays: number
    artistId: string
    artistName: string
    spotifyUri: string
    spotifyUrl?: string
    trackId: string
    trackName: string
    imageUrl?: string
  }>
  firstAppearances: {
    tracks: RecordsAppearance[]
    artists: RecordsAppearance[]
    albums: RecordsAppearance[]
  }
  verifiedListening: {
    importBatchCount: number
    totalMsPlayed: number
    streamCount: number
    highestDay: { day: string; msPlayed: number } | null
  } | null
}

export interface HealthData {
  connected: boolean
  configured: boolean
  latestSync: {
    kind: 'recent' | 'top'
    startedAt: string
    completedAt?: string
    status: 'running' | 'success' | 'failed'
    importedEvents: number
    message?: string
  } | null
  lastSuccessAt: string | null
  risk: 'not-started' | 'healthy' | 'attention' | 'elevated'
  counts: { observed: number; verified: number; failures: number }
  databasePath: string
  targetSyncIntervalMinutes: number
}
