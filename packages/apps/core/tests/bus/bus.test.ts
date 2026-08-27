import {describe,expect,it} from 'vitest'
import {Bus} from '../../src/bus/index.js'
describe('Bus replay',()=>{it('assigns ordered event ids and replays after a cursor',()=>{const bus=new Bus();const first=bus.publish('one',{});const second=bus.publish('two',{});expect(second.id).toBe(first.id+1);expect(bus.historySince(first.id)).toEqual([second])})})
