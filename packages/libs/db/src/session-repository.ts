export interface SessionRecord {
 id:string;title:string;agent:string|null;provider:string|null;model:string|null;directory:string|null;scopes:string[];parentId:string|null;ownerSubject:string;createdAt:number;updatedAt:number;meta:Record<string,unknown>
}
export interface SessionCursor {updatedAt:number;id:string}
export interface SessionPageInput {limit?:number;cursor?:SessionCursor}
export interface SessionPage {items:SessionRecord[];nextCursor:SessionCursor|null}
export interface SessionRepository {
 list(owner:string,input?:SessionPageInput):Promise<SessionPage>
 get(owner:string,id:string):Promise<SessionRecord|undefined>
}
export function sessionPageLimit(owner:string,input:SessionPageInput={}){
 if(!owner.trim())throw Error('A session owner is required')
 const limit=input.limit??100
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Session page limit must be between 1 and 100')
 if(input.cursor&&(!Number.isSafeInteger(input.cursor.updatedAt)||input.cursor.updatedAt<0||!input.cursor.id))throw Error('Invalid session cursor')
 return limit
}
export function sessionPage(rows:SessionRecord[],limit:number):SessionPage{
 const items=rows.slice(0,limit),last=items.at(-1)
 return {items,nextCursor:rows.length>limit&&last?{updatedAt:last.updatedAt,id:last.id}:null}
}
