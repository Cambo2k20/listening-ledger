import { Play, Radio } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppContext } from '../context'

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

export function SpotifyAppLink({
  spotifyUri,
  label,
  className = '',
  children,
}: {
  spotifyUri: string
  label: string
  className?: string
  children?: ReactNode
}) {
  return (
    <a
      className={`spotify-app-link ${className}`.trim()}
      href={spotifyUri}
      aria-label={label}
      title={label}
    >
      {children ?? <Radio size={13} />}
    </a>
  )
}
