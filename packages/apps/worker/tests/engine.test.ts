import {createServer,type Server} from 'node:http'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {afterEach,expect,test} from 'vitest'
import {engineRequest,grantArchive,EngineError} from '../src/engine.js'
let server:Server|undefined,dir:string|undefined
afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));if(dir)rmSync(dir,{recursive:true,force:true});server=undefined;dir=undefined})
test('Unix transport bounds bodies, rejects redirects and sanitizes daemon failures',async()=>{
 dir=mkdtempSync('/tmp/rue-engine-');const socket=join(dir,'socket')
 server=createServer((req,res)=>{
  if(req.url==='/ok'){res.end('{"ok":true}');return}
  if(req.url==='/large'){res.end(' '.repeat(1048577));return}
  res.writeHead(302,{location:'https://untrusted.test'});res.end('secret-diagnostic')
 })
 await new Promise<void>(resolve=>server!.listen(socket,resolve))
 expect(await engineRequest(socket,'GET','/ok')).toEqual({ok:true})
 await expect(engineRequest(socket,'GET','/redirect')).rejects.toMatchObject({status:302,message:'worker_engine_request_failed'})
 await expect(engineRequest(socket,'GET','/large')).rejects.toBeInstanceOf(EngineError)
})
test('credential transfer is one fixed-path, root-owned 0600 tar member',()=>{
 const value={token:'test-only'},archive=grantArchive(value),header=archive.subarray(0,512)
 expect(header.subarray(0,100).toString().replace(/\0.*$/s,'')).toBe('grant.json')
 expect(parseInt(header.subarray(100,108).toString(),8)).toBe(0o600)
 expect(parseInt(header.subarray(108,116).toString(),8)).toBe(0)
 const size=parseInt(header.subarray(124,136).toString(),8)
 expect(JSON.parse(archive.subarray(512,512+size).toString())).toEqual(value)
 const checksum=parseInt(header.subarray(148,156).toString(),8);header.fill(32,148,156)
 expect(header.reduce((sum,byte)=>sum+byte,0)).toBe(checksum)
 expect(archive.length%512).toBe(0)
 expect(()=>grantArchive({token:'a'.repeat(32769)})).toThrow('worker_grant_too_large')
})
