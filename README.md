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

