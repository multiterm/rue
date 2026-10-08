#!/usr/bin/env node
import {DEFAULT_AGENT_LIMIT,hostAvailableMemory,probeAdmissionResources} from './resources.js'
import { availableParallelism, platform, arch } from 'node:os'
import {localRuntimeReleases,type RuntimeRelease} from './runtime-releases.js'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { atomicState, config, readPrivate } from './config.js'
import { dockerInfo } from './docker.js'
import {enrollKey} from './key-enrollment.js'
import {runtimeRolloutTick} from './runtime-rollout.js'
import {runtimePolicy,configureRuntime,workspaceRootsFromEnvironment} from './policy.js'
import { ManagedSupervisor } from './managed.js'
import { ControlError, controlSession, wait } from './control.js'
import type { RueWorkerHealth,RueWorkerLease } from '@multiterm/rue-sdk'

export const VERSION = '0.3.0'
async function main() {
  const command = process.argv[2] ?? '--help'
  if (command === '--help' || command === 'help') {
    console.log(`rue-worker ${VERSION}\nCommands: enroll-key | run | status | doctor | runtime-policy | configure-runtime | --version\nConfiguration: RUE_WORKER_API_URL, RUE_WORKER_ID, RUE_WORKER_SECRET_FILE\nOptional: RUE_WORKER_STATE_DIR, RUE_WORKER_DOCKER_SOCKET\nTenancy bootstrap: RUE_API_KEY_FILE, RUE_WORKER_NAME, RUE_ACKNOWLEDGE_HOST_CONTROL=true\nAgent execution is an opt-in preview requiring RUE_WORKER_AGENT_IMAGE (immutable local image ID). Host mounts require an explicitly configured RUE_WORKER_MOTHERSHIP=true policy and separate per-agent filesystem grants.`); return
  }
  if (command === '--version') { console.log(VERSION); return }
  if (command === 'status') {
    const stateDir = resolve(process.env.RUE_WORKER_STATE_DIR ?? '/var/lib/rue-worker')
    const status = JSON.parse(readPrivate(join(stateDir, 'status.json')))
    console.log(JSON.stringify({ lastReported: status, stale: Date.now() - status.observedAt > 60000 }, null, 2)); return
  }
  if (!['enroll-key','doctor','run','runtime-policy','configure-runtime'].includes(command) || process.argv.length > 3) throw Error('worker_command_invalid')
  if(command==='enroll-key'){await enrollKey();console.log('Tenancy-authorized host enrolled. Transport identity saved privately. Use rue-worker run to connect.');return}
  const cfg = config()
  if (command === 'configure-runtime') {
    await configureRuntime(cfg, process.env.RUE_WORKER_AGENT_IMAGE ?? '', Number(process.env.RUE_WORKER_AGENT_LIMIT ?? String(DEFAULT_AGENT_LIMIT)), process.env.RUE_WORKER_MOTHERSHIP==='true',process.env.RUE_WORKER_ALLOW_RUNTIME_ROLLOUTS==='true',undefined,workspaceRootsFromEnvironment())
    console.log('Pinned runtime policy saved privately. Start the supervisor to reconcile agents.'); return
  }
  let policy = runtimePolicy(cfg)
  if(command==='runtime-policy'){console.log(JSON.stringify({workerId:cfg.id,apiOrigin:cfg.origin,capacity:policy?.capacity??DEFAULT_AGENT_LIMIT,mothership:policy?.mothership===true,workspaceRoots:policy?.workspaceRoots??[],allowRuntimeRollouts:policy?.allowRuntimeRollouts===true,image:policy?.image??null}));return}
  if (command === 'doctor') {
    const engine = await dockerInfo(cfg.dockerSocket)
    console.log(JSON.stringify({ configuration: 'valid', workerId: cfg.id, apiOrigin: cfg.origin, docker: engine, agentExecution: policy ? 'configured_not_verified' : 'disabled' }, null, 2)); return
  }
  const stop = new AbortController(), instance = randomUUID()
  const abort = () => stop.abort()
  process.once('SIGTERM', abort); process.once('SIGINT', abort)
  let managed = policy ? new ManagedSupervisor(cfg, instance, policy.image, policy.capacity, policy.mothership===true,policy.workspaceRoots) : undefined
  let lastObserved:{lease:RueWorkerLease;deadline:{mono:number;wall:number}}|undefined
  const rolloutsEnabled=Boolean(policy?.allowRuntimeRollouts&&!process.env.RUE_WORKER_AGENT_IMAGE)
  let healthyDocker = false, managedReady = false, delay = 1000
  let runtimeReleases:RuntimeRelease[]|undefined
  const reconciliation = (async () => {
    while (!stop.signal.aborted) {
      try { if (managed && healthyDocker) {
        if(rolloutsEnabled&&policy&&lastObserved&&managed.rolloutAuthorized){
          const generation=lastObserved.lease.generation
          try{await runtimeRolloutTick(cfg,instance,generation,policy,()=>{if(!managed?.rolloutAuthorized||lastObserved?.lease.generation!==generation||stop.signal.aborted)throw Error('worker_authority_lost')},next=>{
            managed!.stop();policy=next;managed=new ManagedSupervisor(cfg,instance,next.image,next.capacity,next.mothership===true,next.workspaceRoots)
            managed.observed(lastObserved!.lease,lastObserved!.deadline)
          },stop.signal)}catch{console.error('worker_rollout_unavailable')}
        }
        managedReady = await managed.tick()
      } } catch { managedReady = false }
      await wait(5000, stop.signal)
    }
  })()
  const health = (): RueWorkerHealth => ({ version: VERSION, platform: platform(), architecture: arch(), dockerAvailable: healthyDocker, acceptingWork: Boolean(managed && managedReady && healthyDocker), ...(policy?{runtimeImage:policy.image}:{}),...(lastObserved?.lease.runtimeReleaseVersion===1&&runtimeReleases?{runtimeReleases}:{}), ...(lastObserved?.lease.resourceHealthVersion===1?{resources:probeAdmissionResources(cfg.stateDir,policy?.capacity??DEFAULT_AGENT_LIMIT)}:{}), cpus: availableParallelism(), freeMemoryBytes: hostAvailableMemory(), capabilities: managed ? ['host-health-v1','managed-agents-v1','managed-purge-v1',...(lastObserved?.lease.runtimeReleaseVersion===1?['managed-dynamic-providers-v1']:[]),...(lastObserved?.lease.agentUpgradeVersion===1?['managed-agent-upgrade-v1']:[]),...(rolloutsEnabled?['managed-runtime-rollout-v1']:[]),...(managed.supportsMcp?['managed-mcp-v1']:[]),...(managed.supportsCompact?['managed-compact-v1']:[]),...(managed.supportsCodex?['managed-codex-v1']:[]),...(managed.supportsFilesystem?['managed-filesystem-v1']:[]),...(managed.supportsWorkspaceRoots?['managed-filesystem-v2']:[])] : ['host-health-v1'] })
  const report = (state: string, extra: Record<string, unknown> = {}) => atomicState(cfg.stateDir, 'status.json', { state, workerId: cfg.id, version: VERSION, observedAt: Date.now(), ...extra })
  // Docker diagnostics never block lease renewals or cause overlapping requests.
  const probes = (async () => {
    while (!stop.signal.aborted) {
      try { await dockerInfo(cfg.dockerSocket, stop.signal); healthyDocker = true } catch { healthyDocker = false }
      if(healthyDocker&&rolloutsEnabled&&policy){try{runtimeReleases=await localRuntimeReleases(cfg.dockerSocket,policy.image,policy.workspaceRoots?.length?'workspace-roots':policy.mothership===true,stop.signal)}catch{runtimeReleases=undefined}}
      await wait(15000, stop.signal)
    }
  })()
  try {
    while (!stop.signal.aborted) {
      try {
        report('connecting')
        await controlSession({ config: cfg, instance, signal: stop.signal, health, observed: (lease, deadline) => {
          lastObserved={lease,deadline};managed?.observed(lease, deadline)
          delay = 1000
          report('connected', { generation: lease.generation, desired: lease.worker.desired, revision: lease.worker.revision, dockerAvailable: healthyDocker, agentExecution: managed ? 'enabled' : 'disabled', acceptingWork: managedReady, runtimeRollouts:rolloutsEnabled, runtimeImage:policy?.image??null, resources:probeAdmissionResources(cfg.stateDir,policy?.capacity??DEFAULT_AGENT_LIMIT) })
        } })
      } catch (error) {
        const code = error instanceof ControlError ? error.code : 'worker_control_failed'
        report('disconnected', { reason: code }); console.error(code)
        if (!(error instanceof ControlError) || error.fatal) throw Error(code)
      }
      await wait(Math.round(delay * (0.8 + Math.random() * 0.4)), stop.signal)
      delay = Math.min(delay * 2, 30000)
    }
  } finally {
    managed?.stop(); stop.abort(); await Promise.all([probes, reconciliation])
    process.removeListener('SIGTERM', abort); process.removeListener('SIGINT', abort)
    report('stopped')
  }
}
void main().catch(error => {
  // Do not leak credentials, local paths, remote payloads or stack traces.
  const code = error instanceof Error && /^worker_[a-z_]+$/.test(error.message) ? error.message : 'worker_startup_failed'
  console.error(code); process.exitCode = 1
})
