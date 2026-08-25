import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppContext } from './context'
import { api } from './lib/api'
import { resolvePreferredPlaybackDevice } from './lib/spotify'
import Shell from './components/Shell'
import DashboardScreen from './screens/DashboardScreen'
import DataHealthScreen from './screens/DataHealthScreen'
import DiscoverScreen from './screens/DiscoverScreen'
import HistoryScreen from './screens/HistoryScreen'
import RankingsScreen from './screens/RankingsScreen'
import SettingsScreen from './screens/SettingsScreen'
import TrendsScreen from './screens/TrendsScreen'
import type { AppStatus, PlaybackDevice, PlaybackState } from './types'

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [player, setPlayer] = useState<PlaybackState | null>(null)
  const [playerDevices, setPlayerDevices] = useState<PlaybackDevice[]>([])
  const [playerLoading, setPlayerLoading] = useState(false)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [preferredDeviceId, setPreferredDeviceId] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<AppStatus>('/api/status'))
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const playerAccessReady = Boolean(
    status?.connected &&
      status.grantedScopes.includes('user-read-playback-state') &&
      status.grantedScopes.includes('user-modify-playback-state'),
  )

  const loadPlayerState = useCallback(async () => {
    if (!playerAccessReady) {
      setPlayer(null)
      return
    }
    try {
      const next = await api<PlaybackState>('/api/player/state')
      setPlayer(next)
      if (next.device?.id) setPreferredDeviceId(next.device.id)
      setPlayerError(null)
    } catch (error) {
      setPlayerError(
        error instanceof Error ? error.message : 'Playback state failed.',
      )
    }
  }, [playerAccessReady])

  const refreshPlayer = useCallback(async () => {
    setPlayerLoading(true)
    try {
      await loadPlayerState()
    } finally {
      setPlayerLoading(false)
    }
  }, [loadPlayerState])

  const refreshPlayerDevices = useCallback(async () => {
    if (!playerAccessReady) {
      setPlayerDevices([])
      return
    }
    try {
      const result = await api<{ devices: PlaybackDevice[] }>(
        '/api/player/devices',
      )
      const sorted = [...result.devices].sort(
        (left, right) =>
          Number(right.isActive) - Number(left.isActive) ||
          Number(right.type.toLowerCase() === 'computer') -
            Number(left.type.toLowerCase() === 'computer') ||
          left.name.localeCompare(right.name),
      )
      setPlayerDevices(sorted)
      setPreferredDeviceId((current) =>
        resolvePreferredPlaybackDevice(sorted, current),
      )
    } catch (error) {
      setPlayerError(
        error instanceof Error ? error.message : 'Device lookup failed.',
      )
    }
  }, [playerAccessReady])

  useEffect(() => {
    if (!playerAccessReady) {
      setPlayer(null)
      setPlayerDevices([])
      setPreferredDeviceId(null)
      return
    }
    void loadPlayerState()
    void refreshPlayerDevices()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadPlayerState()
    }, 10_000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadPlayerState()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadPlayerState, playerAccessReady, refreshPlayerDevices])

  const runPlayerControl = useCallback(
    async (
      path: string,
      method: 'POST' | 'PUT',
      body: Record<string, unknown>,
    ): Promise<boolean> => {
      if (!playerAccessReady) {
        setPlayerError('Update Spotify access before using player controls.')
        return false
      }
      setPlayerLoading(true)
      setPlayerError(null)
      try {
        await api<void>(path, { method, body: JSON.stringify(body) })
        await new Promise((resolve) => window.setTimeout(resolve, 350))
        await loadPlayerState()
        return true
      } catch (error) {
        setPlayerError(
          error instanceof Error ? error.message : 'Spotify playback failed.',
        )
        return false
      } finally {
        setPlayerLoading(false)
      }
    },
    [loadPlayerState, playerAccessReady],
  )

  const playTrack = useCallback(
    (spotifyUri: string) =>
      runPlayerControl('/api/player/play', 'PUT', {
        spotifyUri,
        deviceId: preferredDeviceId,
      }),
    [preferredDeviceId, runPlayerControl],
  )

  const setPlayback = useCallback(
    (isPlaying: boolean) =>
      runPlayerControl('/api/player/playback', 'PUT', {
        isPlaying,
        deviceId: preferredDeviceId,
      }),
    [preferredDeviceId, runPlayerControl],
  )

  const skipPlayback = useCallback(
    (direction: 'next' | 'previous') =>
      runPlayerControl('/api/player/skip', 'POST', {
        direction,
        deviceId: preferredDeviceId,
      }),
    [preferredDeviceId, runPlayerControl],
  )

  const seekPlayback = useCallback(
    (positionMs: number) =>
      runPlayerControl('/api/player/seek', 'PUT', {
        positionMs,
        deviceId: preferredDeviceId,
      }),
    [preferredDeviceId, runPlayerControl],
  )

  const setPlaybackVolume = useCallback(
    (volumePercent: number) =>
      runPlayerControl('/api/player/volume', 'PUT', {
        volumePercent,
        deviceId: preferredDeviceId,
      }),
    [preferredDeviceId, runPlayerControl],
  )

  const selectPlaybackDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      const trimmed = deviceId.trim()
      if (!trimmed) {
        setPreferredDeviceId(null)
        setPlayerError(null)
        return true
      }
      const transferred = await runPlayerControl('/api/player/device', 'PUT', {
        deviceId: trimmed,
        isPlaying: player?.isPlaying ?? false,
      })
      if (transferred) setPreferredDeviceId(trimmed)
      return transferred
    },
    [player?.isPlaying, runPlayerControl],
  )

  const syncNow = useCallback(async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await api<{ imported: number; message: string }>(
        '/api/sync',
        { method: 'POST' },
      )
      setSyncMessage(result.message)
      return true
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Sync failed.')
      return false
    } finally {
      setSyncing(false)
    }
  }, [])

  const context = useMemo(
    () => ({
      status,
      loadingStatus,
      syncing,
      syncMessage,
      refreshStatus,
      syncNow,
      player,
      playerDevices,
      playerLoading,
      playerError,
      playerAccessReady,
      preferredDeviceId,
      refreshPlayer,
      refreshPlayerDevices,
      playTrack,
      setPlayback,
      skipPlayback,
      seekPlayback,
      setPlaybackVolume,
      selectPlaybackDevice,
      clearPlayerError: () => setPlayerError(null),
    }),
    [
      status,
      loadingStatus,
      syncing,
      syncMessage,
      refreshStatus,
      syncNow,
      player,
      playerDevices,
      playerLoading,
      playerError,
      playerAccessReady,
      preferredDeviceId,
      refreshPlayer,
      refreshPlayerDevices,
      playTrack,
      setPlayback,
      skipPlayback,
      seekPlayback,
      setPlaybackVolume,
      selectPlaybackDevice,
    ],
  )

  return (
    <AppContext.Provider value={context}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardScreen />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="rankings" element={<RankingsScreen />} />
          <Route path="trends" element={<TrendsScreen />} />
          <Route path="discover" element={<DiscoverScreen />} />
          <Route path="health" element={<DataHealthScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppContext.Provider>
  )
}
