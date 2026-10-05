/** Browser/CLI contract. No credential ever belongs in the approval URL. */
export const CLI_LOGIN_GRANTS=['rue:hosts:read','rue:agents:read','rue:agents:write','rue:agents:execute'] as const
export const CLI_LOGIN_KEY_TTL_MS=3_600_000
export const CLI_LOGIN_TIMEOUT_MS=300_000
export interface CliLoginRequest {apiOrigin:string;callback:string;state:string;requestId:string;expiresAt:number}
export function controlApiOrigin(raw:string){
 let url:URL;try{url=new URL(raw)}catch{throw Error('rue_control_https_origin_required')}
 if(url.protocol!=='https:'||url.origin!==raw.replace(/\/$/,'')||url.username||url.password)throw Error('rue_control_https_origin_required')
 return url.origin
}
export function parseCliLoginRequest(fragment:string,expectedApiOrigin:string,now=Date.now()):CliLoginRequest{
 const params=new URLSearchParams(fragment.replace(/^#/,'')),keys=['apiOrigin','callback','state','requestId','expiresAt']
 if([...params.keys()].length!==keys.length||keys.some(key=>params.getAll(key).length!==1))throw Error('rue_auth_request_invalid')
 const apiOrigin=controlApiOrigin(params.get('apiOrigin')!),callback=params.get('callback')!,state=params.get('state')!,requestId=params.get('requestId')!,expiresAt=Number(params.get('expiresAt'))
 let url:URL;try{url=new URL(callback)}catch{throw Error('rue_auth_request_invalid')}
 if(apiOrigin!==controlApiOrigin(expectedApiOrigin)||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/callback'||url.search||url.hash||callback!==`http://127.0.0.1:${url.port}/callback`||Number(url.port)<1024||Number(url.port)>65535||state.length!==43||!/^[A-Za-z0-9_-]+$/.test(state)||requestId.length!==36||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+CLI_LOGIN_TIMEOUT_MS+30_000)throw Error('rue_auth_request_invalid')
 return {apiOrigin,callback,state,requestId,expiresAt}
}
