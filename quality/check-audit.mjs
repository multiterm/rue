import {spawnSync} from 'node:child_process'
const allowed=new Map([
  ['1119441',{module:'uuid',expires:'2026-09-30',reason:'Expo/xcode transitive dependency'}],
  ['1138808',{module:'image-size',expires:'2026-09-30',reason:'Expo Metro transitive dependency'}],
  ['1138809',{module:'image-size',expires:'2026-09-30',reason:'Expo Metro transitive dependency'}],
])
const result=spawnSync('pnpm',['audit','--prod','--json'],{encoding:'utf8',maxBuffer:10*1024*1024})
let report
try{report=JSON.parse(result.stdout)}catch{throw new Error(`Could not parse pnpm audit output: ${result.stderr||result.stdout}`)}
const advisories=Object.entries(report.advisories??{});const today=new Date().toISOString().slice(0,10);const failures=[]
for(const[id,advisory]of advisories){const exception=allowed.get(id);if(!exception){failures.push(`${id} ${advisory.severity} ${advisory.module_name}: ${advisory.title}`);continue}if(exception.module!==advisory.module_name||exception.expires<today)failures.push(`${id} exception invalid or expired (${exception.expires})`);else console.warn(`audit exception ${id} (${exception.module}) until ${exception.expires}: ${exception.reason}`)}
if(failures.length)throw new Error(`Production dependency audit failed:\n${failures.join('\n')}`)
console.log(`Dependency audit gate passed (${advisories.length} explicitly reviewed advisories)`)
