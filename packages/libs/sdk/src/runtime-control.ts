export interface RueRuntimeControlGrant {
 ownerSubject:string;agentId:string;agentRevision:number;workerId:string;workerName:string;connectionId:string|null;
 revision:number;enabled:boolean;expiresAt:number|null;updatedAt:number|null;serverNow:number;managerReady:boolean;
 audit:Array<{action:string;createdAt:number;rolloutId:string|null}>
}
export type RueRuntimeControlGrantInput={expectedOwnerSubject:string;expectedRevision:number}&(
 {enabled:false}|
 {enabled:true;expectedAgentRevision:number;expectedWorkerId:string;expectedConnectionId:string;expiresInSeconds:3600|86400|604800;acknowledgeHostControl:true}
)
