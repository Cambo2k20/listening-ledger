import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { config } from './config.ts'
import {
  acquireSyncLock,
  clearAuthentication,
  finishSyncRun,
  getLatestSuccessfulSyncAt,
  getLatestPlayedAt,
  getStoredToken,
  insertPlaybackEvent,
  releaseSyncLock,
  saveAccount,
  saveStoredToken,
  saveTopSnapshot,
  startSyncRun,
} from './db.ts'
import { deduplicatePlaybackEvents } from './lib/dedup.ts'
import { normalizeDiscoveryText } from './lib/discovery-ranking.ts'
import {
  isDailyTopSyncDue,
  SPOTIFY_SYNC_LOCK,
  SYNC_LOCK_TTL_MS,
} from './lib/sync-schedule.ts'
import type {
  DiscoverySeed,
  SpotifyPlayHistoryItem,
  SpotifyTrack,
  SpotifyTokenResponse,
  StoredToken,
} from './types.ts'

export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'playlist-modify-private',
] as const
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
  url.searchParams.set('scope', SPOTIFY_SCOPES.join(' '))
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

async function spotifyFetch(
  pathOrUrl: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = pathOrUrl.startsWith('https://')
    ? pathOrUrl
    : `https://api.spotify.com${pathOrUrl}`
  let response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '1')
    if (
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds >= 0 &&
      retryAfterSeconds <= 120
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(retryAfterSeconds, 1) * 1000),
      )
      response = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      })
    }
  }

  return response
}

async function spotifyRequest<T>(
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await currentAccessToken()
  const response = await spotifyFetch(pathOrUrl, token, init)

  if (response.status === 401) {
    const stored = getStoredToken()
    if (!stored) throw new SpotifyAuthorizationError('Spotify is not connected.')
    const refreshed = await refreshToken(stored)
    const retry = await spotifyFetch(pathOrUrl, refreshed.accessToken, init)
    if (!retry.ok) throw new Error(`Spotify request failed with ${retry.status}.`)
    if (retry.status === 204) return undefined as T
    return (await retry.json()) as T
  }

  if (!response.ok) {
    const details = (await response.json().catch(() => null)) as
      | {
          error?: { message?: string } | string
          reason?: string
        }
      | null
    const errorMessage =
      typeof details?.error === 'string'
        ? details.error
        : details?.error?.message
    throw new Error(
      errorMessage ??
        (details?.reason
          ? `Spotify request failed with ${response.status} (${details.reason}).`
          : `Spotify request failed with ${response.status}.`),
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function getGrantedSpotifyScopes(): string[] {
  return getStoredToken()?.scope.split(/\s+/).filter(Boolean) ?? []
}

export function getMissingSpotifyScopes(): string[] {
  const granted = new Set(getGrantedSpotifyScopes())
  return SPOTIFY_SCOPES.filter((scope) => !granted.has(scope))
}

export function hasSpotifyScopes(required: readonly string[]): boolean {
  const granted = new Set(getGrantedSpotifyScopes())
  return required.every((scope) => granted.has(scope))
}

function requireSpotifyScopes(required: readonly string[]): void {
  const granted = new Set(getGrantedSpotifyScopes())
  const missing = required.filter((scope) => !granted.has(scope))
  if (missing.length) {
    throw new SpotifyAuthorizationError(
      `Spotify access must be updated to grant: ${missing.join(', ')}.`,
    )
  }
}

function spotifyTrackToSeed(
  track: SpotifyTrack,
  source: DiscoverySeed['source'],
): DiscoverySeed {
  const imageUrl = [...(track.album.images ?? [])].sort(
    (left, right) => (left.width ?? 0) - (right.width ?? 0),
  )[0]?.url
  return {
    spotifyTrackId: track.id,
    spotifyUri: track.uri,
    trackName: track.name,
    artistName: track.artists[0]?.name ?? 'Unknown artist',
    albumName: track.album.name,
    imageUrl,
    spotifyUrl: track.external_urls?.spotify,
    source,
  }
}

export async function searchSpotifyTracks(
  query: string,
  source: DiscoverySeed['source'] = 'search',
): Promise<DiscoverySeed[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const payload = await spotifyRequest<{ tracks: { items: SpotifyTrack[] } }>(
    `/v1/search?type=track&limit=10&q=${encodeURIComponent(trimmed)}`,
  )
  return payload.tracks.items.map((track) => spotifyTrackToSeed(track, source))
}

export async function resolveSpotifyTrack(
  trackName: string,
  artistName: string,
): Promise<Omit<DiscoverySeed, 'source'> | null> {
  const query = `track:${trackName} artist:${artistName}`
  const payload = await spotifyRequest<{ tracks: { items: SpotifyTrack[] } }>(
    `/v1/search?type=track&limit=5&q=${encodeURIComponent(query)}`,
  )
  const expectedTrack = normalizeDiscoveryText(trackName)
  const expectedArtist = normalizeDiscoveryText(artistName)
  const matched = payload.tracks.items.find(
    (track) =>
      normalizeDiscoveryText(track.name) === expectedTrack &&
      track.artists.some(
        (artist) => normalizeDiscoveryText(artist.name) === expectedArtist,
      ),
  )
  return matched ? spotifyTrackToSeed(matched, 'search') : null
}

export async function getSpotifyTopTracks(): Promise<DiscoverySeed[]> {
  requireSpotifyScopes(['user-top-read'])
  const payload = await spotifyRequest<{ items: SpotifyTrack[] }>(
    '/v1/me/top/tracks?time_range=short_term&limit=50',
  )
  return payload.items.map((track) => spotifyTrackToSeed(track, 'top'))
}

export async function getLikedSpotifyTracks(): Promise<DiscoverySeed[]> {
  requireSpotifyScopes(['user-library-read'])
  const payload = await spotifyRequest<{
    items: Array<{ track: SpotifyTrack }>
  }>('/v1/me/tracks?limit=50')
  return payload.items.map(({ track }) => spotifyTrackToSeed(track, 'liked'))
}

export async function createPrivateSpotifyPlaylist(
  name: string,
  description: string,
  uris: string[],
): Promise<{ id: string; name: string; url?: string }> {
  requireSpotifyScopes(['playlist-modify-private'])
  const playlist = await spotifyRequest<{
    id: string
    name: string
    external_urls?: { spotify?: string }
  }>('/v1/me/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, public: false }),
  })
  if (uris.length) {
    await spotifyRequest<void>(`/v1/playlists/${playlist.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: uris.slice(0, 100) }),
    })
  }
  return {
    id: playlist.id,
    name: playlist.name,
    url: playlist.external_urls?.spotify,
  }
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
  const snapshots = await Promise.all(
    ranges.flatMap((range) =>
      ['tracks', 'artists'].map(async (entityType) => {
        const response = await spotifyRequest<{
          items: Array<{
            id: string
            name: string
            external_urls?: { spotify?: string }
          }>
        }>(`/v1/me/top/${entityType}?time_range=${range}&limit=50`)
        return {
          range,
          entityType: entityType.slice(0, -1),
          items: response.items,
        }
      }),
    ),
  )

  for (const snapshot of snapshots) {
    saveTopSnapshot(
      capturedAt,
      snapshot.range,
      snapshot.entityType,
      snapshot.items,
    )
  }
}

export interface SyncResult {
  kind: 'recent' | 'top'
  imported: number
  message: string
  skipped: boolean
}

async function runLockedSync(
  kind: SyncResult['kind'],
  operation: () => Promise<Omit<SyncResult, 'kind' | 'skipped'>>,
): Promise<SyncResult> {
  const owner = `${process.pid}:${randomUUID()}`
  if (!acquireSyncLock(SPOTIFY_SYNC_LOCK, owner, SYNC_LOCK_TTL_MS)) {
    return {
      kind,
      imported: 0,
      message: 'Skipped because another Spotify synchronization is running.',
      skipped: true,
    }
  }

  const runId = startSyncRun(kind)
  try {
    const result = await operation()
    finishSyncRun(runId, 'success', result.imported, result.message)
    return { kind, ...result, skipped: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed.'
    finishSyncRun(runId, 'failed', 0, message)
    throw error
  } finally {
    releaseSyncLock(SPOTIFY_SYNC_LOCK, owner)
  }
}

export function syncRecentPlayback(): Promise<SyncResult> {
  return runLockedSync('recent', async () => {
    const items = await collectRecentlyPlayed()
    let imported = 0
    for (const item of items) {
      if (
        insertPlaybackEvent(item.track, item.played_at, item.context?.uri)
      ) {
        imported += 1
      }
    }
    const message = imported
      ? `Recorded ${imported} new playback event${imported === 1 ? '' : 's'}.`
      : 'No new playback events were available.'
    return { imported, message }
  })
}

export async function syncTopItems(force = false): Promise<SyncResult> {
  if (
    !force &&
    !isDailyTopSyncDue(getLatestSuccessfulSyncAt('top'))
  ) {
    return {
      kind: 'top',
      imported: 0,
      message: 'Skipped because today’s Top Items snapshot already exists.',
      skipped: true,
    }
  }

  return runLockedSync('top', async () => {
    await captureTopItems(new Date().toISOString())
    return {
      imported: 0,
      message: 'Captured six daily Top Items snapshots.',
    }
  })
}
