import fs from 'node:fs'
import path from 'node:path'
const coveragePath=path.resolve('coverage/quality/coverage-final.json')
const maxAllowed=Number(process.env.MAX_CRAP??30)
if(!fs.existsSync(coveragePath))throw new Error(`Coverage data not found at ${coveragePath}; run rune quality-unit first`)
const report=JSON.parse(fs.readFileSync(coveragePath,'utf8'));const results=[]
const inside=(location,range)=>location.start.line>=range.start.line&&location.end.line<=range.end.line
for(const[file,coverage]of Object.entries(report))for(const[id,fn]of Object.entries(coverage.fnMap??{})){const range=fn.loc;const complexity=1+Object.values(coverage.branchMap??{}).filter((branch)=>branch.locations.some((location)=>inside(location,range))).length;const statements=Object.entries(coverage.statementMap??{}).filter(([,location])=>inside(location,range));const covered=statements.filter(([statementId])=>coverage.s[statementId]>0).length;const ratio=statements.length===0?(coverage.f[id]>0?1:0):covered/statements.length;results.push({file,name:fn.name||`(anonymous:${id})`,complexity,ratio,crap:complexity**2*(1-ratio)**3+complexity})}
if(results.length===0)throw new Error('No functions were found in the coverage report')
results.sort((a,b)=>b.crap-a.crap)
for(const result of results)console.log(`${result.crap.toFixed(2).padStart(6)}  C=${result.complexity}  coverage=${(result.ratio*100).toFixed(1)}%  ${path.relative(process.cwd(),result.file)} :: ${result.name}`)
const failures=results.filter(({crap})=>crap>maxAllowed)
if(failures.length)throw new Error(`${failures.length} function(s) exceed CRAP threshold ${maxAllowed}`)
console.log(`CRAP gate passed: max ${results[0].crap.toFixed(2)} <= ${maxAllowed}`)
