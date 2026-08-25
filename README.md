# Listening Ledger

A private, local-first Spotify listening dashboard. Listening Ledger records the
recent playback events Spotify exposes, keeps them in a local SQLite database,
and clearly separates those observations from verified 30-second streams that
can be imported from Spotify's Extended Streaming History later.

## Current MVP

- Spotify OAuth using Authorization Code with PKCE
- Minimum read-only scopes: `user-read-recently-played` and `user-top-read`
- Local SQLite persistence and playback-event deduplication
- Dashboard, history, rankings, trends, data health, and settings
- JSON and CSV export
- Honest observed-versus-verified status throughout the UI

## Set up Spotify

1. Create a Spotify developer app named **Listening Ledger**.
2. Add this exact redirect URI:
   `http://127.0.0.1:4317/auth/callback`
3. Copy `.env.example` to `.env.local`.
4. Paste the app's Client ID into `SPOTIFY_CLIENT_ID`.

No client secret is required or stored. PKCE keeps the app local and avoids
placing a secret in browser code.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

## Background collection

The synchronization paths are deliberately separate:

```powershell
npm.cmd run sync:recent
npm.cmd run sync:top
```

- `sync:recent` collects and deduplicates Recently Played events. It is safe to
  run every 15 minutes.
- `sync:top` captures Spotify's short-, medium-, and long-term Top Items once
  per UTC day.
- Both commands use the same SQLite-backed process lock, so a manual sync and a
  scheduled sync cannot refresh the Spotify token or write listening data at
  the same time.
- Spotify rate-limit responses honour `Retry-After` once before the run is
  recorded as failed.

On this Windows installation, Task Scheduler runs **Listening Ledger - Recent
Plays** every 15 minutes and **Listening Ledger - Daily Top Items** once daily.
Both tasks use the repository as their working directory so `.env.local` and
the local database resolve correctly.

## Quality checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

## Data accuracy

Spotify's Recently Played endpoint provides a track and `played_at` timestamp,
but not the actual milliseconds listened. These records are labelled **Observed
playback events**, not confirmed streams. Imported Spotify history with
`ms_played >= 30000` can be labelled **Verified streams**.

