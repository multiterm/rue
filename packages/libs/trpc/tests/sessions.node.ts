import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchRequestHandler} from '@trpc/server/adapters/fetch'
import {appRouter} from '../src/index.js'
import {createRueTrpcClient,listRueSessions} from '../src/client.js'
import type {SessionRecord,SessionRepository} from '@multiterm/rue-db/session-repository'
const rows:SessionRecord[]=Array.from({length:105},(_,i)=>({id:`ses_${String(i).padStart(3,'0')}`,title:`Bot ${i}`,ownerSubject:'owner',createdAt:1,updatedAt:105-i,agent:null,provider:null,model:null,directory:null,scopes:[],parentId:null,meta:{index:i}}))
test('typed frontend session pagination crosses the actual tRPC HTTP and SuperJSON boundary',async()=>{
 let requests=0
 const repository:SessionRepository={
  async list(owner,input={}){assert.equal(owner,'owner');const filtered=rows.filter(row=>!input.cursor||row.updatedAt<input.cursor.updatedAt),items=filtered.slice(0,input.limit??100),last=items.at(-1);return {items,nextCursor:filtered.length>items.length&&last?{updatedAt:last.updatedAt,id:last.id}:null}},
  async get(owner,id){return rows.find(row=>row.ownerSubject===owner&&row.id===id)},
 }
 const client=createRueTrpcClient({baseUrl:'https://rue.test',token:()=> 'fixture',fetch:async(url,init)=>{
  requests++;const req=new Request(url,init);assert.equal(req.headers.get('authorization'),'Bearer fixture')
  return fetchRequestHandler({endpoint:'/trpc',req,router:appRouter,createContext:()=>({sessions:repository,principalSubject:'owner'})})
 }})
 const result=await listRueSessions(client)
 assert.equal(result.length,105);assert.equal(new Set(result.map(row=>row.id)).size,105);assert.equal(requests,2);assert.equal(result[104]?.meta.index,104)
 assert.equal((await client.session.query({id:'ses_000'})).title,'Bot 0')
 await assert.rejects(client.session.query({id:'not-owned'}),error=>(error as {data?:{code:string}}).data?.code==='NOT_FOUND')
})
test('an absent principal is rejected before the session repository is called',async()=>{
 const repository:SessionRepository={list:async()=>{throw Error('must not run')},get:async()=>{throw Error('must not run')}}
 const client=createRueTrpcClient({baseUrl:'https://rue.test',fetch:async(url,init)=>fetchRequestHandler({endpoint:'/trpc',req:new Request(url,init),router:appRouter,createContext:()=>({sessions:repository,principalSubject:''})})})
 await assert.rejects(listRueSessions(client),error=>(error as {data?:{code:string}}).data?.code==='UNAUTHORIZED')
})
