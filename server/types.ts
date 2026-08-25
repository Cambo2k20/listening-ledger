export interface SpotifyArtist {
  id: string
  name: string
  uri: string
  external_urls?: { spotify?: string }
}

export interface SpotifyAlbum {
  id: string
  name: string
  uri: string
  images?: Array<{ url: string; height?: number; width?: number }>
  external_urls?: { spotify?: string }
}

export interface SpotifyTrack {
  id: string
  name: string
  uri: string
  duration_ms: number
  artists: SpotifyArtist[]
  album: SpotifyAlbum
  external_urls?: { spotify?: string }
}

export interface SpotifyPlayHistoryItem {
  track: SpotifyTrack
  played_at: string
  context?: { uri?: string; type?: string } | null
}

export interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope: string
  expires_in: number
  refresh_token?: string
}

export interface StoredToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scope: string
}

export interface TrendEvent {
  playedAt: string
  trackId: string
  trackName: string
  artistName: string
}

export type InsightKind =
  | 'new-obsession'
  | 'rising'
  | 'returning'
  | 'forgotten'

export interface TrendInsight {
  kind: InsightKind
  title: string
  subject: string
  detail: string
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

export interface LastFmCandidate {
  trackName: string
  artistName: string
  match: number
  seedKey: string
  seedLabel: string
}

export interface ResolvedDiscoveryCandidate {
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
}

export interface RankedDiscoveryCandidate extends ResolvedDiscoveryCandidate {
  score: number
  reason: string
  isNewArtist: boolean
  decision: DiscoveryFeedbackStatus
}

export interface DiscoveryCandidateRecord extends RankedDiscoveryCandidate {
  id: number
  position: number
}

export interface DiscoverySessionRecord {
  id: number
  createdAt: string
  mode: DiscoveryMode
  targetCount: number
  seeds: DiscoverySeed[]
  playlistId?: string
  playlistName?: string
  playlistUrl?: string
  savedAt?: string
  candidates: DiscoveryCandidateRecord[]
}

export interface SpotifyPlaybackDevice {
  id: string
  name: string
  type: string
  isActive: boolean
  isRestricted: boolean
  volumePercent?: number
  supportsVolume: boolean
}

export interface SpotifyPlayerTrack {
  spotifyTrackId: string
  spotifyUri: string
  trackName: string
  artistName: string
  albumName?: string
  imageUrl?: string
  spotifyUrl?: string
  durationMs: number
}

export interface SpotifyPlaybackState {
  isPlaying: boolean
  progressMs: number
  sampledAt: string
  device: SpotifyPlaybackDevice | null
  track: SpotifyPlayerTrack | null
}
