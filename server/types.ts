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

