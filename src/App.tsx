import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppContext } from './context'
import { api } from './lib/api'
import Shell from './components/Shell'
import DashboardScreen from './screens/DashboardScreen'
import DataHealthScreen from './screens/DataHealthScreen'
import HistoryScreen from './screens/HistoryScreen'
import RankingsScreen from './screens/RankingsScreen'
import SettingsScreen from './screens/SettingsScreen'
import TrendsScreen from './screens/TrendsScreen'
import type { AppStatus } from './types'

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

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
    }),
    [status, loadingStatus, syncing, syncMessage, refreshStatus, syncNow],
  )

  return (
    <AppContext.Provider value={context}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardScreen />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="rankings" element={<RankingsScreen />} />
          <Route path="trends" element={<TrendsScreen />} />
          <Route path="health" element={<DataHealthScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppContext.Provider>
  )
}

