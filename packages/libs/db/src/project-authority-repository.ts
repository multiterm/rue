export interface ProjectClaims {
 id:string;organizationId:string;projectId:string;service:'rue';scopes:string[];expiresAt:number
 owner:{type:'self';subject:string}|{type:'project';organizationId:string;projectId:string}
}
export class ProjectError extends Error {
 constructor(readonly status:401|404|409|429,readonly code:string){super(code)}
}
export interface ProjectAuthorityRepository {
 bindingOwner(id:string):Promise<string|undefined>
 credential(id:string,origin:string):Promise<{revision:number;token:string}>
 updateProof(id:string,revision:number,claims:ProjectClaims|undefined,started:number,now?:number):Promise<boolean>
 ownedWorkerBinding(id:string,owner:string):Promise<{bindingId:string|null}|undefined>
 fenceOnBoot():Promise<void>
}
