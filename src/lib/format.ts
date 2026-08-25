export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

export function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded yet'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function formatUtcDate(value?: string | null): string {
  if (!value) return 'Not recorded yet'
  const day = value.slice(0, 10)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))
}

export function formatDateTime(value?: string | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (milliseconds > 0 && totalMinutes === 0) return '<1m'
  if (hours === 0) return `${formatNumber(totalMinutes)}m`
  return minutes === 0
    ? `${formatNumber(hours)}h`
    : `${formatNumber(hours)}h ${minutes}m`
}

export function relativeTime(value?: string | null): string {
  if (!value) return 'Never'
  const delta = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
