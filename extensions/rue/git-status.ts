import {execFile} from 'node:child_process'
export interface GitStatus {branch:string|null;remote:string|null;localBranches:string[];truncated:boolean}
const safeName=(s:string)=>s.length>0&&s.length<=256&&!/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(s)
function git(cwd:string,args:string[]){return new Promise<string>((resolve,reject)=>execFile('git',['-c','core.fsmonitor=false','-C',cwd,...args],{timeout:1500,maxBuffer:32768,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}},(error,stdout)=>error?reject(error):resolve(stdout.trim())))}
/** Read-only local metadata. Never fetches, runs a shell, or transmits remote URLs. */
export async function readGitStatus(cwd:string):Promise<GitStatus|null>{
 try{
  if(await git(cwd,['rev-parse','--is-inside-work-tree'])!=='true')return null
  const [head,refs,remotes]=await Promise.all([git(cwd,['symbolic-ref','--quiet','--short','HEAD']).catch(()=>''),git(cwd,['for-each-ref','--count=51','--format=%(refname:short)%00%(upstream:remotename)','refs/heads']),git(cwd,['remote'])])
  const rows=refs.split('\n').filter(Boolean).map(row=>row.split('\0'))
  const upstream=rows.find(([name])=>name===head)?.[1]||(head?await git(cwd,['config','--get',`branch.${head}.remote`]).catch(()=>''):'')
  const names=remotes.split('\n').filter(name=>safeName(name)&&!/[\s:@\\]/.test(name))
  const remote=upstream&&names.includes(upstream)?upstream:names.includes('origin')?'origin':names[0]??null
  return {branch:safeName(head)?head:null,remote,localBranches:rows.slice(0,50).map(([name])=>name!).filter(safeName),truncated:rows.length>50}
 }catch{return null}
}
export function gitReader(){
 let path='',value:GitStatus|null=null,updated=0,pending=false,epoch=0
 return (cwd:string)=>{
  if(path!==cwd){path=cwd;value=null;updated=0;epoch++}
  if(!pending&&Date.now()-updated>=10000){
   pending=true;const generation=epoch;updated=Date.now()
   void readGitStatus(cwd).then(next=>{if(generation===epoch)value=next}).finally(()=>{pending=false})
  }
  return value
 }
}
