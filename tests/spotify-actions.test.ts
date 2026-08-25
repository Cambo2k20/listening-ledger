import { describe, expect, it } from 'vitest'
import {
  resolvePreferredPlaybackDevice,
  spotifyWebPlayerUrl,
} from '../src/lib/spotify.ts'
import type { PlaybackDevice } from '../src/types.ts'

function device(
  id: string,
  type: string,
  isActive = false,
  isRestricted = false,
): PlaybackDevice {
  return {
    id,
    name: id,
    type,
    isActive,
    isRestricted,
    supportsVolume: true,
  }
}

describe('Spotify Web Player links', () => {
  it('uses the canonical Spotify URL when one is available', () => {
    expect(
      spotifyWebPlayerUrl(
        'spotify:track:ignored',
        'https://open.spotify.com/track/canonical',
      ),
    ).toBe('https://open.spotify.com/track/canonical')
  })

  it('converts supported Spotify URIs into Web Player URLs', () => {
    expect(spotifyWebPlayerUrl('spotify:track:track123')).toBe(
      'https://open.spotify.com/track/track123',
    )
    expect(spotifyWebPlayerUrl('spotify:artist:artist123')).toBe(
      'https://open.spotify.com/artist/artist123',
    )
    expect(spotifyWebPlayerUrl('spotify:album:album123')).toBe(
      'https://open.spotify.com/album/album123',
    )
  })

  it('falls back to the Web Player home for non-content URIs', () => {
    expect(spotifyWebPlayerUrl('spotify:')).toBe('https://open.spotify.com/')
  })
})

describe('preferred Spotify Connect device', () => {
  it('does not auto-select an inactive computer', () => {
    expect(
      resolvePreferredPlaybackDevice(
        [device('edge', 'Computer'), device('speaker', 'Speaker')],
        null,
      ),
    ).toBeNull()
  })

  it('keeps an explicit available selection', () => {
    expect(
      resolvePreferredPlaybackDevice(
        [device('edge', 'Computer'), device('speaker', 'Speaker')],
        'speaker',
      ),
    ).toBe('speaker')
  })

  it('uses only an active unrestricted device as the automatic target', () => {
    expect(
      resolvePreferredPlaybackDevice(
        [device('restricted', 'Speaker', true, true), device('sonos', 'Speaker', true)],
        null,
      ),
    ).toBe('sonos')
  })
})
