import { createContext } from 'react'

/** SSE provides low-latency invalidations, not proof that every change arrived.
 * Remote transcript/queue/health reads reconcile every 10s while connected and
 * more frequently after transport loss. These reads never resend prompts. */
export const LiveSyncContext = createContext(false)
