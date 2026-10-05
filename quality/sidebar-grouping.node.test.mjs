import {test} from 'node:test'
import assert from 'node:assert/strict'
import {filterSessions,defaultBotListFilters,sessionGroup} from '../packages/apps/webapp/src/session-list.ts'
const sessions=[
 {id:'work-old',title:'Alpha',createdAt:1,updatedAt:1,meta:{group:' Work '}},
 {id:'personal-pin',title:'Zulu',createdAt:2,updatedAt:2,meta:{group:'Personal',pinned:true}},
 {id:'work-pin',title:'Zulu',createdAt:3,updatedAt:3,meta:{group:'Work',pinned:true}},
 {id:'ungrouped',title:'Aardvark',createdAt:4,updatedAt:4,meta:{pinned:true}},
 {id:'personal-new',title:'Alpha',createdAt:5,updatedAt:5,meta:{group:'Personal'}},
 {id:'archived',title:'Hidden',createdAt:6,updatedAt:6,meta:{group:'Work',archived:true}},
]
const grouped={...defaultBotListFilters,groupAgents:true}
test('grouping keeps each section contiguous, with pins sorted inside it and Ungrouped last',()=>{
 assert.deepEqual(filterSessions(sessions,'',grouped).map(s=>s.id),['personal-pin','personal-new','work-pin','work-old','ungrouped'])
 assert.equal(sessionGroup(sessions[0]),'Work')
 assert.equal(defaultBotListFilters.groupAgents,false)
})
test('grouped sort, search and archive filters combine without mutating source sessions',()=>{
 const original=JSON.stringify(sessions)
 assert.deepEqual(filterSessions(sessions,'',{...grouped,sort:'name',pinnedFirst:false}).map(s=>s.id),['personal-new','personal-pin','work-old','work-pin','ungrouped'])
 assert.deepEqual(filterSessions(sessions,'work',grouped).map(s=>s.id),['work-pin','work-old'])
 assert.deepEqual(filterSessions(sessions,'',{...grouped,archive:'archived'}).map(s=>s.id),['archived'])
 assert.equal(JSON.stringify(sessions),original)
})
test('flat mode preserves global pinned priority independently of grouping',()=>{
 assert.deepEqual(filterSessions(sessions,'',defaultBotListFilters).map(s=>s.id),['ungrouped','work-pin','personal-pin','personal-new','work-old'])
})
