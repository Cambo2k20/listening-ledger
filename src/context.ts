import { createContext, useContext } from 'react'
import type { AppStatus, PlaybackDevice, PlaybackState } from './types'

export interface AppContextValue {
  status: AppStatus | null
  loadingStatus: boolean
  syncing: boolean
  syncMessage: string | null
  refreshStatus: () => Promise<void>
  syncNow: () => Promise<boolean>
  player: PlaybackState | null
  playerDevices: PlaybackDevice[]
  playerLoading: boolean
  playerError: string | null
  playerAccessReady: boolean
  preferredDeviceId: string | null
  refreshPlayer: () => Promise<void>
  refreshPlayerDevices: () => Promise<void>
  playTrack: (spotifyUri: string) => Promise<boolean>
  setPlayback: (isPlaying: boolean) => Promise<boolean>
  skipPlayback: (direction: 'next' | 'previous') => Promise<boolean>
  seekPlayback: (positionMs: number) => Promise<boolean>
  setPlaybackVolume: (volumePercent: number) => Promise<boolean>
  selectPlaybackDevice: (deviceId: string) => Promise<boolean>
  clearPlayerError: () => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('App context is unavailable.')
  return context
}
