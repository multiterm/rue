export type RueRuntimeRolloutPhase='preflight'|'draining'|'stopping'|'installing'|'verifying'|'rollback_stopping'|'rollback_installing'|'rollback_verifying'|'succeeded'|'failed'|'uncertain'
export interface RueRuntimeRollout {
 id:string;workerId:string;requestId:string;phase:RueRuntimeRolloutPhase;image:string;previousImage:string;createdAt:number;updatedAt:number;expiresAt:number;error:string|null
}
export interface RueRuntimeRolloutInput {
 requestId:string;expectedWorkerRevision:number;expectedImage:string;image:string;acknowledgeHostExecution:true
}
export const RUNTIME_ROLLOUT_CAPABILITY='managed-runtime-rollout-v1'
