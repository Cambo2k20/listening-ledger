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

export function formatDateTime(value?: string | null): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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

