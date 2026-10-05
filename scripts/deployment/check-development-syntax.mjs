import ts from 'typescript'
import {execFileSync} from 'node:child_process'
import {lstat,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'

export function runtimeSource(name){
 return /^(packages|extensions|scripts)\//.test(name)&&/\.[cm]?[jt]sx?$/.test(name)&&!name.split('/').some(part=>['..','.git','.worktrees','.sandblocks','node_modules','dist','coverage','references'].includes(part)||part.startsWith('.env'))
}
/** Parse only: no imports, execution, dependency installation or deployed writes. */
export async function assertDevelopmentSyntax(root,files){
 files??=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)
 const errors=[]
 for(const name of [...new Set(files)].filter(runtimeSource).sort()){
  let text
  try{const path=join(root,name);if(!(await lstat(path)).isFile())continue;text=await readFile(path,'utf8')}catch(error){if(error.code==='ENOENT')continue;throw error}
  const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true)
  for(const error of source.parseDiagnostics){
   const {line,character}=source.getLineAndCharacterOfPosition(error.start??0)
   // Avoid source excerpts or diagnostic messages that can quote source literals.
   errors.push(`${name}:${line+1}:${character+1} TS${error.code}`)
  }
 }
 if(errors.length)throw Error('Development sync blocked by syntax errors:\n'+errors.join('\n'))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await assertDevelopmentSyntax(resolve(import.meta.dirname,'../..'))
 console.log('Development source syntax passed (not a typecheck).')
}
