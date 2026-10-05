import {useState} from 'react'
import {useQueryClient} from '@tanstack/react-query'
import {Button,Dialog} from '@multiterm/rue-ui'
import {rue} from './client'
export function ClearHistory({sessionId,lastMessageId,close,cleared}:{sessionId:string;lastMessageId:string|null;close():void;cleared():void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),cache=useQueryClient()
 // Pin the confirmation to the history the user saw, not later background updates.
 const [expectedLastMessageId]=useState(lastMessageId)
 async function clear(){setBusy(true);setError('');try{await rue.clearSessionHistory(sessionId,expectedLastMessageId);await Promise.all(['messages','parts'].map(key=>cache.invalidateQueries({queryKey:[key,sessionId]})));void cache.invalidateQueries({queryKey:['sessions']});cleared();close()}catch{setError('History changed, a reply is active, or this bot requires a remote reset. Refresh and review before retrying.')}finally{setBusy(false)}}
 return <Dialog open title="Clear history?" description="Permanently remove this cloud bot’s messages and attachments. Its name, settings and your unsent draft are kept." onClose={()=>{if(!busy)close()}}>{error&&<p role="alert">{error}</p>}<div className="bot-dialog-actions"><Button variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button variant="destructive" isLoading={busy} disabled={busy} onClick={()=>void clear()}>Clear history</Button></div></Dialog>
}
