import type {CommandModule} from 'yargs'
import {runTui} from '@multiterm/rue-tui'
export interface TuiArgs{url:string;token?:string}
export const tuiCommand:CommandModule<unknown,TuiArgs>={command:'tui',describe:'Attach the terminal client to a Rue core',builder:(y)=>y.option('url',{type:'string',default:process.env.RUE_API_URL??'http://127.0.0.1:4097',describe:'Rue API base URL'}).option('token',{type:'string',default:process.env.RUE_ACCESS_TOKEN,describe:'Keyname bearer token'}),handler:async(argv)=>runTui({baseUrl:argv.url,token:argv.token})}
