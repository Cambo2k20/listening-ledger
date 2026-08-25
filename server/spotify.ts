import { createHash, randomBytes } from 'node:crypto'
import { config } from './config.ts'
import {
  clearAuthentication,
  finishSyncRun,
  getLatestPlayedAt,
  getStoredToken,
  insertPlaybackEvent,
  saveAccount,
  saveStoredToken,
  saveTopSnapshot,
  startSyncRun,
} from './db.ts'
import { deduplicatePlaybackEvents } from './lib/dedup.ts'
import type {
  SpotifyPlayHistoryItem,
  SpotifyTokenResponse,
  StoredToken,
} from './types.ts'

const scopes = ['user-read-recently-played', 'user-top-read']
const pendingAuthorizations = new Map<
  string,
  { verifier: string; expiresAt: number }
>()

export class SpotifyAuthorizationError extends Error {}

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export function createAuthorizationUrl(): string {
  if (!config.clientId) {
    throw new Error('SPOTIFY_CLIENT_ID is not configured.')
  }

  const state = base64Url(randomBytes(24))
  const verifier = base64Url(randomBytes(64))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  pendingAuthorizations.set(state, {
    verifier,
    expiresAt: Date.now() + 10 * 60_000,
  })

  const url = new URL('https://accounts.spotify.com/authorize')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', challenge)
  return url.toString()
}

async function exchangeToken(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json()) as SpotifyTokenResponse & {
    error?: string
    error_description?: string
  }
  if (!response.ok) {
    throw new SpotifyAuthorizationError(
      payload.error_description ?? payload.error ?? 'Spotify authorization failed.',
    )
  }
  return payload
}

export async function completeAuthorization(
  code: string,
  state: string,
): Promise<void> {
  const pending = pendingAuthorizations.get(state)
  pendingAuthorizations.delete(state)
  if (!pending || pending.expiresAt < Date.now()) {
    throw new SpotifyAuthorizationError(
      'The Spotify sign-in request expired or could not be verified.',
    )
  }

  const response = await exchangeToken(
    new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: pending.verifier,
    }),
  )
  if (!response.refresh_token) {
    throw new SpotifyAuthorizationError(
      'Spotify did not return a refresh token.',
    )
  }

  saveStoredToken({
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    scope: response.scope,
  })

  const profile = await spotifyRequest<{
    id: string
    display_name?: string
    external_urls?: { spotify?: string }
  }>('/v1/me')
  saveAccount(profile)
}

async function refreshToken(token: StoredToken): Promise<StoredToken> {
  try {
    const response = await exchangeToken(
      new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    )
    const refreshed: StoredToken = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? token.refreshToken,
      expiresAt: Date.now() + response.expires_in * 1000,
      scope: response.scope || token.scope,
    }
    saveStoredToken(refreshed)
    return refreshed
  } catch (error) {
    if (
      error instanceof SpotifyAuthorizationError &&
      error.message.toLowerCase().includes('invalid')
    ) {
      clearAuthentication()
    }
    throw error
  }
}

async function currentAccessToken(): Promise<string> {
  const stored = getStoredToken()
  if (!stored) {
    throw new SpotifyAuthorizationError('Spotify is not connected.')
  }
  if (stored.expiresAt > Date.now() + 60_000) return stored.accessToken
  return (await refreshToken(stored)).accessToken
}

async function spotifyRequest<T>(pathOrUrl: string): Promise<T> {
  const token = await currentAccessToken()
  const response = await fetch(
    pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : `https://api.spotify.com${pathOrUrl}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (response.status === 401) {
    const stored = getStoredToken()
    if (!stored) throw new SpotifyAuthorizationError('Spotify is not connected.')
    const refreshed = await refreshToken(stored)
    const retry = await fetch(
      pathOrUrl.startsWith('https://')
        ? pathOrUrl
        : `https://api.spotify.com${pathOrUrl}`,
      { headers: { Authorization: `Bearer ${refreshed.accessToken}` } },
    )
    if (!retry.ok) throw new Error(`Spotify request failed with ${retry.status}.`)
    return (await retry.json()) as T
  }

  if (!response.ok) {
    const details = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null
    throw new Error(
      details?.error?.message ?? `Spotify request failed with ${response.status}.`,
    )
  }
  return (await response.json()) as T
}

async function collectRecentlyPlayed(): Promise<SpotifyPlayHistoryItem[]> {
  const latest = getLatestPlayedAt()
  const url = new URL('https://api.spotify.com/v1/me/player/recently-played')
  url.searchParams.set('limit', '50')
  if (latest) {
    url.searchParams.set('after', String(new Date(latest).getTime()))
  }

  const collected: SpotifyPlayHistoryItem[] = []
  let next: string | null = url.toString()
  let pageCount = 0
  while (next && pageCount < 10) {
    const page: {
      items: SpotifyPlayHistoryItem[]
      next?: string | null
    } = await spotifyRequest(next)
    collected.push(...page.items)
    next = page.next ?? null
    pageCount += 1
  }
  return deduplicatePlaybackEvents(collected)
}

async function captureTopItems(capturedAt: string): Promise<void> {
  const ranges = ['short_term', 'medium_term', 'long_term']
  await Promise.all(
    ranges.flatMap((range) =>
      ['tracks', 'artists'].map(async (entityType) => {
        try {
          const response = await spotifyRequest<{
            items: Array<{
              id: string
              name: string
              external_urls?: { spotify?: string }
            }>
          }>(`/v1/me/top/${entityType}?time_range=${range}&limit=50`)
          saveTopSnapshot(
            capturedAt,
            range,
            entityType.slice(0, -1),
            response.items,
          )
        } catch {
          // Recent-history collection remains useful if a top-items call fails.
        }
      }),
    ),
  )
}

let activeSync: Promise<{ imported: number; message: string }> | null = null

export function syncListeningData(): Promise<{
  imported: number
  message: string
}> {
  if (activeSync) return activeSync

  activeSync = (async () => {
    const runId = startSyncRun()
    try {
      const items = await collectRecentlyPlayed()
      let imported = 0
      for (const item of items) {
        if (
          insertPlaybackEvent(
            item.track,
            item.played_at,
            item.context?.uri,
          )
        ) {
          imported += 1
        }
      }
      await captureTopItems(new Date().toISOString())
      const message = imported
        ? `Recorded ${imported} new playback event${imported === 1 ? '' : 's'}.`
        : 'No new playback events were available.'
      finishSyncRun(runId, 'success', imported, message)
      return { imported, message }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.'
      finishSyncRun(runId, 'failed', 0, message)
      throw error
    } finally {
      activeSync = null
    }
  })()

  return activeSync
}
