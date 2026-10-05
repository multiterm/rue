import type {RueApiKeyOwner,RueKeyPermission} from './api-keys.js'
/** Authorization discovery, not proof that a particular host/image is ready. */
export interface RuePlatformAccess {
 version:1
 key:{id:string;owner:RueApiKeyOwner;resourceOwner:string;expiresAt:number}
 fullPlatformAdministration:false
 operations:Array<{id:string;status:'authorized'|'missing_permissions'|'disabled';requiredGrants:RueKeyPermission[]}>
 unavailable:Array<{id:'host.filesystem'|'host.execute'|'platform.release'|'platform.database'|'platform.administration';reason:'native_controller_required'|'sandblocks_integration_required'|'operator_operation_required'|'administrator_binding_required'}>
}
