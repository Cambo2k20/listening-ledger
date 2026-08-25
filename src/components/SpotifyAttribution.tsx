import spotifyFullLogo from '../assets/spotify-full-logo-white.svg'
import spotifyPrimaryLogoWhite from '../assets/spotify-primary-logo-white.svg'

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
        <img src={spotifyPrimaryLogoWhite} alt="Spotify" />
      ) : (
        <picture>
          <source media="(max-width: 620px)" srcSet={spotifyPrimaryLogoWhite} />
          <img src={spotifyFullLogo} alt="Spotify" />
        </picture>
      )}
    </a>
  )
}
