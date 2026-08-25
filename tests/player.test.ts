import { describe, expect, it } from 'vitest'
import {
  clampPlaybackPosition,
  clampVolumePercent,
  isSpotifyTrackUri,
  mapSpotifyDevice,
  mapSpotifyPlaybackState,
} from '../server/lib/player.ts'

const spotifyTrack = {
  id: 'track123',
  uri: 'spotify:track:track123',
  name: 'A Test Track',
  duration_ms: 180_000,
  artists: [
    { id: 'artist1', uri: 'spotify:artist:artist1', name: 'First Artist' },
    { id: 'artist2', uri: 'spotify:artist:artist2', name: 'Second Artist' },
  ],
  album: {
    id: 'album1',
    uri: 'spotify:album:album1',
    name: 'The Album',
    images: [
      { url: 'large.jpg', width: 640 },
      { url: 'small.jpg', width: 64 },
    ],
  },
  external_urls: { spotify: 'https://open.spotify.com/track/track123' },
}

describe('Spotify Connect player data', () => {
  it('maps Spotify playback into the client-safe player shape', () => {
    expect(
      mapSpotifyPlaybackState(
        {
          is_playing: true,
          progress_ms: 42_500,
          currently_playing_type: 'track',
          item: spotifyTrack,
          device: {
            id: 'desktop1',
            name: 'Cameron PC',
            type: 'Computer',
            is_active: true,
            volume_percent: 71.4,
            supports_volume: true,
          },
        },
        '2026-08-25T12:00:00.000Z',
      ),
    ).toEqual({
      isPlaying: true,
      progressMs: 42_500,
      sampledAt: '2026-08-25T12:00:00.000Z',
      device: {
        id: 'desktop1',
        name: 'Cameron PC',
        type: 'Computer',
        isActive: true,
        isRestricted: false,
        volumePercent: 71,
        supportsVolume: true,
      },
      track: {
        spotifyTrackId: 'track123',
        spotifyUri: 'spotify:track:track123',
        trackName: 'A Test Track',
        artistName: 'First Artist, Second Artist',
        albumName: 'The Album',
        imageUrl: 'small.jpg',
        spotifyUrl: 'https://open.spotify.com/track/track123',
        durationMs: 180_000,
      },
    })
  })

  it('returns an honest idle state for non-track playback', () => {
    const state = mapSpotifyPlaybackState({
      is_playing: true,
      progress_ms: 60_000,
      currently_playing_type: 'episode',
      item: spotifyTrack,
    })
    expect(state).toMatchObject({ isPlaying: false, progressMs: 0, track: null })
  })

  it('drops devices without an ID and clamps control values', () => {
    expect(mapSpotifyDevice({ name: 'Unavailable device' })).toBeNull()
    expect(clampPlaybackPosition(-1)).toBe(0)
    expect(clampPlaybackPosition(200_000, 180_000)).toBe(180_000)
    expect(clampVolumePercent(104)).toBe(100)
    expect(clampVolumePercent(49.6)).toBe(50)
  })

  it('accepts only Spotify track URIs for play commands', () => {
    expect(isSpotifyTrackUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toBe(true)
    expect(isSpotifyTrackUri('spotify:album:4uLU6hMCjMI75M1A2tKUQC')).toBe(false)
    expect(isSpotifyTrackUri('https://open.spotify.com/track/example')).toBe(false)
  })
})
