import { Skeleton } from '@multiterm/rue-ui'
import './loading-skeleton.css'

export function LoadingSkeleton({ label, kind = 'settings' }: { label: string; kind?: 'list' | 'settings' | 'connection' | 'queue' | 'identity' }) {
  const rows = kind === 'list' ? 4 : kind === 'settings' ? 3 : 1
  return <div role="status" aria-label={label} aria-busy="true" className={`loading-skeleton loading-skeleton-${kind}`}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, i) => <div className="loading-skeleton-row" key={i}>
      {(kind === 'list' || kind === 'identity') && <Skeleton className="loading-skeleton-avatar"/>}
      <div className="loading-skeleton-lines"><Skeleton className="loading-skeleton-short"/>{kind !== 'queue' && <Skeleton className="loading-skeleton-long"/>}</div>
    </div>)}
  </div>
}
