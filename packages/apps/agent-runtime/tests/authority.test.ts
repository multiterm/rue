import {expect,test} from 'vitest'
import {AuthorityClock,readAuthority} from '../src/authority.js'
import {grantSchema} from '../src/config.js'
const grant=grantSchema.parse({version:1,origin:'https://rue.test',agentId:'12345678-1234-4234-8234-123456789012',piSessionId:'12345678-1234-4234-8234-123456789012',revision:1,generation:1,connectionId:'term_'+'a'.repeat(32),token:'rue_terminal_'+'a'.repeat(43),ownerSubject:'owner',sessionId:'session',config:{provider:'openai',model:'gpt-4.1-mini',permission:'read-only',mounts:[],shareToolOutput:false,shareThinking:false}})
test('runtime settings survive manager grants and reject invalid values',()=>{
 const config={...grant.config,thinkingLevel:'high',autoCompaction:true}
 expect(grantSchema.parse({...grant,config}).config).toMatchObject({thinkingLevel:'high',autoCompaction:true})
 expect(grantSchema.safeParse({...grant,config:{...config,thinkingLevel:'invalid'}}).success).toBe(false)
 expect(grantSchema.safeParse({...grant,config:{...config,autoCompaction:'true'}}).success).toBe(false)
})
const authority={id:grant.connectionId,piSessionId:grant.piSessionId,ownerSubject:'owner',serverNow:1000,expiresAt:61000,relayExpiresAt:61000}
test('authority is bounded by request start, monotonic time and wall-clock jumps',()=>{
 const clock=new AuthorityClock();expect(clock.valid(1,1)).toBe(false)
 clock.accept(authority,grant,100,1000);expect(clock.valid(1000,2000)).toBe(true)
 expect(clock.valid(59100,2000)).toBe(false)
 clock.accept(authority,grant,100,1000);expect(clock.valid(200,60000)).toBe(false)
 clock.accept(authority,grant,100,10000);expect(clock.valid(200,8000)).toBe(false)
})
test('another connection, owner, identity or excessive lease cannot authorize execution',()=>{
 for(const change of [{id:'wrong'},{piSessionId:'wrong'},{ownerSubject:'other'},{expiresAt:61001},{expiresAt:1000},{serverNow:NaN}])expect(()=>new AuthorityClock().accept({...authority,...change},grant,0,0)).toThrow('agent_authority_invalid')
})
test('bootstrap cannot renew indefinitely and a blocked relay cannot use a healthy worker lease',()=>{
 const clock=new AuthorityClock()
 clock.accept({...authority,relayExpiresAt:null},grant,0,1000)
 clock.accept({...authority,relayExpiresAt:null},grant,40000,41000)
 expect(clock.valid(59000,60000)).toBe(false)
 const running=new AuthorityClock()
 running.accept({...authority,relayExpiresAt:11000},grant,0,1000)
 expect(running.valid(9000,10000)).toBe(false)
 expect(()=>running.accept({...authority,relayExpiresAt:null},grant,0,1000)).toThrow('agent_authority_invalid')
 expect(()=>running.accept({...authority,relayExpiresAt:undefined},grant,0,1000)).toThrow('agent_authority_invalid')
})
test('guardian checks are nonredirecting, private, bounded and do not disclose tokens in errors',async()=>{
 const clock=new AuthorityClock()
 await readAuthority(grant,clock,async(url,options)=>{
  expect(String(url)).not.toContain(grant.token);expect(options?.redirect).toBe('error');expect(options?.cache).toBe('no-store')
  return Response.json(authority)
 });expect(clock.valid()).toBe(true)
 await expect(readAuthority(grant,clock,async()=>new Response(grant.token,{status:401}))).rejects.toThrow('agent_authority_rejected')
 await expect(readAuthority(grant,clock,async()=>new Response(' '.repeat(8193)))).rejects.toThrow('agent_authority_invalid')
})
