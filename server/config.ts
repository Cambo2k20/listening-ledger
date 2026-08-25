import { existsSync } from 'node:fs'
import { join } from 'node:path'

const envPath = join(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  process.loadEnvFile(envPath)
}

export const config = {
  port: Number(process.env.PORT ?? 4317),
  clientId: process.env.SPOTIFY_CLIENT_ID?.trim() ?? '',
  redirectUri:
    process.env.SPOTIFY_REDIRECT_URI?.trim() ??
    'http://127.0.0.1:4317/auth/callback',
  uiUrl:
    process.env.UI_URL?.trim() ??
    (process.env.NODE_ENV === 'production'
      ? 'http://127.0.0.1:4317'
      : 'http://127.0.0.1:5173'),
}

