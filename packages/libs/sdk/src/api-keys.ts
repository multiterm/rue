export const RUE_KEY_PERMISSIONS=[
 {id:'rue:hosts:read',label:'View hosts'},
 {id:'rue:hosts:enroll',label:'Enroll hosts'},
 {id:'rue:hosts:manage',label:'Manage hosts'},
 {id:'rue:agents:read',label:'View bots'},
 {id:'rue:agents:write',label:'Manage bots'},
 {id:'rue:agents:execute',label:'Run bots'},
 {id:'rue:runtimes:read',label:'View runtime rollouts'},
 {id:'rue:runtimes:deploy',label:'Deploy runtime images (host execution)' },
 {id:'rue:mcp:read',label:'View MCP tools'},
 {id:'rue:mcp:write',label:'Manage MCP tools'},
] as const
export type RueKeyPermission=typeof RUE_KEY_PERMISSIONS[number]['id']
export const RUE_KEY_PRESETS={All:RUE_KEY_PERMISSIONS.map(p=>p.id),'Read only':['rue:hosts:read','rue:agents:read','rue:mcp:read','rue:runtimes:read'] as RueKeyPermission[],Enrollment:['rue:hosts:read','rue:hosts:enroll','rue:agents:execute'] as RueKeyPermission[],Restricted:[] as RueKeyPermission[]}
export type RueApiKeyOwner={type:'self';subject?:string}|{type:'project';organizationId:string;projectId:string}
export interface RueApiKey {id:string;owner:RueApiKeyOwner;name:string;service:'rue';grants:string[];createdAt:number;expiresAt:number;revokedAt:number|null}
export interface RueApiKeyInput {owner:RueApiKeyOwner;name:string;grants:string[];expiresAt:number;requestId:string}
