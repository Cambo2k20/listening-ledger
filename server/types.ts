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
  album_type?: 'album' | 'single' | 'compilation'
  album_group?: 'album' | 'single' | 'compilation' | 'appears_on'
  release_date?: string
  total_tracks?: number
  artists?: SpotifyArtist[]
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
}

export interface RankedDiscoveryCandidate extends ResolvedDiscoveryCandidate {
  score: number
  reason: string
  relationshipKind: DiscoveryRelationshipKind
  isNewArtist: boolean
  isAnchor: boolean
  decision: DiscoveryFeedbackStatus
}

export interface DiscoveryCandidateRecord extends RankedDiscoveryCandidate {
  id: number
  position: number
}

export interface DiscoverySessionRecord {
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
  candidates: DiscoveryCandidateRecord[]
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

export interface ArtistCatalogTrack extends ResolvedDiscoveryCandidate {
  artistId: string
  albumId: string
  albumUri: string
  albumName: string
  releaseDate?: string
  albumType: 'album' | 'single'
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
