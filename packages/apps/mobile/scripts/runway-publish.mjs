#!/usr/bin/env node
import {createReadStream,existsSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {basename,dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const repoRoot=resolve(appRoot,'../../..')
const runtimeRoot=resolve(repoRoot,'.runway')
loadEnv(resolve(runtimeRoot,'config.env'))
const homebrewJava='/opt/homebrew/opt/openjdk@17';const homebrewAndroid='/opt/homebrew/share/android-commandlinetools'
if(!process.env.JAVA_HOME&&existsSync(homebrewJava))process.env.JAVA_HOME=homebrewJava
if(!process.env.ANDROID_HOME&&existsSync(homebrewAndroid))process.env.ANDROID_HOME=homebrewAndroid
if(process.env.JAVA_HOME)process.env.PATH=`${process.env.JAVA_HOME}/bin:${process.env.PATH??''}`
const args=new Set(process.argv.slice(2))
const flag=(name,fallback)=>{const prefix=`--${name}=`;const value=process.argv.slice(2).find((item)=>item.startsWith(prefix));return value?value.slice(prefix.length):fallback}
const config=JSON.parse(readFileSync(resolve(appRoot,'runway.config.json'),'utf8'))
const buildType=flag('build-type',process.env.RUNWAY_BUILD_TYPE??config.buildType??'development')
if(!['development','preview','production'].includes(buildType))throw new Error(`Invalid Runway build type: ${buildType}`)
const build=config.builds?.[buildType]??{}
const serverUrl=String(process.env.RUNWAY_SERVER_URL??config.serverUrl??'').replace(/\/$/,'')
const canonical='https://runway.honeycluster.xyz'
if(new URL(serverUrl).origin!==canonical)throw new Error(`Runway publish blocked: ${serverUrl} is not ${canonical}`)
const apkPath=resolve(appRoot,flag('apk',process.env.APK_PATH??build.apkPath??(buildType==='development'?'android/app/build/outputs/apk/debug/app-debug.apk':'android/app/build/outputs/apk/release/app-release.apk')))
const appVariant=build.appVariant??buildType
const gradleTask=build.gradleTask??(buildType==='development'?'assembleDebug':'assembleRelease')
const sha=git(['rev-parse','--short=12','HEAD']);const dirty=Boolean(git(['status','--porcelain']))
const sourceRevision=dirty?`${sha}-dirty-${new Date().toISOString().replace(/\D/g,'').slice(0,14)}`:sha
const buildId=flag('build-id',process.env.RUNWAY_BUILD_ID??`${config.appId}-${buildType}-${sourceRevision}`)
const dryRun=args.has('--dry-run')
console.log(`Runway plan: ${config.appId} ${buildType} ${buildId} -> ${serverUrl}`)
if(dryRun){console.log(`Runway dry run: prebuild Android, run ${gradleTask}, upload ${apkPath}`);process.exit(0)}
if(!process.env.RUNWAY_PUSH_KEY)throw new Error('Missing RUNWAY_PUSH_KEY; add it to .runway/config.env')
await mkdir(runtimeRoot,{recursive:true,mode:0o700})
const lock=resolve(runtimeRoot,'publish.lock')
acquireLock(lock)
try{
  if(!args.has('--no-assemble')){
    run('pnpm',['exec','expo','prebuild','--platform','android','--no-install'],appRoot,{APP_VARIANT:appVariant,RUNWAY_BUILD_TYPE:buildType,EAS_BUILD_PLATFORM:'android'})
    const gradle=process.platform==='win32'?'gradlew.bat':'./gradlew'
    run(gradle,[gradleTask],resolve(appRoot,'android'),{APP_VARIANT:appVariant,RUNWAY_BUILD_TYPE:buildType,EAS_BUILD_PLATFORM:'android'})
  }
  if(!existsSync(apkPath))throw new Error(`APK not found: ${apkPath}`)
  const size=statSync(apkPath).size
  const url=new URL(`${serverUrl}/v1/builds/upload`);url.searchParams.set('id',buildId);url.searchParams.set('appId',config.appId);url.searchParams.set('appName',build.appName??config.appName??config.appId);url.searchParams.set('buildType',buildType)
  console.log(`Uploading ${basename(apkPath)} (${Math.round(size/1024/1024)} MB)`)
  const repoUrl=git(['remote','get-url','origin'],false)
  const response=await fetch(url,{method:'POST',duplex:'half',body:createReadStream(apkPath),headers:{'content-length':String(size),'content-type':'application/vnd.android.package-archive','x-runway-app-id':config.appId,'x-runway-app-name':build.appName??config.appName??config.appId,'x-runway-build-type':buildType,'x-runway-push-key':process.env.RUNWAY_PUSH_KEY,...repoUrl?{'x-runway-repo-url':repoUrl}:{},'x-runway-source':'rue-post-commit','x-runway-workspace':repoRoot,'x-runway-build-id':buildId}})
  const text=await response.text();if(!response.ok)throw new Error(`Runway upload failed (${response.status}): ${text}`)
  const record=JSON.parse(text);console.log(`Build ID: ${record.id??buildId}`);console.log(`Install URL: ${record.installUrl??`${serverUrl}/v1/builds/${record.id??buildId}/install`}`);console.log(`APK URL: ${record.artifactUrl??`${serverUrl}/v1/builds/${record.id??buildId}/artifact`}`)
}finally{rmSync(lock,{force:true})}
function loadEnv(path){if(!existsSync(path))return;for(const raw of readFileSync(path,'utf8').split(/\r?\n/)){const match=raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!match||process.env[match[1]]!==undefined)continue;process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'')}}
function git(argv,required=true){const result=spawnSync('git',argv,{cwd:repoRoot,encoding:'utf8'});if(required&&result.status!==0)throw new Error(result.stderr.trim()||`git ${argv[0]} failed`);return result.status===0?result.stdout.trim():''}
function run(command,argv,cwd,extra){const result=spawnSync(command,argv,{cwd,env:{...process.env,...extra},stdio:'inherit'});if(result.status!==0)throw new Error(`${command} failed with exit code ${result.status??'unknown'}`)}
function acquireLock(path){try{writeFileSync(path,String(process.pid),{flag:'wx',mode:0o600})}catch{const pid=Number(readFileSync(path,'utf8'));try{process.kill(pid,0);throw new Error(`Runway publish already active (pid ${pid})`)}catch(error){if(error?.code!=='ESRCH')throw error;rmSync(path,{force:true});writeFileSync(path,String(process.pid),{flag:'wx',mode:0o600})}}}
