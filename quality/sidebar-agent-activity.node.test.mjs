import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sidebarAgentActivity as activity} from '../packages/apps/webapp/src/sidebar-agent-activity.ts'
test('fresh remote activity distinguishes working and compaction',()=>{for(const [state,label] of [['working','Working'],['compacting','Compacting'],['idle',undefined]])assert.equal(activity({health:{status:{state}},runs:[]},true,true,false,false),label)})
test('stale or failed checks never animate cached activity',()=>{const c={health:{agentWorking:true},runs:[]};assert.equal(activity(c,false,true,false,false),undefined);assert.equal(activity(c,true,true,false,true),undefined)})
test('legacy running commands work but queued and claimed requests are not working',()=>{for(const status of ['running','queued','claimed','completed'])assert.equal(activity({runs:[{status}]},true,true,false,false),status==='running'?'Working':undefined);assert.equal(activity({health:{agentWorking:false},runs:[{status:'running'}]},true,true,false,false),undefined)})
test('cloud sends are active, but remote submission alone is not execution',()=>{assert.equal(activity(undefined,false,false,true,false),'Working');assert.equal(activity(undefined,false,false,false,false),undefined);assert.equal(activity(undefined,false,true,true,false),undefined)})
