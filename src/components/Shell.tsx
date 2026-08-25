import {
  Activity,
  BarChart3,
  Clock3,
  DatabaseZap,
  Gauge,
  History,
  Menu,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAppContext } from '../context'

const navigation = [
  { to: '/', label: 'Overview', icon: Gauge, end: true },
  { to: '/history', label: 'History', icon: History },
  { to: '/rankings', label: 'Rankings', icon: BarChart3 },
  { to: '/trends', label: 'Trends', icon: Activity },
  { to: '/health', label: 'Data health', icon: DatabaseZap },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const pageNames: Record<string, string> = {
  '/': 'Overview',
  '/history': 'Listening history',
  '/rankings': 'Your rankings',
  '/trends': 'Listening trends',
  '/health': 'Data health',
  '/settings': 'Settings',
}

export default function Shell() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { status, syncing, syncMessage, syncNow } = useAppContext()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Listening Ledger</strong>
            <small>Private listening record</small>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <X size={19} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Primary">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="source-card">
            <Clock3 size={17} />
            <div>
              <span>Current source</span>
              <strong>Observed events</strong>
            </div>
            <i className="status-dot status-dot--amber" />
          </div>
          <p>
            Recently Played has timestamps, not milliseconds listened. Verified
            streams arrive with your Spotify export.
          </p>
        </div>
      </aside>

      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button menu-button"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div>
              <small>Listening Ledger</small>
              <strong>{pageNames[location.pathname] ?? 'Listening Ledger'}</strong>
            </div>
          </div>

          <div className="topbar-actions">
            {syncMessage && <span className="sync-message">{syncMessage}</span>}
            <button
              className="button button--quiet"
              onClick={() => void syncNow()}
              disabled={!status?.connected || syncing}
            >
              <RefreshCw size={16} className={syncing ? 'spin' : ''} />
              {syncing ? 'Syncing' : 'Sync now'}
            </button>
            <NavLink
              to="/settings"
              className={`account-chip ${status?.connected ? 'account-chip--connected' : ''}`}
            >
              <span>{status?.account?.displayName?.slice(0, 1) ?? 'L'}</span>
              <div>
                <strong>
                  {status?.connected
                    ? status.account?.displayName || 'Spotify connected'
                    : 'Not connected'}
                </strong>
                <small>{status?.connected ? 'Local account' : 'Set up Spotify'}</small>
              </div>
            </NavLink>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

