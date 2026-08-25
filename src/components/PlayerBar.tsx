import {
  Disc3,
  LoaderCircle,
  MonitorSpeaker,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppContext } from '../context'
import { SpotifyDesktopTextLink } from './SpotifyActions'
import { SpotifyAttribution } from './SpotifyAttribution'

function formatDuration(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function PlayerBar() {
  const {
    status,
    player,
    playerDevices,
    playerLoading,
    playerError,
    playerAccessReady,
    preferredDeviceId,
    refreshPlayer,
    refreshPlayerDevices,
    setPlayback,
    skipPlayback,
    seekPlayback,
    setPlaybackVolume,
    selectPlaybackDevice,
    clearPlayerError,
  } = useAppContext()
  const [clock, setClock] = useState(Date.now())
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)

  useEffect(() => {
    if (!player?.isPlaying) return
    const interval = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [player?.isPlaying])

  useEffect(() => {
    setClock(Date.now())
    setSeekDraft(null)
    setVolumeDraft(null)
  }, [player?.progressMs, player?.sampledAt, player?.track?.spotifyTrackId])

  const progressMs = useMemo(() => {
    if (!player?.track) return 0
    const elapsed = player.isPlaying
      ? Math.max(0, clock - new Date(player.sampledAt).getTime())
      : 0
    return Math.min(player.progressMs + elapsed, player.track.durationMs)
  }, [clock, player])
  const shownProgress = seekDraft ?? progressMs
  const shownVolume =
    volumeDraft ?? player?.device?.volumePercent ?? 50

  const commitSeek = (value: number) => {
    setSeekDraft(null)
    void seekPlayback(value)
  }

  const commitVolume = (value: number) => {
    setVolumeDraft(null)
    void setPlaybackVolume(value)
  }

  const stateClass = !status?.connected
    ? 'player-bar--disconnected'
    : !playerAccessReady
      ? 'player-bar--permission'
      : !player?.track
        ? 'player-bar--idle'
        : 'player-bar--active'

  return (
    <section className={`player-bar ${stateClass}`} aria-label="Spotify player">
      {playerError && (
        <div className="player-error" role="status">
          <span>{playerError}</span>
          <button onClick={clearPlayerError} aria-label="Dismiss player error">
            <X size={14} />
          </button>
        </div>
      )}

      {!status?.connected ? (
        <div className="player-gate">
          <span className="player-gate-icon"><Play size={15} /></span>
          <div>
            <strong>Spotify player is disconnected</strong>
            <small>Connect Spotify to play ledger tracks.</small>
          </div>
          <Link to="/settings" className="button button--quiet">Connect</Link>
        </div>
      ) : !playerAccessReady ? (
        <div className="player-gate">
          <span className="player-gate-icon"><MonitorSpeaker size={15} /></span>
          <div>
            <strong>Spotify player needs access</strong>
            <small>Grant playback state and control permissions once.</small>
          </div>
          <a href="/api/auth/start" className="button button--primary">Update access</a>
        </div>
      ) : (
        <>
          <div className="player-track">
            <SpotifyDesktopTextLink
              spotifyUri={player?.track?.spotifyUri ?? 'spotify:'}
              label={player?.track?.trackName ?? 'Spotify'}
              className="player-track-link"
            >
              {player?.track?.imageUrl ? (
                <img src={player.track.imageUrl} alt="" />
              ) : (
                <span className="player-art-placeholder"><Disc3 size={20} /></span>
              )}
              <span className="player-track-copy">
                <strong>{player?.track?.trackName ?? 'Nothing playing yet'}</strong>
                <small>
                  {player?.track
                    ? `${player.track.artistName}${player.track.albumName ? ` · ${player.track.albumName}` : ''}`
                    : 'Start Spotify Desktop or the Web Player, then refresh devices.'}
                </small>
              </span>
            </SpotifyDesktopTextLink>
          </div>

          <div className="player-centre">
            <div className="player-controls">
              <button
                onClick={() => void skipPlayback('previous')}
                disabled={!player?.track}
                aria-label="Previous track"
              >
                <SkipBack size={16} fill="currentColor" />
              </button>
              <button
                className="player-play"
                onClick={() => void setPlayback(!player?.isPlaying)}
                disabled={!player?.track || playerLoading}
                aria-label={player?.isPlaying ? 'Pause' : 'Play'}
              >
                {playerLoading ? (
                  <LoaderCircle size={18} className="spin" />
                ) : player?.isPlaying ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button
                onClick={() => void skipPlayback('next')}
                disabled={!player?.track}
                aria-label="Next track"
              >
                <SkipForward size={16} fill="currentColor" />
              </button>
            </div>
            <div className="player-progress">
              <span>{formatDuration(shownProgress)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(player?.track?.durationMs ?? 1, 1)}
                value={Math.min(shownProgress, player?.track?.durationMs ?? 1)}
                disabled={!player?.track}
                onChange={(event) => setSeekDraft(Number(event.target.value))}
                onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow')) {
                    commitSeek(Number(event.currentTarget.value))
                  }
                }}
                aria-label="Playback position"
              />
              <span>{formatDuration(player?.track?.durationMs ?? 0)}</span>
            </div>
          </div>

          <div className="player-output">
            <SpotifyAttribution
              compact
              href={player?.track?.spotifyUrl ?? 'https://open.spotify.com/'}
              className="player-spotify-mark"
            />
            <button
              className="player-refresh"
              onClick={() => void refreshPlayer()}
              aria-label="Refresh playback"
              title="Refresh playback"
            >
              <RefreshCw size={14} className={playerLoading ? 'spin' : ''} />
            </button>
            <label className="player-device">
              <MonitorSpeaker size={14} />
              <select
                value={preferredDeviceId ?? ''}
                onPointerDown={() => void refreshPlayerDevices()}
                onChange={(event) => void selectPlaybackDevice(event.target.value)}
                aria-label="Spotify playback device"
              >
                <option value="">
                  {playerDevices.length ? 'Current playback' : 'No available devices'}
                </option>
                {playerDevices.map((device) => (
                  <option key={device.id} value={device.id} disabled={device.isRestricted}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="player-volume">
              <Volume2 size={14} />
              <input
                type="range"
                min={0}
                max={100}
                value={shownVolume}
                disabled={!player?.device?.supportsVolume}
                onChange={(event) => setVolumeDraft(Number(event.target.value))}
                onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow')) {
                    commitVolume(Number(event.currentTarget.value))
                  }
                }}
                aria-label="Spotify volume"
              />
            </label>
          </div>
        </>
      )}
    </section>
  )
}
