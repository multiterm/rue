import {expect,test} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
test('static apps load uncached public runtime config before their module entry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rue-static-runtime-'))
 await writeFile(join(dir,'index.html'),'<html><head><script type="module" src="/app.js"></script></head><body></body></html>')
 const child=spawn(process.execPath,[resolve('scripts/serve-static.mjs'),dir,'0'],{env:{PATH:process.env.PATH,SANDBLOCKS_SERVICE_API_URL:'https://runtime.example',RUE_PRIVATE_TEST:'must-not-appear'},stdio:['ignore','pipe','pipe']})
 const exited=new Promise(resolve=>child.once('exit',resolve))
 try{
  const port=await new Promise<string>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server startup timed out')),5000)
   child.once('error',error=>{clearTimeout(timer);reject(error)})
   child.stdout.on('data',data=>{const match=String(data).match(/listening on (\d+)/);if(match){clearTimeout(timer);resolve(match[1]!)}})
  })
  const html=await(await fetch(`http://127.0.0.1:${port}/login`)).text()
  expect(html.indexOf('/public-config.js')).toBeLessThan(html.indexOf('/app.js'))
  const response=await fetch(`http://127.0.0.1:${port}/public-config.js`)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const config=await response.text();expect(config).toContain('https://runtime.example');expect(config).not.toContain('must-not-appear')
 }finally{child.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true})}
})
