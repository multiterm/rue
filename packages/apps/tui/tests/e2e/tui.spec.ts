import {expect,test} from '@playwright/test'
import {createTuiScreen,RUE_TUI_THEMES} from '../../src/index.js'
test('terminal UI exposes the shared Rue layout and palette',()=>{const screen=createTuiScreen({sessionCount:3,connected:true});expect(screen).toContain('Rue');expect(screen).toContain('3 sessions');expect(screen).toContain('Connected');expect(RUE_TUI_THEMES.dark.primary).toBe('#8df0b2')})
