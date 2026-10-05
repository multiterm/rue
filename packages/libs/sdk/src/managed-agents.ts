import type {FilesystemPolicy} from './filesystem.js'
export interface RueManagedAgentConfig {
  filesystem?:FilesystemPolicy
  provider: string
  model: string
  permission: 'read-only' | 'coding'
  mounts: string[]
  mcp?: string[]
  shareToolOutput: boolean
  shareThinking: boolean
  thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'
  autoCompaction?: boolean
}
export interface RueManagedAgent {
  runtimeImage?:string|null;previousRuntimeImage?:string|null;runtimeUpdateState?:'updating'|'rolling_back'|'updated'|'rolled_back'|'failed'|'cancelled'|null;runtimeUpdateVersion?:string|null
  id: string; workerId: string; sessionId: string | null; connectionId: string | null; name: string
  desired: 'running' | 'stopped' | 'destroyed'; purgeRequested?:boolean; purgedAt?:number|null; revision: number; createdAt: number
  config: RueManagedAgentConfig
  observed: 'pending' | 'starting' | 'running' | 'stopped' | 'destroyed' | 'purged' | 'failed'
  observedRevision: number | null; observedGeneration: number | null; observedAt: number | null
  error: string | null
}
export interface RueManagedOperation {
  id: string; agentId: string; revision: number; action: string
  status: 'pending' | 'succeeded' | 'superseded'; createdAt: number; completedAt: number | null
}
export interface RueManagedConfigureInput {requestId:string;expectedRevision:number;config:RueManagedAgentConfig;acknowledgeExecution:true;acknowledgeFilesystem?:true}
export interface RueManagedUpgradeInput {requestId:string;expectedRevision:number;image:string;expectedImage:string;piVersion:string;acknowledgeExecution:true}
export type RueManagedAction = 'stop' | 'resume' | 'reload' | 'destroy' | 'purge' | 'configure' | 'upgrade'
