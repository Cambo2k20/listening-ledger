import type { PlaybackDevice } from '../types.ts'

export function spotifyWebPlayerUrl(
  spotifyUri: string,
  spotifyUrl?: string,
): string {
  if (spotifyUrl?.startsWith('https://open.spotify.com/')) return spotifyUrl
  const match = spotifyUri.match(/^spotify:(track|artist|album):([A-Za-z0-9]+)$/)
  return match
    ? `https://open.spotify.com/${match[1]}/${match[2]}`
    : 'https://open.spotify.com/'
}

export function resolvePreferredPlaybackDevice(
  devices: PlaybackDevice[],
  currentId: string | null,
): string | null {
  if (
    currentId &&
    devices.some((device) => device.id === currentId && !device.isRestricted)
  ) {
    return currentId
  }
  return (
    devices.find((device) => device.isActive && !device.isRestricted)?.id ??
    null
  )
}
