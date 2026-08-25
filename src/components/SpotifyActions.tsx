import { MonitorSpeaker } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api } from '../lib/api'

function useSpotifyDesktopLauncher(
  spotifyUri: string,
  failureHelp = '',
) {
  const [desktopLaunching, setDesktopLaunching] = useState(false)

  const openDesktop = async () => {
    if (desktopLaunching) return
    setDesktopLaunching(true)
    try {
      await api<void>('/api/player/open-desktop', {
        method: 'POST',
        body: JSON.stringify({ spotifyUri }),
      })
    } catch (error) {
      window.alert(
        `${error instanceof Error ? error.message : 'Spotify Desktop could not be opened.'}${failureHelp}`,
      )
    } finally {
      setDesktopLaunching(false)
    }
  }

  return { desktopLaunching, openDesktop }
}

export function SpotifyDesktopTextLink({
  spotifyUri,
  label,
  children,
  className = '',
}: {
  spotifyUri: string
  label: string
  children: ReactNode
  className?: string
}) {
  const { desktopLaunching, openDesktop } =
    useSpotifyDesktopLauncher(spotifyUri)

  return (
    <button
      type="button"
      className={`spotify-desktop-text-link ${className}`.trim()}
      onClick={(event) => {
        event.stopPropagation()
        void openDesktop()
      }}
      disabled={desktopLaunching}
      aria-label={`Open ${label} in Spotify Desktop`}
      aria-busy={desktopLaunching}
      title="Open in Spotify Desktop"
    >
      {children}
    </button>
  )
}

export function SpotifyDesktopIconButton({
  spotifyUri,
  label,
}: {
  spotifyUri: string
  label: string
}) {
  return (
    <SpotifyDesktopTextLink
      spotifyUri={spotifyUri}
      label={label}
      className="spotify-icon-action"
    >
      <MonitorSpeaker size={14} aria-hidden="true" />
    </SpotifyDesktopTextLink>
  )
}

export function SpotifyDesktopButton({
  spotifyUri,
  label,
}: {
  spotifyUri: string
  label: string
}) {
  const { desktopLaunching, openDesktop } =
    useSpotifyDesktopLauncher(spotifyUri)

  return (
    <button
      type="button"
      className="button button--primary"
      onClick={() => void openDesktop()}
      disabled={desktopLaunching}
      aria-busy={desktopLaunching}
    >
      <MonitorSpeaker size={16} />
      {desktopLaunching ? 'Opening Spotify…' : `Open ${label} in Spotify`}
    </button>
  )
}
