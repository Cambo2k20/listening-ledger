# Listening Ledger

[![MIT License](https://img.shields.io/badge/license-MIT-b7ff3c.svg)](LICENSE)

A private, local-first Spotify listening dashboard. Listening Ledger records the
recent playback events Spotify exposes, keeps them in a local SQLite database,
and clearly separates those observations from verified 30-second streams that
can be imported from Spotify's Extended Streaming History later.

> Playback timestamps are evidence that Spotify returned an event. They are not
> proof that 30 seconds of the track were played. Listening Ledger keeps that
> distinction visible throughout the product.

## Current MVP

- Spotify OAuth using Authorization Code with PKCE
- Purpose-limited Spotify scopes for history, top items, liked-song seeds,
  private playlists, and Spotify Connect playback control
- Local SQLite persistence and playback-event deduplication
- Dashboard, history, rankings, trends, explainable music discovery, data
  health, and settings
- Last.fm similar-track discovery matched back to playable Spotify tracks
- Local Love, Reject, and Already Know feedback with review before playlist save
- Persistent Spotify Connect controller with device transfer, transport,
  position, and volume controls
- JSON and CSV export
- Honest observed-versus-verified status throughout the UI

## Technology

- React, TypeScript, and Vite
- Express API
- SQLite through Node's built-in `node:sqlite` module
- Spotify Authorization Code flow with PKCE
- Vitest and ESLint

## Prerequisites

- Node.js 22.5 or newer
- A Spotify account
- A Spotify developer app in Development Mode or Extended Quota Mode
- A free Last.fm API key

## Set up Spotify

1. Create a Spotify developer app named **Listening Ledger**.
2. Add this exact redirect URI:
   `http://127.0.0.1:4317/auth/callback`
3. Under **APIs used**, enable **Web API** only. The Web Playback SDK and
   Android SDK are not used.
4. Copy `.env.example` to `.env.local`.
5. Paste the app's Client ID into `SPOTIFY_CLIENT_ID`.
6. Paste the Last.fm API key into `LASTFM_API_KEY`.

No client secret is required or stored. PKCE keeps the app local and avoids
placing a secret in browser code.

On the next authorization, Spotify requests:

- `user-read-recently-played`
- `user-top-read`
- `user-library-read`
- `playlist-modify-private`
- `user-read-playback-state`
- `user-modify-playback-state`

Playlist access only creates or updates private playlists after explicit review;
it does not grant public-playlist access. Playback access reads and controls the
active Spotify Connect session. Audio remains in Spotify and Spotify Premium is
required for playback-control endpoints.

## Spotify Connect player

The persistent player bar controls an available Spotify client, such as the
Spotify desktop app. It does not embed or proxy Spotify audio. Track names and
artwork start playback through Spotify Connect. Separate desktop and browser
icons open each item in the installed Spotify app or Spotify Web Player. On
Windows, the local API validates the Spotify URI and asks the operating system
to open it, so the Desktop icon also works from embedded browsers that block
custom `spotify:` links.

To make Spotify Web Player appear in the device selector, open it, start a track
once, and then refresh Listening Ledger's device list. Spotify only returns
clients it currently considers available Spotify Connect devices.

Listening Ledger refreshes playback state every 10 seconds while the browser tab
is visible and animates elapsed time locally between refreshes. This keeps the
interface responsive without making a Web API request every second.

## Discovery Builder

Choose up to five tracks from the local ledger, Spotify Top Items, Liked Songs,
or Spotify search. Safe, Balanced, and Wild modes adjust how strongly the result
set favours unfamiliar artists. Exact tracks already in the ledger, rejected
tracks, and common live/remaster variants are removed before ranking. No more
than two recommendations from one artist are returned.

Generation runs only when requested. Last.fm supplies similarity data and is
credited in the interface; Spotify search supplies playable matches. Spotify
content is not used to train a model.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`.

Your Spotify token and listening database are written beneath the local
checkout. They are ignored by Git and should never be committed.

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

For reliable background collection, configure your operating system's scheduler
to run `npm run sync:recent` every 15 minutes and `npm run sync:top` once daily.
Set the repository root as the working directory so `.env.local` and the local
database resolve correctly. The web server does not start a second background
timer, so the scheduler remains the single automatic collection path.

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

Recently Played returns at most 50 events per page. Listening Ledger follows
additional pages when Spotify provides them, but a long collection gap can still
leave history that the API no longer exposes. Keeping the scheduled collector
running reduces that risk.

## Privacy

- OAuth credentials and listening data remain local by default.
- `.env.local`, `.data/`, build output, logs, and dependencies are excluded from
  version control.
- Exported JSON and CSV files may contain personal listening history; review them
  before sharing.
- The current application is single-user. Adding more people to a Spotify
  Development Mode allowlist does not isolate their data inside this app.

## Roadmap

- Import Spotify Extended Streaming History
- Verified stream counts and exact listening time
- Track and artist detail pages
- Calendar, sessions, records, and streaks
- Ranking movement from daily Top Items snapshots
- Discovery-session history and richer feedback analytics

## License

[MIT](LICENSE)
