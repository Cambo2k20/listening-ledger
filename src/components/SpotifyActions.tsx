import { Globe2, MonitorSpeaker, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppContext } from '../context'
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
  return (
    <span className={`spotify-destination-links ${className}`.trim()}>
      <a
        className="spotify-app-link"
        href={spotifyUri}
        aria-label={`Open ${label} in Spotify Desktop`}
        title="Open in Spotify Desktop"
      >
        <MonitorSpeaker size={13} />
      </a>
      <a
        className="spotify-app-link spotify-app-link--web"
        href={spotifyWebPlayerUrl(spotifyUri, spotifyUrl)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${label} in Spotify Web Player`}
        title="Open in Spotify Web Player"
      >
        <Globe2 size={13} />
      </a>
    </span>
  )
}
