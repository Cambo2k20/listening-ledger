import { spawn } from 'node:child_process'

export type SpotifyDesktopLaunchCommand = {
  command: string
  args: string[]
}

export function isSpotifyDesktopUri(value: string): boolean {
  return (
    value === 'spotify:' ||
    /^spotify:(track|artist|album):[A-Za-z0-9]+$/.test(value)
  )
}

export function getSpotifyDesktopLaunchCommand(
  spotifyUri: string,
  platform: NodeJS.Platform = process.platform,
): SpotifyDesktopLaunchCommand {
  if (!isSpotifyDesktopUri(spotifyUri)) {
    throw new Error('Only Spotify track, artist, or album links can be opened.')
  }
  if (platform !== 'win32') {
    throw new Error('Opening Spotify Desktop is currently supported only on Windows.')
  }
  return {
    command: 'explorer.exe',
    args: [spotifyUri],
  }
}

export async function openSpotifyDesktop(spotifyUri: string): Promise<void> {
  const { command, args } = getSpotifyDesktopLaunchCommand(spotifyUri)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
    child.once('error', reject)
  })
}
