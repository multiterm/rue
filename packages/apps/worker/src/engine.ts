import {request} from 'node:http'
export class EngineError extends Error {constructor(readonly status:number){super('worker_engine_request_failed')}}
/** Bounded, nonredirecting Unix-socket API. Never returns daemon error bodies. */
export function engineRequest(socketPath:string,method:string,path:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const bytes=Buffer.isBuffer(body)?body:body===undefined?undefined:Buffer.from(JSON.stringify(body))
  const req=request({socketPath,method,path,signal,headers:bytes?{'content-type':Buffer.isBuffer(body)?'application/x-tar':'application/json','content-length':bytes.length}:{}},res=>{
   const chunks:Buffer[]=[];let size=0
   res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1048576)req.destroy();else chunks.push(chunk)})
   res.on('error',()=>reject(new EngineError(0)))
   res.on('end',()=>{
    const status=res.statusCode??0
    if(status<200||status>=300){reject(new EngineError(status));return}
    try{resolve(size?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined)}catch{reject(new EngineError(0))}
   })
  })
  const timer=setTimeout(()=>req.destroy(),15000)
  req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(new EngineError(0)));req.end(bytes)
 })
}
/** Single fixed-name root-owned private file. No caller-controlled archive paths. */
export function grantArchive(value:unknown):Buffer{
 const data=Buffer.from(JSON.stringify(value));if(data.length>32768)throw Error('worker_grant_too_large')
 const header=Buffer.alloc(512)
 header.write('grant.json');header.write('0000600\0',100);header.write('0000000\0',108);header.write('0000000\0',116)
 header.write(data.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136)
 header.fill(32,148,156);header.write('0',156);header.write('ustar\0',257);header.write('00',263)
 let sum=0;for(const byte of header)sum+=byte
 header.write(sum.toString(8).padStart(6,'0')+'\0 ',148)
 return Buffer.concat([header,data,Buffer.alloc((512-data.length%512)%512+1024)])
}
