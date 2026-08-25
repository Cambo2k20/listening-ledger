import {
  Check,
  Clipboard,
  Download,
  ExternalLink,
  KeyRound,
  LogOut,
  Shield,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageIntro, Panel } from '../components/Ui'
import { useAppContext } from '../context'
import { api } from '../lib/api'

const authMessages: Record<string, string> = {
  connected: 'Spotify access updated. Syncing, discovery, and player control are ready.',
  denied: 'Spotify authorization was cancelled.',
  invalid: 'Spotify returned an incomplete authorization response.',
  failed: 'Spotify authorization failed. Check the Client ID and redirect URI.',
}

export default function SettingsScreen() {
  const { status, refreshStatus } = useAppContext()
  const [params] = useSearchParams()
  const [copied, setCopied] = useState(false)
  const authState = params.get('auth')

  useEffect(() => {
    if (authState === 'connected') void refreshStatus()
  }, [authState, refreshStatus])

  const copyRedirect = async () => {
    if (!status?.redirectUri) return
    await navigator.clipboard.writeText(status.redirectUri)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const disconnect = async () => {
    await api('/api/disconnect', { method: 'POST' })
    await refreshStatus()
  }

  return (
    <>
      <PageIntro
        eyebrow="Local configuration"
        title="Connect without over-sharing."
        description="Listening Ledger requests six purpose-limited scopes and stores authorization tokens only in its local, Git-ignored database. Playlist access is limited to creating private playlists."
      />

      {authState && authMessages[authState] && (
        <div className={`notice ${authState === 'connected' ? 'notice--success' : 'notice--warning'}`}>
          <Shield size={20} />
          <span>{authMessages[authState]}</span>
        </div>
      )}

      <div className="settings-grid">
        <Panel title="Spotify developer app" kicker="Required once">
          <div className="setup-steps">
            <div className={status?.configured ? 'complete' : ''}>
              <span>{status?.configured ? <Check size={17} /> : '1'}</span>
              <div>
                <strong>Add the Client ID</strong>
                <p>
                  Copy <code>.env.example</code> to <code>.env.local</code> and
                  add <code>SPOTIFY_CLIENT_ID</code> and <code>LASTFM_API_KEY</code>.
                </p>
              </div>
            </div>
            <div>
              <span>2</span>
              <div>
                <strong>Register this redirect URI</strong>
                <p>It must match exactly in the Spotify developer dashboard.</p>
                <button className="copy-field" onClick={() => void copyRedirect()}>
                  <code>{status?.redirectUri}</code>
                  {copied ? <Check size={16} /> : <Clipboard size={16} />}
                </button>
              </div>
            </div>
            <div className={status?.connected ? 'complete' : ''}>
              <span>{status?.connected ? <Check size={17} /> : '3'}</span>
              <div>
                <strong>Authorize your account</strong>
                <p>Spotify will show the six permissions listed alongside this panel.</p>
              </div>
            </div>
          </div>

          <div className="settings-actions">
            {status?.connected ? (
              <>
                <span className="connected-label">
                  <i /> Connected as {status.account?.displayName || 'Spotify user'}
                </span>
                {Boolean(status.missingScopes.length) && (
                  <a className="button button--primary" href="/api/auth/start">
                    <KeyRound size={16} /> Update access
                  </a>
                )}
                <button className="button button--danger" onClick={() => void disconnect()}>
                  <LogOut size={16} /> Disconnect
                </button>
              </>
            ) : (
              <a
                className={`button button--primary ${!status?.configured ? 'disabled' : ''}`}
                href={status?.configured ? '/api/auth/start' : undefined}
                aria-disabled={!status?.configured}
              >
                <KeyRound size={16} /> Connect Spotify
              </a>
            )}
          </div>
        </Panel>

        <Panel title="Permissions" kicker="Purpose limited">
          <div className="permission-list">
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Recently played</strong>
                <code>user-read-recently-played</code>
                <p>Tracks and their playback timestamps. No milliseconds listened.</p>
              </div>
            </article>
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Liked songs</strong>
                <code>user-library-read</code>
                <p>Lets you choose saved tracks as discovery seeds. It cannot change your library.</p>
              </div>
            </article>
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Private playlists</strong>
                <code>playlist-modify-private</code>
                <p>Creates the private playlist you approve after reviewing recommendations.</p>
              </div>
            </article>
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Top items</strong>
                <code>user-top-read</code>
                <p>Spotify affinity rankings for short, medium, and long periods.</p>
              </div>
            </article>
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Playback state</strong>
                <code>user-read-playback-state</code>
                <p>Reads the active Spotify Connect device, current track, and playback position.</p>
              </div>
            </article>
            <article>
              <span>
                <Shield size={18} />
              </span>
              <div>
                <strong>Playback control</strong>
                <code>user-modify-playback-state</code>
                <p>Controls playback on the Spotify device you select. It does not stream audio through Listening Ledger.</p>
              </div>
            </article>
          </div>
          <a
            className="policy-link"
            href="https://developer.spotify.com/documentation/web-api/concepts/scopes"
            target="_blank"
            rel="noreferrer"
          >
            Review Spotify scopes <ExternalLink size={14} />
          </a>
        </Panel>

        <Panel title="Export local data" kicker="Your copy">
          <p className="panel-copy">
            Export the observed ledger at any time. These files contain listening
            history, so treat them as private.
          </p>
          <div className="export-actions">
            <a className="button button--quiet" href="/api/export?format=json">
              <Download size={16} /> JSON
            </a>
            <a className="button button--quiet" href="/api/export?format=csv">
              <Download size={16} /> CSV
            </a>
          </div>
        </Panel>

        <Panel title="Extended history" kicker="Planned import">
          <p className="panel-copy">
            The database already separates imported verified streams from observed
            API events. File import will be enabled when your Spotify archive is
            available.
          </p>
          <button className="button button--quiet" disabled>
            Import Spotify archive
          </button>
        </Panel>
      </div>
    </>
  )
}
