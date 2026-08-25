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
    imageUrl?: string
    spotifyUrl?: string
    events: number
  }>
  topArtists: Array<{
    id: string
    name: string
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
  imageUrl?: string
  spotifyUrl?: string
  contextUri?: string
}

export interface RankingItem {
  id: string
  name: string
  artists?: string
  albumName?: string
  imageUrl?: string
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
}

