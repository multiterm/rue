import {test,expect} from 'vitest'
import {createApp,type ServerContext} from '../../src/server/index.js'
import {Bus} from '../../src/bus/index.js'
import {ConfigSchema} from '../../src/config/index.js'
import {openDatabase,createSession,appendMessage} from '../../src/storage/index.js'
test('history route rejects active runs, stale confirmation and malformed requests; emits scoped invalidations',async()=>{
 const ctx:ServerContext={db:openDatabase(':memory:'),config:ConfigSchema.parse({}),bus:new Bus(),activeRuns:new Map([['local',1]])};try{
 createSession(ctx.db,{id:'chat'});appendMessage(ctx.db,{id:'old',sessionId:'chat',role:'user'})
 const app=createApp({ctx}),clear=(body:unknown)=>app.request('/session/chat/history',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 expect((await clear({expectedLastMessageId:'old'})).status).toBe(409)
 ctx.activeRuns!.clear()
 expect((await clear({})).status).toBe(400)
 expect((await clear({expectedLastMessageId:null})).status).toBe(409)
 const events:unknown[]=[];const unsubscribe=ctx.bus.subscribe(event=>events.push(event))
 expect((await clear({expectedLastMessageId:'old'})).status).toBe(200)
 unsubscribe();expect(events).toContainEqual(expect.objectContaining({type:'message.history-cleared',payload:{sessionId:'chat',ownerSubject:'local'}}))
 }finally{ctx.db.close()}
})
