import type {RuePlatformAccess,RueKeyPermission} from '@multiterm/rue-sdk'
import {keyResourceOwner,type TenancyKey} from './tenancy-keys.js'
const operations:Array<{id:string;requiredGrants:RueKeyPermission[];managed?:true}>=[
 {id:'hosts.read',requiredGrants:['rue:hosts:read']},
 {id:'hosts.enroll',requiredGrants:['rue:hosts:enroll','rue:agents:execute']},
 {id:'hosts.manage',requiredGrants:['rue:hosts:manage']},
 {id:'agents.read',requiredGrants:['rue:agents:read'],managed:true},
 {id:'agents.create',requiredGrants:['rue:agents:write','rue:agents:execute'],managed:true},
 {id:'agents.configure',requiredGrants:['rue:agents:write','rue:agents:execute'],managed:true},
 {id:'agents.upgrade',requiredGrants:['rue:agents:write','rue:agents:execute'],managed:true},
 {id:'agents.lifecycle',requiredGrants:['rue:agents:write','rue:agents:execute'],managed:true},
 {id:'runtimes.read',requiredGrants:['rue:runtimes:read'],managed:true},
 {id:'runtimes.deploy',requiredGrants:['rue:runtimes:deploy','rue:agents:execute'],managed:true},
 {id:'mcp.read',requiredGrants:['rue:mcp:read'],managed:true},
 {id:'mcp.manage',requiredGrants:['rue:mcp:write'],managed:true},
]
/** Only call after current-key verification. Unknown/wildcard grants confer nothing. */
export function platformAccess(key:TenancyKey,managedAgents:boolean):RuePlatformAccess{
 return {version:1,key:{id:key.id,owner:key.owner,resourceOwner:keyResourceOwner(key),expiresAt:key.expiresAt},fullPlatformAdministration:false,
  operations:operations.map(({id,requiredGrants,managed})=>({id,requiredGrants:[...requiredGrants],status:managed&&!managedAgents?'disabled':requiredGrants.every(grant=>key.grants.includes(grant))?'authorized':'missing_permissions'})),
  unavailable:[
   {id:'host.filesystem',reason:'native_controller_required'},
   {id:'host.execute',reason:'native_controller_required'},
   {id:'platform.release',reason:'sandblocks_integration_required'},
   {id:'platform.database',reason:'operator_operation_required'},
   {id:'platform.administration',reason:'administrator_binding_required'},
  ]}
}
