import './config.ts'
import { getStoredToken } from './db.ts'
import { syncListeningData } from './spotify.ts'

if (!getStoredToken()) {
  console.error('Spotify is not connected. Open Listening Ledger and connect first.')
  process.exitCode = 1
} else {
  try {
    const result = await syncListeningData()
    console.log(result.message)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Sync failed.')
    process.exitCode = 1
  }
}

