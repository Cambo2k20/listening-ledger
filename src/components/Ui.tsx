import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Disc3 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="page-intro">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  tone?: 'neutral' | 'lime' | 'amber' | 'violet'
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-icon">
        <Icon size={19} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

export function EmptyState({
  title,
  detail,
  actionLabel = 'Open settings',
  actionTo = '/settings',
}: {
  title: string
  detail: string
  actionLabel?: string
  actionTo?: string
}) {
  return (
    <div className="empty-state">
      <div className="empty-record">
        <Disc3 size={32} />
        <span />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      <Link className="text-link" to={actionTo}>
        {actionLabel} <ArrowRight size={15} />
      </Link>
    </div>
  )
}

export function Panel({
  title,
  kicker,
  action,
  children,
  className = '',
}: {
  title: string
  kicker?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          {kicker && <span>{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <div>
            <i />
            <i />
          </div>
        </div>
      ))}
    </div>
  )
}

