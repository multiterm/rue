import {spawn,execFileSync} from 'node:child_process'
import {unlinkSync} from 'node:fs'
import {readGrant} from './config.js'
import {AuthorityClock,readAuthority} from './authority.js'

async function main(){
 const grant=readGrant('/control/grant.json'),clock=new AuthorityClock()
 // Do not execute even startup hooks without current, server-confirmed authority.
 await readAuthority(grant,clock)
 if(grant.config.filesystem?.directories.length){
  execFileSync('/app/mount-check',[...(grant.workspaceRoots?['verify-v3',grant.filesystemProof!,String(grant.workspaceRoots.length),...grant.workspaceRoots]:['verify',grant.filesystemProof!]),...grant.config.filesystem.directories.flatMap(g=>[g.access,g.path])],{timeout:7000,maxBuffer:1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}})
  unlinkSync(`/control/workspace-${grant.filesystemProof}.sock`)
 }
 if(!clock.valid())throw Error('agent_authority_rejected')
 const child=spawn(process.execPath,[new URL('./runner.js',import.meta.url).pathname],{uid:1000,gid:1000,stdio:['pipe','inherit','inherit'],env:{PATH:process.env.PATH,HOME:'/state',PI_CODING_AGENT_DIR:'/state/pi',LANG:'C.UTF-8',NODE_ENV:'production'}})
 child.stdin!.end(JSON.stringify(grant))
 let stopped=false,pending=false
 const stop=()=>{if(stopped)return;stopped=true;child.kill('SIGTERM');setTimeout(()=>process.exit(75),750).unref()}
 // Exiting the guardian makes tini (PID 1) exit, terminating the entire
 // container namespace, including stopped Pi processes and tool descendants.
 child.once('error',stop);child.once('exit',code=>process.exit(code??1))
 process.once('SIGTERM',stop);process.once('SIGINT',stop)
 // Do not allow tools to enable an inspector on the guardian via SIGUSR1.
 process.on('SIGUSR1',()=>{})
 const watchdog=setInterval(()=>{if(!clock.valid())stop()},250)
 const renew=setInterval(()=>{
  if(pending||stopped)return
  pending=true
  void readAuthority(grant,clock).catch(error=>{
   if(error instanceof Error&&['agent_authority_rejected','agent_authority_invalid'].includes(error.message))stop()
  }).finally(()=>{pending=false})
 },10000)
 child.once('exit',()=>{clearInterval(watchdog);clearInterval(renew)})
}
void main().catch(()=>{console.error('agent_guardian_failed');process.exitCode=1})
