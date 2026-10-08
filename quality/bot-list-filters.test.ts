import {expect,test} from 'vitest'
import type {RueSession} from '../packages/libs/sdk/src/index'
import {filterSessions,defaultBotListFilters} from '../packages/apps/webapp/src/session-list'
const sessions=[{id:'a',title:'Zebra',createdAt:1,updatedAt:3,meta:{group:'Work'}},{id:'b',title:'Alpha',createdAt:2,updatedAt:2,meta:{pinned:true,labels:['research']}},{id:'c',title:'Archived',createdAt:3,updatedAt:4,meta:{archived:true}}] as RueSession[]
const ids=(filters=defaultBotListFilters,search='')=>filterSessions(sessions,search,filters).map(s=>s.id)
test('archived bots are hidden by default and filters combine with search',()=>{
 expect(ids()).toEqual(['b','a'])
 expect(ids({...defaultBotListFilters,archive:'archived'})).toEqual(['c'])
 expect(ids({...defaultBotListFilters,archive:'all',pinnedOnly:true})).toEqual(['b'])
 expect(ids(defaultBotListFilters,'research')).toEqual(['b'])
})
test('sort options respect pin priority and do not mutate the source',()=>{
 expect(ids({...defaultBotListFilters,pinnedFirst:false,sort:'recent'})).toEqual(['a','b'])
 expect(ids({...defaultBotListFilters,pinnedFirst:false,sort:'name'})).toEqual(['b','a'])
 expect(ids({...defaultBotListFilters,pinnedFirst:false,sort:'oldest'})).toEqual(['a','b'])
 expect(sessions.map(s=>s.id)).toEqual(['a','b','c'])
})
