import type { RueRemoteComputer, RueSession } from '@multiterm/rue-sdk'
import './bot-execution.css'

export const isRemoteBot = (session: RueSession) => Boolean(session.terminalConnectionId || session.agent === 'pi-terminal')
export function BotExecution({ session, computers }: { session: RueSession; computers?: RueRemoteComputer[] }) {
  const computer = computers?.find(c => c.sessionId === session.id && c.ownerSubject === session.ownerSubject)
  const remote = isRemoteBot(session) || Boolean(computer)
  const label = remote ? `Remote · ${computer?.name ?? 'Paired computer'} · ${computer ? `${computer.status}${computer.remoteEnabled ? '' : ' · prompts disabled'}` : 'status unavailable'}` : 'Cloud · Rue server'
  return <span className={`bot-execution ${remote ? 'remote' : 'cloud'}`} title={remote ? 'This bot runs in its paired Pi session, using that computer’s provider credentials and tool permissions. It never falls back to cloud execution.' : 'This bot runs on Rue’s server using your server-side Agent settings. It is not paired to a computer.'}>{label}</span>
}
