import { Globe2, LoaderCircle, MonitorSpeaker, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAppContext } from '../context'
import { api } from '../lib/api'
import { spotifyWebPlayerUrl } from '../lib/spotify'

export function TrackPlayButton({
  spotifyUri,
  children,
  className = '',
}: {
  spotifyUri: string
  children: ReactNode
  className?: string
}) {
  const { playTrack } = useAppContext()
  return (
    <button
      type="button"
      className={`track-play-link ${className}`.trim()}
      onClick={() => void playTrack(spotifyUri)}
      title="Play through Spotify"
    >
      {children}
    </button>
  )
}

export function TrackPlayIcon({
  spotifyUri,
  trackName,
}: {
  spotifyUri: string
  trackName: string
}) {
  const { playTrack } = useAppContext()
  return (
    <button
      type="button"
      className="track-play-icon"
      onClick={(event) => {
        event.stopPropagation()
        void playTrack(spotifyUri)
      }}
      title={`Play ${trackName}`}
      aria-label={`Play ${trackName}`}
    >
      <Play size={13} fill="currentColor" />
    </button>
  )
}

export function SpotifyDestinationLinks({
  spotifyUri,
  spotifyUrl,
  label,
  className = '',
}: {
  spotifyUri: string
  spotifyUrl?: string
  label: string
  className?: string
}) {
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
        `${error instanceof Error ? error.message : 'Spotify Desktop could not be opened.'} Use the Web Player icon instead.`,
      )
    } finally {
      setDesktopLaunching(false)
    }
  }

  return (
    <span className={`spotify-destination-links ${className}`.trim()}>
      <button
        type="button"
        className="spotify-app-link"
        onClick={(event) => {
          event.stopPropagation()
          void openDesktop()
        }}
        disabled={desktopLaunching}
        aria-label={`Open ${label} in Spotify Desktop`}
        title="Open in Spotify Desktop"
      >
        {desktopLaunching ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <MonitorSpeaker size={13} />
        )}
      </button>
      <a
        className="spotify-app-link spotify-app-link--web"
        href={spotifyWebPlayerUrl(spotifyUri, spotifyUrl)}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        aria-label={`Open ${label} in Spotify Web Player`}
        title="Open in Spotify Web Player"
      >
        <Globe2 size={13} />
      </a>
    </span>
  )
}
