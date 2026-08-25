import {
  CheckCircle2,
  CircleAlert,
  Database,
  Radio,
  ShieldCheck,
  WifiOff,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { MetricCard, PageIntro, Panel, Skeleton } from '../components/Ui'
import { api } from '../lib/api'
import { formatNumber, relativeTime } from '../lib/format'
import type { HealthData } from '../types'

const riskCopy = {
  'not-started': {
    title: 'Collection has not started',
    detail: 'Connect Spotify and run the first sync.',
    icon: WifiOff,
  },
  healthy: {
    title: 'Collection is current',
    detail: 'A successful sync was recorded within the last 24 hours.',
    icon: CheckCircle2,
  },
  attention: {
    title: 'Sync is getting stale',
    detail: 'More than 24 hours have passed since the last successful sync.',
    icon: CircleAlert,
  },
  elevated: {
    title: 'Possible collection gap',
    detail: 'More than 72 hours have passed. Spotify may no longer expose every missed event.',
    icon: CircleAlert,
  },
}

export default function DataHealthScreen() {
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api<HealthData>('/api/health')
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  const risk = riskCopy[data?.risk ?? 'not-started']
  const RiskIcon = risk.icon

  return (
    <>
      <PageIntro
        eyebrow="Trust layer"
        title="Know what the ledger knows."
        description="Connection state, synchronization recency, source coverage, and failures are visible instead of hidden behind a reassuring green tick."
      />
      <div className="metric-grid metric-grid--three">
        <MetricCard
          label="Observed events"
          value={formatNumber(data?.counts.observed ?? 0)}
          detail="Recently Played records"
          icon={Radio}
          tone="lime"
        />
        <MetricCard
          label="Verified streams"
          value={formatNumber(data?.counts.verified ?? 0)}
          detail="At least 30 seconds listened"
          icon={ShieldCheck}
          tone="violet"
        />
        <MetricCard
          label="Failed syncs"
          value={formatNumber(data?.counts.failures ?? 0)}
          detail="Kept for diagnosis"
          icon={CircleAlert}
          tone="amber"
        />
      </div>
      <div className="health-grid">
        <Panel title="Collection status" kicker="Current assessment">
          {loading ? (
            <Skeleton rows={3} />
          ) : (
            <div className={`risk-card risk-card--${data?.risk}`}>
              <span>
                <RiskIcon size={23} />
              </span>
              <div>
                <strong>{risk.title}</strong>
                <p>{risk.detail}</p>
              </div>
            </div>
          )}
          <dl className="health-facts">
            <div>
              <dt>Spotify configuration</dt>
              <dd>{data?.configured ? 'Client ID present' : 'Client ID missing'}</dd>
            </div>
            <div>
              <dt>Account authorization</dt>
              <dd>{data?.connected ? 'Connected' : 'Not connected'}</dd>
            </div>
            <div>
              <dt>Last successful sync</dt>
              <dd>{relativeTime(data?.lastSuccessAt)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Latest synchronization" kicker="Audit record">
          {data?.latestSync ? (
            <div className="sync-audit">
              <span className={`sync-state sync-state--${data.latestSync.status}`}>
                {data.latestSync.status}
              </span>
              <strong>{data.latestSync.message || 'No message recorded.'}</strong>
              <p>
                {data.latestSync.importedEvents} new event
                {data.latestSync.importedEvents === 1 ? '' : 's'} imported.
              </p>
              <small>{relativeTime(data.latestSync.completedAt || data.latestSync.startedAt)}</small>
            </div>
          ) : (
            <div className="sync-audit sync-audit--empty">
              <Database size={25} />
              <strong>No synchronization attempts yet</strong>
              <p>The first attempt will appear here whether it succeeds or fails.</p>
            </div>
          )}
          <div className="local-path">
            <Database size={16} />
            <div>
              <span>Local database</span>
              <code>{data?.databasePath ?? 'Loading…'}</code>
            </div>
          </div>
        </Panel>
      </div>
    </>
  )
}

