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
  completeAuthorization,
  createAuthorizationUrl,
  SpotifyAuthorizationError,
  syncRecentPlayback,
} from './spotify.ts'

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/api/status', (_request, response) => {
  response.json({
    configured: Boolean(config.clientId),
    connected: Boolean(getStoredToken()),
    account: getAccount(),
    redirectUri: config.redirectUri,
    scopes: ['user-read-recently-played', 'user-top-read'],
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
