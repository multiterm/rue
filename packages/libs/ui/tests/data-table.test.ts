import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test} from 'vitest'
import {DataTable,type DataColumn} from '../src/data-table/index'
type Row={id:string;provider:string}
const columns:DataColumn<Row>[]=[{id:'id',title:'Key',value:row=>row.id},{id:'provider',title:'Provider',value:row=>row.provider,filterOptions:[{value:'OpenAI',label:'OpenAI'}]}]
test('shared TanStack table bounds rendered rows and exposes accessible controls',()=>{
 const html=renderToStaticMarkup(createElement(DataTable<Row>,{title:'Keys',columns,rows:Array.from({length:60},(_,i)=>({id:`entry-${i}`,provider:'OpenAI'})),rowKey:row=>row.id}))
 expect(html.match(/<tr[ >]/g)).toHaveLength(26)
 expect(html).toContain('entry-24');expect(html).not.toContain('entry-25')
 expect(html).toContain('Page 1 of 3');expect(html).toContain('Search keys');expect(html).toContain('aria-label="Filters"');expect(html).toContain('aria-sort="none"')
})
test('empty tables do not fabricate provider or credential rows',()=>{
 const html=renderToStaticMarkup(createElement(DataTable<Row>,{title:'Keys',columns,rows:[],rowKey:row=>row.id,empty:'No saved keys.'}))
 expect(html).toContain('No saved keys.');expect(html).not.toContain('<td class="px-5 py-4')
})
