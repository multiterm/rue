import { useContext } from 'react'
import { LiveSyncContext } from './live-sync'
import { useQuery } from '@tanstack/react-query'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import { rue } from './client'

// The queue panel and pinned activity bubble observe the same request/cache.
export function useComputerQueue(computer?: RueRemoteComputer, poll = true) {
  const live = useContext(LiveSyncContext)
  return useQuery({
    queryKey: ['message-queue', computer?.ownerSubject, computer?.id],
    queryFn: () => rue.computerQueue(computer!.id),
    enabled: Boolean(computer),
    refetchInterval: !poll ? false : live ? 10000 : 2000, refetchOnWindowFocus: poll, retry: false,
  })
}
