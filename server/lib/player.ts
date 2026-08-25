import type {
  SpotifyPlaybackDevice,
  SpotifyPlaybackState,
  SpotifyTrack,
} from '../types.ts'

export interface RawSpotifyDevice {
  id?: string | null
  name?: string
  type?: string
  is_active?: boolean
  is_restricted?: boolean
  volume_percent?: number | null
  supports_volume?: boolean
}

export interface RawSpotifyPlaybackState {
  is_playing?: boolean
  progress_ms?: number | null
  device?: RawSpotifyDevice | null
  item?: SpotifyTrack | null
  currently_playing_type?: string
}

export function mapSpotifyDevice(
  device: RawSpotifyDevice,
): SpotifyPlaybackDevice | null {
  if (!device.id?.trim()) return null
  return {
    id: device.id,
    name: device.name?.trim() || 'Spotify device',
    type: device.type?.trim() || 'unknown',
    isActive: Boolean(device.is_active),
    isRestricted: Boolean(device.is_restricted),
    volumePercent:
      typeof device.volume_percent === 'number'
        ? Math.min(Math.max(Math.round(device.volume_percent), 0), 100)
        : undefined,
    supportsVolume: Boolean(device.supports_volume),
  }
}

export function mapSpotifyPlaybackState(
  state?: RawSpotifyPlaybackState | null,
  sampledAt = new Date().toISOString(),
): SpotifyPlaybackState {
  const item =
    state?.currently_playing_type === 'track' && state.item ? state.item : null
  const imageUrl = item
    ? [...(item.album.images ?? [])].sort(
        (left, right) => (left.width ?? 0) - (right.width ?? 0),
      )[0]?.url
    : undefined
  return {
    isPlaying: Boolean(state?.is_playing && item),
    progressMs: item
      ? clampPlaybackPosition(state?.progress_ms ?? 0, item.duration_ms)
      : 0,
    sampledAt,
    device: state?.device ? mapSpotifyDevice(state.device) : null,
    track: item
      ? {
          spotifyTrackId: item.id,
          spotifyUri: item.uri,
          trackName: item.name,
          artistName:
            item.artists.map((artist) => artist.name).join(', ') ||
            'Unknown artist',
          albumName: item.album.name,
          imageUrl,
          spotifyUrl: item.external_urls?.spotify,
          durationMs: Math.max(0, item.duration_ms),
        }
      : null,
  }
}

export function clampPlaybackPosition(value: number, durationMs?: number): number {
  const maximum = Math.max(0, Math.floor(durationMs ?? Number.MAX_SAFE_INTEGER))
  return Math.min(Math.max(Math.floor(value), 0), maximum)
}

export function clampVolumePercent(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 100)
}

export function isSpotifyTrackUri(value: string): boolean {
  return /^spotify:track:[A-Za-z0-9]+$/.test(value)
}
