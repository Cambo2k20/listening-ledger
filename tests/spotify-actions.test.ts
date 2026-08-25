import { describe, expect, it } from 'vitest'
import { spotifyWebPlayerUrl } from '../src/lib/spotify.ts'

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
