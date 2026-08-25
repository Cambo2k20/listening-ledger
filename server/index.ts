import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { config } from './config.ts'
import {
  clearAuthentication,
  getAccount,
  getDashboard,
  getExportData,
  getHealth,
  getHistory,
  getRankings,
  getStoredToken,
  getTrends,
} from './db.ts'
import {
  generateDiscoverySession,
  getDiscoverySeeds,
  getDiscoveryStatus,
  saveDiscoveryPlaylist,
  updateDiscoveryFeedback,
} from './discovery.ts'
import {
  completeAuthorization,
  createAuthorizationUrl,
  getGrantedSpotifyScopes,
  getMissingSpotifyScopes,
  getSpotifyPlaybackDevices,
  getSpotifyPlaybackState,
  playSpotifyTrack,
  seekSpotifyPlayback,
  setSpotifyPlayback,
  setSpotifyVolume,
  skipSpotifyPlayback,
  SPOTIFY_SCOPES,
  SpotifyAuthorizationError,
  syncRecentPlayback,
  transferSpotifyPlayback,
} from './spotify.ts'
import type {
  DiscoveryFeedbackStatus,
  DiscoveryMode,
  DiscoverySeed,
  DiscoverySeedSource,
} from './types.ts'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/api/status', (_request, response) => {
  response.json({
    configured: Boolean(config.clientId),
    connected: Boolean(getStoredToken()),
    account: getAccount(),
    redirectUri: config.redirectUri,
    scopes: SPOTIFY_SCOPES,
    grantedScopes: getGrantedSpotifyScopes(),
    missingScopes: getMissingSpotifyScopes(),
    lastFmConfigured: Boolean(config.lastFmApiKey),
  })
})

app.get('/api/dashboard', (request, response) => {
  response.json(getDashboard(String(request.query.period ?? '30d')))
})

app.get('/api/history', (request, response) => {
  response.json({
    items: getHistory(
      String(request.query.q ?? ''),
      Number(request.query.limit ?? 100),
    ),
  })
})

app.get('/api/rankings', (request, response) => {
  const requestedType = String(request.query.type ?? 'track')
  const type = ['track', 'artist', 'album'].includes(requestedType)
    ? (requestedType as 'track' | 'artist' | 'album')
    : 'track'
  response.json({
    type,
    period: String(request.query.period ?? '30d'),
    items: getRankings(type, String(request.query.period ?? '30d')),
  })
})

app.get('/api/trends', (_request, response) => {
  response.json(getTrends())
})

app.get('/api/health', (_request, response) => {
  response.json(getHealth())
})

function externalErrorStatus(error: unknown): number {
  if (error instanceof SpotifyAuthorizationError) {
    return error.message.includes('must be updated') ? 403 : 401
  }
  return 502
}

app.get('/api/discovery/status', (_request, response) => {
  response.json(getDiscoveryStatus())
})

app.get('/api/player/state', async (_request, response) => {
  try {
    response.json(await getSpotifyPlaybackState())
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Playback state failed.',
    })
  }
})

app.get('/api/player/devices', async (_request, response) => {
  try {
    response.json({ devices: await getSpotifyPlaybackDevices() })
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Device lookup failed.',
    })
  }
})

app.put('/api/player/play', async (request, response) => {
  try {
    const spotifyUri = String(request.body?.spotifyUri ?? '')
    const deviceId = String(request.body?.deviceId ?? '') || undefined
    await playSpotifyTrack(spotifyUri, deviceId)
    response.status(204).end()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Playback failed.'
    response
      .status(message.includes('Only Spotify track URIs') ? 400 : externalErrorStatus(error))
      .json({ error: message })
  }
})

app.put('/api/player/playback', async (request, response) => {
  try {
    if (typeof request.body?.isPlaying !== 'boolean') {
      response.status(400).json({ error: 'isPlaying must be true or false.' })
      return
    }
    await setSpotifyPlayback(
      request.body.isPlaying,
      String(request.body?.deviceId ?? '') || undefined,
    )
    response.status(204).end()
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Playback control failed.',
    })
  }
})

app.post('/api/player/skip', async (request, response) => {
  try {
    const direction = String(request.body?.direction ?? '')
    if (direction !== 'next' && direction !== 'previous') {
      response.status(400).json({ error: 'Direction must be next or previous.' })
      return
    }
    await skipSpotifyPlayback(
      direction,
      String(request.body?.deviceId ?? '') || undefined,
    )
    response.status(204).end()
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Skip failed.',
    })
  }
})

app.put('/api/player/seek', async (request, response) => {
  try {
    const positionMs = Number(request.body?.positionMs)
    if (!Number.isFinite(positionMs)) {
      response.status(400).json({ error: 'positionMs must be a number.' })
      return
    }
    await seekSpotifyPlayback(
      positionMs,
      String(request.body?.deviceId ?? '') || undefined,
    )
    response.status(204).end()
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Seek failed.',
    })
  }
})

app.put('/api/player/volume', async (request, response) => {
  try {
    const volumePercent = Number(request.body?.volumePercent)
    if (!Number.isFinite(volumePercent)) {
      response.status(400).json({ error: 'volumePercent must be a number.' })
      return
    }
    await setSpotifyVolume(
      volumePercent,
      String(request.body?.deviceId ?? '') || undefined,
    )
    response.status(204).end()
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Volume control failed.',
    })
  }
})

app.put('/api/player/device', async (request, response) => {
  try {
    const deviceId = String(request.body?.deviceId ?? '')
    if (!deviceId.trim()) {
      response.status(400).json({ error: 'Choose a Spotify playback device.' })
      return
    }
    await transferSpotifyPlayback(deviceId, Boolean(request.body?.isPlaying))
    response.status(204).end()
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Device transfer failed.',
    })
  }
})

app.get('/api/discovery/seeds', async (request, response) => {
  try {
    const source = String(request.query.source ?? 'ledger')
    if (!['ledger', 'top', 'liked', 'search'].includes(source)) {
      response.status(400).json({ error: 'Unknown seed source.' })
      return
    }
    response.json({
      items: await getDiscoverySeeds(
        source as DiscoverySeedSource,
        String(request.query.q ?? ''),
      ),
    })
  } catch (error) {
    response.status(externalErrorStatus(error)).json({
      error: error instanceof Error ? error.message : 'Seed lookup failed.',
    })
  }
})

app.post('/api/discovery/generate', async (request, response) => {
  try {
    const body = request.body as {
      seeds?: DiscoverySeed[]
      mode?: DiscoveryMode
      targetCount?: number
    }
    response.status(201).json(
      await generateDiscoverySession({
        seeds: Array.isArray(body.seeds) ? body.seeds : [],
        mode: body.mode ?? 'balanced',
        targetCount: body.targetCount,
      }),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed.'
    const status =
      message.includes('Select at least') || message.includes('mode must')
        ? 400
        : externalErrorStatus(error)
    response.status(status).json({ error: message })
  }
})

app.patch('/api/discovery/candidates/:id', (request, response) => {
  try {
    const candidateId = Number(request.params.id)
    if (!Number.isInteger(candidateId) || candidateId < 1) {
      response.status(400).json({ error: 'Invalid discovery candidate id.' })
      return
    }
    const status = String(request.body?.status ?? '') as DiscoveryFeedbackStatus
    response.json(updateDiscoveryFeedback(candidateId, status))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Feedback failed.'
    response.status(message.includes('not found') ? 404 : 400).json({ error: message })
  }
})

app.post('/api/discovery/sessions/:id/playlist', async (request, response) => {
  try {
    const sessionId = Number(request.params.id)
    if (!Number.isInteger(sessionId) || sessionId < 1) {
      response.status(400).json({ error: 'Invalid discovery session id.' })
      return
    }
    response.json(
      await saveDiscoveryPlaylist(sessionId, String(request.body?.name ?? '')),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Playlist save failed.'
    const status = message.includes('not found')
      ? 404
      : message.includes('at least one')
        ? 400
        : externalErrorStatus(error)
    response.status(status).json({ error: message })
  }
})

app.post('/api/sync', async (_request, response) => {
  try {
    response.json(await syncRecentPlayback())
  } catch (error) {
    const status = error instanceof SpotifyAuthorizationError ? 401 : 502
    response.status(status).json({
      error: error instanceof Error ? error.message : 'Spotify sync failed.',
    })
  }
})

app.post('/api/disconnect', (_request, response) => {
  clearAuthentication()
  response.json({ disconnected: true })
})

app.get('/api/export', (request, response) => {
  const format = String(request.query.format ?? 'json')
  const rows = getExportData()
  const date = new Date().toISOString().slice(0, 10)
  if (format === 'csv') {
    const columns = [
      'playedAt',
      'source',
      'trackName',
      'artists',
      'albumName',
      'trackUri',
      'spotifyUrl',
      'contextUri',
    ]
    const escape = (value: unknown) =>
      `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = [
      columns.join(','),
      ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
    ].join('\n')
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="listening-ledger-${date}.csv"`,
    )
    response.send(csv)
    return
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader(
    'Content-Disposition',
    `attachment; filename="listening-ledger-${date}.json"`,
  )
  response.send(JSON.stringify({ exportedAt: new Date().toISOString(), events: rows }, null, 2))
})

app.get('/api/auth/start', (_request, response) => {
  try {
    response.redirect(createAuthorizationUrl())
  } catch (error) {
    response.status(503).send(error instanceof Error ? error.message : 'Spotify is not configured.')
  }
})

app.get('/auth/callback', async (request, response) => {
  const code = String(request.query.code ?? '')
  const state = String(request.query.state ?? '')
  const spotifyError = String(request.query.error ?? '')
  if (spotifyError) {
    response.redirect(`${config.uiUrl}/settings?auth=denied`)
    return
  }
  if (!code || !state) {
    response.redirect(`${config.uiUrl}/settings?auth=invalid`)
    return
  }
  try {
    await completeAuthorization(code, state)
    response.redirect(`${config.uiUrl}/settings?auth=connected`)
  } catch {
    response.redirect(`${config.uiUrl}/settings?auth=failed`)
  }
})

const distPath = join(process.cwd(), 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*path', (_request, response) => {
    response.sendFile(join(distPath, 'index.html'))
  })
}

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Listening Ledger API: http://127.0.0.1:${config.port}`)
})
