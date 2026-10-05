import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect,test} from 'vitest'
import {recoverOutbox} from '../src/recovery.js'
import type {BridgeState} from '../../../../extensions/rue/bridge.ts'
test('new boot retains ordered idempotent mirrors but archives old command bookkeeping without replay',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rue-outbox-'))
 const saved:BridgeState={origin:'https://rue.test',token:'old',id:'connection',piSessionId:'session',outbox:[{kind:'mirror',eventId:'first',role:'assistant',text:'partial',snapshot:{version:2,final:false}},{kind:'output',command:'command',version:2,text:'partial',status:'running',transcript:true},{kind:'mirror',eventId:'second',role:'assistant',text:'next'}]}
 try{
  expect(recoverOutbox(undefined,directory)).toEqual([])
  const result=recoverOutbox(saved,directory)
  expect(result.map(e=>e.kind)).toEqual(['mirror','mirror'])
  const files=readdirSync(directory);expect(files).toHaveLength(1)
  expect(JSON.parse(readFileSync(join(directory,files[0]!),'utf8'))).toEqual([saved.outbox[1]])
  expect(recoverOutbox(saved,directory)).toEqual(result);expect(readdirSync(directory)).toHaveLength(1)
  writeFileSync(join(directory,files[0]!),'corrupt')
  expect(()=>recoverOutbox(saved,directory)).toThrow('agent_recovery_storage_invalid')
 }finally{rmSync(directory,{recursive:true,force:true})}
})
