import {createHash} from 'node:crypto'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js'
import {Type,type TSchema} from 'typebox'
import type {ExtensionFactory,ToolDefinition} from '@earendil-works/pi-coding-agent'
import {BoundedStdioTransport} from './mcp-transport.js'
export interface McpConnection {id:string;name:string;command:string;args:string[];environment:Record<string,string>}
function boundedSchema(value:unknown,depth=0){
 if(depth>24)throw Error('agent_mcp_catalog_invalid')
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  if(key==='$ref'&&(typeof item!=='string'||!item.startsWith('#')))throw Error('agent_mcp_catalog_invalid')
  boundedSchema(item,depth+1)
 }
}
/** No sampling, elicitation, OAuth forwarding, shell expansion or automatic retries. */
export async function connectMcp(profiles:McpConnection[],cwd:string){
 const clients:Client[]=[],tools:ToolDefinition[]=[]
 const close=async()=>{await Promise.allSettled(clients.map(client=>client.close()))}
 try{
  for(const profile of profiles){
   const client=new Client({name:'rue-agent',version:'0.2.0'},{capabilities:{}});clients.push(client)
   client.onerror=()=>{} // Never log server diagnostics or secret-bearing payloads.
   await client.connect(new BoundedStdioTransport(profile.command,profile.args,profile.environment,cwd),{timeout:10000,resetTimeoutOnProgress:false,maxTotalTimeout:10000})
   let cursor:string|undefined;const cursors=new Set<string>(),names=new Set<string>()
   do{
    const catalog=await client.listTools(cursor?{cursor}:undefined,{timeout:10000,resetTimeoutOnProgress:false,maxTotalTimeout:10000})
    for(const tool of catalog.tools){
     if(tools.length>=64||names.has(tool.name)||tool.name.length>128||JSON.stringify(tool.inputSchema).length>16384||(tool.description?.length??0)>4000)throw Error('agent_mcp_catalog_invalid')
     names.add(tool.name);boundedSchema(tool.inputSchema)
     const name='mcp_'+createHash('sha256').update(profile.id+'\0'+tool.name).digest('hex').slice(0,24)
     tools.push({name,label:`${profile.name}: ${tool.name}`,description:`${profile.name}: ${tool.name}\n${tool.description??''}`,parameters:Type.Unsafe<Record<string,unknown>>(tool.inputSchema as TSchema),executionMode:'sequential',
      execute:async(_id,parameters,signal)=>{
       try{
        const result=CallToolResultSchema.parse(await client.callTool({name:tool.name,arguments:parameters as Record<string,unknown>},CallToolResultSchema,{signal,timeout:60000,resetTimeoutOnProgress:false,maxTotalTimeout:60000}))
        const content:Array<{type:'text';text:string}|{type:'image';data:string;mimeType:string}>=[]
        for(const part of result.content){
         if(part.type==='text')content.push({type:'text',text:part.text})
         else if(part.type==='image')content.push({type:'image',data:part.data,mimeType:part.mimeType})
         else if(part.type==='resource'&&'text' in part.resource)content.push({type:'text',text:part.resource.uri+'\n'+part.resource.text})
         else if(part.type==='resource_link')content.push({type:'text',text:JSON.stringify(part)})
         else throw Error('agent_mcp_content_unsupported')
        }
        if(result.structuredContent)content.push({type:'text',text:JSON.stringify(result.structuredContent)})
        if(!content.length)content.push({type:'text',text:'MCP tool returned no content.'})
        return {content,details:{mcpProfile:profile.id,mcpError:result.isError===true}}
       }catch(error){
        return {content:[{type:'text' as const,text:error instanceof Error&&error.message==='agent_mcp_content_unsupported'?'The MCP server returned an unsupported content type. No content was silently truncated.':'The MCP call failed or was interrupted. It was not retried; check the server before repeating a side-effecting action.'}],details:{mcpProfile:profile.id,mcpError:true}}
       }
      },
     })
    }
    cursor=catalog.nextCursor
    if(cursor){if(cursors.has(cursor)||cursors.size>=8)throw Error('agent_mcp_catalog_invalid');cursors.add(cursor)}
   }while(cursor)
  }
  const names=new Set(tools.map(tool=>tool.name))
  const factory:ExtensionFactory=pi=>{
   for(const tool of tools)pi.registerTool(tool)
   pi.on('tool_result',event=>{if(names.has(event.toolName)&&(event.details as {mcpError?:boolean}|undefined)?.mcpError)return {isError:true}})
  }
  return {factory,toolNames:[...names],tools,close}
 }catch{await close();throw Error('agent_mcp_setup_failed')}
}
