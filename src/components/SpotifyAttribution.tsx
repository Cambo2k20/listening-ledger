import spotifyFullLogo from '../assets/spotify-full-logo-white.svg'
import spotifyPinkPurpleIcon from '../assets/spotify-pink-purple-icon.svg'

export function SpotifyAttribution({
  compact = false,
  href = 'https://open.spotify.com/',
  className = '',
}: {
  compact?: boolean
  href?: string
  className?: string
}) {
  return (
    <a
      className={`spotify-attribution ${compact ? 'spotify-attribution--compact' : ''} ${className}`.trim()}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Open Spotify"
      title="Content from Spotify"
    >
      {!compact && <span>Content from</span>}
      {compact ? (
        <img src={spotifyPinkPurpleIcon} alt="Spotify" />
      ) : (
        <picture>
          <source media="(max-width: 620px)" srcSet={spotifyPinkPurpleIcon} />
          <img src={spotifyFullLogo} alt="Spotify" />
        </picture>
      )}
    </a>
  )
}
