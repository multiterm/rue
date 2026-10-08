import type {Database} from 'better-sqlite3'
import {getSession} from './sessions.js'
import {HistoryError} from '@multiterm/rue-db'
export {HistoryError}
/** Cloud-only: deleting a mirror must never pretend to reset a remote Pi memory. */
export function clearSessionHistory(db:Database,id:string,owner:string,expectedLastMessageId:string|null){
 return db.transaction(()=>{
  const session=getSession(db,id,owner)
  if(!session)throw new HistoryError(404,'session_not_found')
  if(session.terminalConnectionId||session.agent==='pi-terminal'||db.prepare('SELECT 1 FROM managed_agents WHERE session_id=?').get(id))throw new HistoryError(409,'remote_history_reset_required')
  const last=db.prepare('SELECT id FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1').get(id) as {id:string}|undefined
  if((last?.id??null)!==expectedLastMessageId)throw new HistoryError(409,'history_changed')
  db.prepare('DELETE FROM messages WHERE session_id=?').run(id)
  db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(Date.now(),id)
  return {cleared:true}
 }).immediate()
}
