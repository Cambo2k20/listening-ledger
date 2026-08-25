import { createContext, useContext } from 'react'
import type { AppStatus } from './types'

export interface AppContextValue {
  status: AppStatus | null
  loadingStatus: boolean
  syncing: boolean
  syncMessage: string | null
  refreshStatus: () => Promise<void>
  syncNow: () => Promise<boolean>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('App context is unavailable.')
  return context
}

