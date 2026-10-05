import {randomUUID} from 'node:crypto'
import type {Database} from 'better-sqlite3'
export interface InboxNotification {id:string;sessionId:string;kind:'task_completed'|'task_failed';createdAt:number;readAt:number|null}
/** Called inside the task's completion transaction. No prompt or output content is copied. */
export function recordTaskNotification(db:Database,sessionId:string,eventKey:string,kind:InboxNotification['kind'],now=Date.now()){
 const session=db.prepare('SELECT owner_subject FROM sessions WHERE id=?').get(sessionId) as {owner_subject:string}|undefined
 if(!session)return
 const id=randomUUID()
 const inserted=db.prepare(`INSERT OR IGNORE INTO notifications(id,owner_subject,session_id,event_key,kind,created_at) VALUES(?,?,?,?,?,?)`).run(id,session.owner_subject,sessionId,eventKey,kind,now)
 if(inserted.changes)db.prepare(`INSERT INTO push_deliveries(notification_id,subscription_id,next_at) SELECT ?,id,? FROM push_subscriptions WHERE owner_subject=? AND expires_at>?`).run(id,now,session.owner_subject,now)
}
export function notificationInbox(db:Database,owner:string){
 const items=db.prepare(`SELECT n.id,n.session_id AS sessionId,n.kind,n.created_at AS createdAt,n.read_at AS readAt
  FROM notifications n JOIN sessions s ON s.id=n.session_id AND s.owner_subject=n.owner_subject
  WHERE n.owner_subject=? ORDER BY n.created_at DESC,n.id DESC LIMIT 100`).all(owner) as InboxNotification[]
 const unread=(db.prepare('SELECT count(*) AS n FROM notifications n JOIN sessions s ON s.id=n.session_id AND s.owner_subject=n.owner_subject WHERE n.owner_subject=? AND n.read_at IS NULL').get(owner) as {n:number}).n
 return {items,unread}
}
export function readNotification(db:Database,owner:string,id:string,now=Date.now()){
 return db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND owner_subject=?').run(now,id,owner).changes>0
}
