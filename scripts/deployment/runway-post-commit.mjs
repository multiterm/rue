#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs'
import {mkdir,open} from 'node:fs/promises'
import {spawn,spawnSync} from 'node:child_process'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../..')
if(process.env.RUNWAY_SKIP_POST_COMMIT==='1')process.exit(0)
const branch=process.env.RUNWAY_POST_COMMIT_BRANCH??git(['branch','--show-current'])
const buildType=branch==='develop'?'development':branch==='pre'?'preview':branch==='prod'?'production':undefined
if(!buildType){console.log(`runway post-commit skipped on branch ${branch||'(detached)'}`);process.exit(0)}
if(process.env.RUNWAY_POST_COMMIT_ALLOW_DIRTY!=='1'&&git(['status','--porcelain'])){console.log(`runway post-commit skipped: worktree is dirty after commit on ${branch}`);process.exit(0)}
const changed=git(['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split('\n').filter(Boolean)
const affectsMobile=changed.some((path)=>path==='package.json'||path==='pnpm-lock.yaml'||path==='pnpm-workspace.yaml'||path==='Runefile'||path.startsWith('packages/apps/mobile/')||/^packages\/libs\/(auth|config|gds|sdk)\//.test(path))
if(!affectsMobile&&process.env.RUNWAY_FORCE_POST_COMMIT!=='1'){console.log('runway post-commit skipped: commit does not affect the mobile application');process.exit(0)}
const configPath=join(root,'.runway/config.env');const localEnv=readEnv(configPath)
if(!process.env.RUNWAY_PUSH_KEY&&!localEnv.RUNWAY_PUSH_KEY&&process.env.RUNWAY_POST_COMMIT_DRY_RUN!=='1'){console.log('runway post-commit skipped: configure RUNWAY_PUSH_KEY in .runway/config.env');process.exit(0)}
const publisher=join(root,'packages/apps/mobile/scripts/runway-publish.mjs')
if(!existsSync(publisher)){console.log('runway post-commit skipped: publisher is not installed');process.exit(0)}
const logDir=join(root,'.runway/logs');await mkdir(logDir,{recursive:true,mode:0o700});const logPath=join(logDir,`post-commit-${branch}-${Date.now()}.log`);const log=await open(logPath,'a',0o600)
const args=[publisher,`--build-type=${buildType}`];if(process.env.RUNWAY_POST_COMMIT_DRY_RUN==='1')args.push('--dry-run')
const child=spawn(process.execPath,args,{cwd:root,detached:process.env.RUNWAY_POST_COMMIT_FOREGROUND!=='1',stdio:['ignore',log.fd,log.fd],env:{...localEnv,...process.env,RUNWAY_SKIP_POST_COMMIT:'1'}})
if(process.env.RUNWAY_POST_COMMIT_FOREGROUND==='1'){const code=await new Promise((resolve)=>child.on('exit',resolve));await log.close();if(code!==0)throw new Error(`Runway ${buildType} publish failed; see ${logPath}`);console.log(`runway ${buildType} dry run completed (${logPath})`)}else{child.unref();await log.close();console.log(`runway ${buildType} build/upload started (${logPath})`)}
function readEnv(path){if(!existsSync(path))return {};const values={};for(const raw of readFileSync(path,'utf8').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<1)continue;const key=line.slice(0,index).trim();let value=line.slice(index+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);values[key]=value}return values}
function git(args){const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr.trim()||`git ${args[0]} failed`);return result.stdout.trim()}
