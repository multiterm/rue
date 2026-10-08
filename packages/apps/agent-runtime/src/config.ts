import {validFilesystemPolicy,validWorkspaceRoots,type FilesystemPolicy} from '../../../libs/sdk/src/filesystem.js'
import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs'
import {z} from 'zod'
export const grantSchema=z.object({
 version:z.literal(1),origin:z.string().url().refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password}catch{return false}}),
 agentId:z.string().uuid(),revision:z.number().int().positive(),generation:z.number().int().positive(),
 connectionId:z.string().length(37).regex(/^term_[A-Za-z0-9_-]{32}$/),token:z.string().length(56).regex(/^rue_terminal_[A-Za-z0-9_-]{43}$/),
 sessionId:z.string().min(1).max(128),piSessionId:z.string().uuid(),ownerSubject:z.string().min(1).max(512),
 filesystemProof:z.string().uuid().optional(),
 workspaceRoots:z.custom<string[]>(validWorkspaceRoots).refine(roots=>roots.length>0).optional(),
 config:z.object({filesystem:z.custom<FilesystemPolicy>(validFilesystemPolicy).optional(),provider:z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),model:z.string().min(1).max(128).refine(value=>!/[\x00-\x1f\x7f]/.test(value)),permission:z.enum(['read-only','coding']),mounts:z.array(z.string().max(32).regex(/^[a-z][a-z0-9_-]*$/).refine(value=>!/[\r\n]/.test(value))).max(8),shareToolOutput:z.boolean(),shareThinking:z.boolean(),thinkingLevel:z.enum(['off','minimal','low','medium','high','xhigh']).optional(),autoCompaction:z.boolean().optional(),mcp:z.array(z.string().uuid()).max(4).optional()}).strict(),
 mcp:z.array(z.object({id:z.string().uuid(),name:z.string().max(60),command:z.string().min(1).max(256),args:z.array(z.string().max(256)).max(16),environment:z.record(z.string().max(80),z.string().max(2048))}).strict()).max(4).optional(),
}).strict().refine(value=>!value.workspaceRoots||Boolean(value.filesystemProof)).refine(value=>Boolean(value.config.filesystem?.directories.length)===Boolean(value.filesystemProof)).refine(value=>value.agentId===value.piSessionId).refine(value=>{
 const ids=value.config.mcp??[],profiles=value.mcp??[]
 return (!ids.length||value.config.permission==='coding')&&new Set(ids).size===ids.length&&ids.length===profiles.length&&ids.every(id=>profiles.some(p=>p.id===id))&&Buffer.byteLength(JSON.stringify(profiles))<=16384
})
export type RuntimeGrant=z.infer<typeof grantSchema>
export function readGrant(path:string):RuntimeGrant{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
 try{
  const st=fstatSync(fd)
  if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077)||st.size>32768)throw Error('agent_unsafe_grant')
  return grantSchema.parse(JSON.parse(readFileSync(fd,'utf8')))
 }finally{closeSync(fd)}
}
