import { useEffect, useMemo, useReducer } from 'react'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import {remoteObservationRemaining} from './remote-observation'

/** Age a server observation locally; browser wall-clock skew is not disconnection. */
export function useRemoteFreshness(computer?: RueRemoteComputer, observedAt?: number) {
  const [, refresh] = useReducer(value => value + 1, 0)
  const sample = useMemo(() => {
    return { received: performance.now(), remaining: remoteObservationRemaining(computer,observedAt) }
  }, [computer, observedAt])
  useEffect(() => {
    if (computer?.status !== 'online' || sample.remaining <= 0) return
    const timer = setTimeout(refresh, Math.ceil(sample.remaining) + 1)
    return () => clearTimeout(timer)
  }, [sample, computer?.status])
  return computer?.status === 'online' && performance.now() - sample.received < sample.remaining
}
