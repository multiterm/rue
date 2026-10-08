/** Managed-host control protocol v1. No paths, environment values or credentials in health. */
export interface RueWorkerHealth {
  version: string
  platform: string
  architecture: string
  dockerAvailable: boolean
  acceptingWork: boolean
  runtimeImage?: string
  runtimeReleases?:Array<{image:string;piVersion:string;createdAt:number}>
  resources?: {freeDiskBytes:number|null;minimumFreeDiskBytes:number;blockedBy:'disk_pressure'|'memory_pressure'|'resource_probe_failed'|null}
  freeMemoryBytes: number
  cpus: number
  // Agent execution is intentionally not advertised by the enrollment-only worker.
  capabilities: string[]
}
export interface RueWorker {
  keyAuthorityId?: string
  id: string
  ownerSubject: string
  name: string
  managedAgentCount: number
  desired: 'active' | 'draining'
  revision: number
  generation: number
  createdAt: number
  serverNow: number
  lastSeenAt: number | null
  leaseExpiresAt: number | null
  status: 'unconfirmed' | 'online' | 'offline' | 'revoked'
  health: RueWorkerHealth | null
}
export interface RueWorkerLease {
  protocol: 1
  runtimeReleaseVersion?:1;agentUpgradeVersion?:1;resourceHealthVersion?:1
  generation: number
  serverNow: number
  expiresAt: number
  worker: RueWorker
}
export type RueWorkerAction = 'drain' | 'activate' | 'revoke' | 'rotate'
