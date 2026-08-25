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
export type DiscoverySeedSource = 'ledger' | 'top' | 'liked' | 'search'
export type DiscoveryFeedbackStatus = 'love' | 'reject' | 'known' | 'neutral'

export interface DiscoverySeed {
  spotifyTrackId: string
  spotifyUri: string
  trackName: string
  artistName: string
  albumName?: string
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
  artistName: string
  albumName?: string
  imageUrl?: string
  spotifyUrl?: string
  durationMs?: number
  match: number
  seedKeys: string[]
  seedLabels: string[]
  score: number
  reason: string
  isNewArtist: boolean
  decision: DiscoveryFeedbackStatus
}

export interface DiscoverySession {
  id: number
  createdAt: string
  mode: DiscoveryMode
  targetCount: number
  seeds: DiscoverySeed[]
  playlistId?: string
  playlistName?: string
  playlistUrl?: string
  savedAt?: string
  candidates: DiscoveryCandidate[]
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
  albumName?: string
  albumUri?: string
  imageUrl?: string
  spotifyUri: string
  spotifyUrl?: string
  events: number
  lastPlayed?: string
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
