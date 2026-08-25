import type { DetailEntityType } from '../types'

export function detailPath(type: DetailEntityType, id: string): string {
  return `/${type}s/${encodeURIComponent(id)}`
}
