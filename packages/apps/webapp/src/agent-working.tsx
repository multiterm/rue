import { useRemoteFreshness } from './use-remote-freshness'
import type { RueMessage, RuePart, RueRemoteComputer } from '@multiterm/rue-sdk'
import {BotAvatar} from './bots'
import { useComputerQueue } from './use-computer-queue'
import './agent-working.css'

export function AgentWorking({ computer, observedAt, remote, sending, messages, parts, healthError,avatarIndex=0,avatarColor }: {
  avatarIndex?:number;avatarColor?:string
  computer?: RueRemoteComputer; observedAt?: number; remote: boolean; sending: boolean
  messages: RueMessage[]; parts: RuePart[]; healthError: boolean
}) {
  const queue = useComputerQueue(computer, false)
  const fresh = useRemoteFreshness(computer, observedAt)
  const active = queue.data?.messages ?? []
  const latest = messages.filter(message => message.role === 'assistant').at(-1)
  const streaming = !remote && latest && parts.some(part => part.messageId === latest.id && part.payload.streaming === true)
  const working = active.some(message => message.status === 'running') || computer?.health?.agentWorking
  let label: string | undefined
  if (remote && fresh && !healthError && computer?.health?.status?.state==='compacting') {
    label = 'Compacting…'
  } else if (remote && (working || active.length)) {
    label = healthError || queue.isError || !fresh ? active.length>0&&active.every(message=>message.status==='queued')?'Queued requests saved · waiting for the agent to reconnect.':'Checking agent status…' : working ? 'Working…' : active.some(message => message.status === 'claimed') ? 'Waiting for approval in Pi…' : 'Queued on computer…'
  } else if (sending || streaming) label = remote ? 'Sending to computer…' : 'Working…'
  if(!label&&remote){
    const latestUser=messages.filter(message=>message.role==='user').at(-1)
    const lastRun=computer?.runs?.find(run=>run.userMessageId===latestUser?.id&&run.userMessageId!==undefined)
    if(lastRun&&fresh&&!healthError&&!queue.isError&&['failed','interrupted','expired','cancelled','rejected'].includes(lastRun.status))label=lastRun.status==='expired'&&lastRun.expiredBeforeDispatch?(queue.data?.recoverableCount?'The queued request expired before dispatch. Open ••• → Expired Requests to review it.':'The queued request expired before dispatch. Review its saved message in the conversation.'):`Task ${lastRun.status}. Some tools may have run; review the transcript before retrying.`
    else if(healthError||queue.isError||(computer&&!fresh))label='Agent status unavailable. Tool completion does not confirm the task finished.'
  }
  if (!label) return null
  return <div className="agent-working-bar" role="region" aria-label="Agent activity" aria-live="polite"><span className={label==='Working…'||label==='Compacting…'?'working-avatar is-active':'working-avatar'}><BotAvatar index={avatarIndex} color={avatarColor} size="sm"/></span><span className="agent-working-label">{label}</span></div>
}
