import { Button } from '@multiterm/rue-ui'
import { useEffect, useId, useState } from 'react'
import type { RueRemoteComputer } from '@multiterm/rue-sdk'
import { useComputerQueue } from './use-computer-queue'
import './message-queue.css'

const labels = { queued: 'Queued', claimed: 'Awaiting approval', running: 'Working' }
export function MessageQueue({ computer }: { computer: RueRemoteComputer }) {
  const [expanded, setExpanded] = useState(false), id = useId()
  const queue = useComputerQueue(computer)
  const messages = queue.data?.messages ?? []
  useEffect(() => { if (messages.length < 2) setExpanded(false) }, [queue.data, messages.length, queue.isError])
  // One active request already has its status in the conversation.
  // Retain a known multi-request queue during transient network failures.
  if(messages.length<2)return null
  return <section className="message-queue" aria-label="Message queue">
    <Button variant="bare" type="button" className="message-queue-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} message queue: ${messages.length ? `${messages.length} active ${messages.length === 1 ? 'message' : 'messages'}` : 'status unavailable'}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span><strong>Queue</strong>
      <span role="status" aria-live="polite">{messages.length ? `${messages.length} active ${messages.length === 1 ? 'message' : 'messages'}` : 'Status unavailable'}</span>
    </Button>
    {queue.isError && <div className="message-queue-error" role="status">Queue status may be out of date. <Button variant="bare" type="button" disabled={queue.isFetching} onClick={() => void queue.refetch()}>Retry</Button></div>}
    {expanded && <div id={id} className="message-queue-details"><ol>{messages.map(message => <li key={message.id}>
      <span className="message-queue-status" data-status={message.status}>{labels[message.status] ?? message.status}</span>
      <p>{message.text}</p>
    </li>)}</ol></div>}
  </section>
}
