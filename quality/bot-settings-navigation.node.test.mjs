import {test} from 'node:test'
import assert from 'node:assert/strict'
import {initialSettingsHistory,settingsNavigate,settingsEntryPage,settingsPageTitles,settingsBackLabel} from '../packages/apps/webapp/src/bot-settings-navigation.ts'
test('back follows the most recent actual visit, including nested action pages',()=>{
 let history=initialSettingsHistory('Settings')
 for(const page of ['Actions','Workspace','Actions','Permissions'])history=settingsNavigate(history,{type:'push',page})
 assert.deepEqual(history,['Settings','Actions','Workspace','Actions','Permissions'])
 for(const expected of ['Actions','Workspace','Actions','Settings']){history=settingsNavigate(history,{type:'back'});assert.equal(history.at(-1),expected)}
 assert.equal(settingsNavigate(history,{type:'back'}),history)
})
test('direct shortcuts get a settings fallback and duplicate navigation does not add history',()=>{
 const history=initialSettingsHistory('Workspace')
 assert.deepEqual(history,['Settings','Workspace'])
 assert.equal(settingsNavigate(history,{type:'push',page:'Workspace'}),history)
 assert.deepEqual(settingsNavigate(history,{type:'push',page:'Status'}),['Settings','Workspace','Status'])
 assert.deepEqual(history,['Settings','Workspace'])
})
test('legacy action shortcuts resolve to their actual page; modal titles stay independent',()=>{
 assert.equal(settingsEntryPage('Actions','workspace'),'Workspace')
 assert.equal(settingsEntryPage('Actions','permissions'),'Permissions')
 assert.equal(settingsEntryPage('Actions','model'),'Actions')
 assert.equal(settingsEntryPage('Actions','key'),'Actions')
 assert.equal(settingsPageTitles.Settings,'Bot settings')
 assert.equal(settingsPageTitles.Routines,'Routine draft')
 assert.equal(settingsPageTitles.Status,'Agent status')
 assert.equal(settingsPageTitles.Actions,'Agent actions')
 assert.equal(settingsBackLabel('AI settings'),'Back to AI settings')
})
