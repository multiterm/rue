#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs'
import {mkdir,open} from 'node:fs/promises'
import {spawn,spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../..')
if(process.env.SANDBLOCKS_SKIP_POST_COMMIT==='1')process.exit(0)
const branch=git(['branch','--show-current'])
const environment=branch==='develop'?'preview':branch==='main'?'prod':undefined
if(!environment){console.log(`sandblocks post-commit skipped on branch ${branch||'(detached)'}`);process.exit(0)}
if(git(['status','--porcelain'])){console.log(`sandblocks post-commit skipped: worktree is dirty after commit on ${branch}`);process.exit(0)}
const sandblocks=join(root,'node_modules/.bin/sandblocks')
if(!existsSync(sandblocks)){console.log('sandblocks post-commit skipped: install dependencies first');process.exit(0)}
const stateFile=join(root,`.sandblocks/sandbox-${environment}.json`)
const command=existsSync(stateFile)?'redeploy':'up'
const logDir=join(root,'.sandblocks/logs');await mkdir(logDir,{recursive:true,mode:0o700})
const logPath=join(logDir,`post-commit-${branch}-${Date.now()}.log`);const log=await open(logPath,'a',0o600)
const localEnv=readEnv(join(root,'.sandblocks/config.env'))
const child=spawn(sandblocks,['sandbox',command,root,'--environment',environment],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd],env:{...localEnv,...process.env,SANDBLOCKS_SKIP_POST_COMMIT:'1',SANDBLOCKS_RETAIN_FAILED:'true'}})
child.unref();await log.close();console.log(`sandblocks ${command} started: ${branch} -> ${environment} (${logPath})`)
function readEnv(path){if(!existsSync(path))return {};const values={};for(const raw of readFileSync(path,'utf8').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<1)continue;const key=line.slice(0,index).trim();let value=line.slice(index+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);values[key]=value}return values}
function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr.trim()||`git ${args[0]} failed`);return result.stdout.trim()}
