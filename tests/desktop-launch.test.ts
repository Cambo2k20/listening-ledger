import { describe, expect, it } from 'vitest'
import {
  getSpotifyDesktopLaunchCommand,
  isSpotifyDesktopUri,
} from '../server/lib/desktop.ts'

describe('Spotify Desktop launcher', () => {
  it('allows only the Spotify destinations the app renders', () => {
    expect(isSpotifyDesktopUri('spotify:')).toBe(true)
    expect(isSpotifyDesktopUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toBe(true)
    expect(isSpotifyDesktopUri('spotify:artist:artist123')).toBe(true)
    expect(isSpotifyDesktopUri('spotify:album:album123')).toBe(true)
    expect(isSpotifyDesktopUri('spotify:playlist:playlist123')).toBe(false)
    expect(isSpotifyDesktopUri('https://open.spotify.com/track/example')).toBe(false)
    expect(isSpotifyDesktopUri('file:///C:/Windows/System32/calc.exe')).toBe(false)
  })

  it('passes an accepted URI as one literal Explorer argument on Windows', () => {
    expect(
      getSpotifyDesktopLaunchCommand('spotify:track:track123', 'win32'),
    ).toEqual({
      command: 'explorer.exe',
      args: ['spotify:track:track123'],
    })
  })

  it('rejects unsupported operating systems', () => {
    expect(() =>
      getSpotifyDesktopLaunchCommand('spotify:track:track123', 'linux'),
    ).toThrow('supported only on Windows')
  })
})
