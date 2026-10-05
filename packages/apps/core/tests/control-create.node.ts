import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import yargs from 'yargs/yargs'
import {controlCommand} from '../src/cli/control.ts'
import {keyPermissionsFor} from '../src/server/tenancy-key-api.ts'

test('credentialed CLI agent creation validates consent, uses the SDK API and never retries uncertain execution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'rue-create-')),tokenFile=join(dir,'token'),configFile=join(dir,'config.json')
 const token='tnk_'+'a'.repeat(43),workerId='12345678-1234-4234-8234-123456789012',requestId='22345678-1234-4234-8234-123456789012'
 const config={provider:'anthropic',model:'test-model',permission:'coding',mounts:[],shareToolOutput:false,shareThinking:false}
 writeFileSync(tokenFile,token,{mode:0o600});writeFileSync(configFile,JSON.stringify(config),{mode:0o600})
 const originalFetch=globalThis.fetch,originalWrite=process.stdout.write,originalExit=process.exitCode
 const calls:{url:string;init:RequestInit}[]=[];let fail=false,output=''
 try{
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),init:init!});if(fail)throw Error('private transport detail '+token);return new Response(JSON.stringify({agent:{id:workerId},operation:{id:requestId}}),{headers:{'content-type':'application/json'}})}
  process.stdout.write=((value:any)=>{output+=String(value);return true}) as typeof process.stdout.write
  const run=async(extra:string[])=>{
   output='';process.exitCode=0
   await yargs().exitProcess(false).command(controlCommand).parseAsync(['control','agent-create',workerId,'--api-url','https://rue.test','--token-file',tokenFile,'--config-file',configFile,'--request-id',requestId,'--name','Test agent',...extra])
   return JSON.parse(output)
  }
  assert.equal((await run([])).error,'rue_control_execution_acknowledgement_required');assert.equal(calls.length,0)
  assert.equal((await run(['--acknowledge-execution','--name','bad\nname'])).error,'rue_control_invalid_request');assert.equal(calls.length,0)
  writeFileSync(configFile,JSON.stringify({...config,filesystem:{version:1,directories:[]}}))
  assert.equal((await run(['--acknowledge-execution'])).error,'rue_control_filesystem_acknowledgement_required');assert.equal(calls.length,0)
  writeFileSync(configFile,JSON.stringify(config))
  const result=await run(['--acknowledge-execution']);assert.equal(result.operation.id,requestId);assert.equal(calls.length,1)
  assert.equal(calls[0]!.url,'https://rue.test/managed-agents');assert.equal(calls[0]!.init.method,'POST');assert.equal(calls[0]!.init.redirect,'error')
  assert.equal(new Headers(calls[0]!.init.headers).get('authorization'),'Bearer '+token)
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string),{workerId,name:'Test agent',requestId,config,acknowledgeExecution:true})
  fail=true
  const uncertain=await run(['--acknowledge-execution']);assert.equal(calls.length,2);assert.equal(uncertain.resultUnconfirmed,true);assert.equal(uncertain.requestId,requestId);assert.equal(process.exitCode,1);assert.equal(output.includes(token),false);assert.equal(output.includes('private transport'),false)
  assert.deepEqual(keyPermissionsFor('POST','/managed-agents'),['rue:agents:write','rue:agents:execute'])
 }finally{globalThis.fetch=originalFetch;process.stdout.write=originalWrite;process.exitCode=originalExit;rmSync(dir,{recursive:true,force:true})}
})
