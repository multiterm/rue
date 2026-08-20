import { useCallback, useEffect, useRef, useState } from 'react'
import {
  InterportSession,
  type InterportMessage,
  type PairingInfo,
  type PeerInfo,
  type SessionStatus
} from '@super-repo/interport-client'

export interface UseInterport {
  readonly status: SessionStatus
  readonly pairing: PairingInfo | null
  readonly pendingPeer: PeerInfo | null
  readonly connectedPeer: PeerInfo | null
  readonly messages: ReadonlyArray<InterportMessage>
  readonly error: string | null
  startHosting(relayAddress: string): void
  approve(): void
  reject(): void
  sendMessage(text: string): void
  reset(): void
}

/**
 * Drives an {@link InterportSession} in *host* mode — Rue desktop hosts the
 * agent, a mobile/web client is the guest. The hook owns the session lifecycle
 * and projects its event stream into React state.
 */
export function useInterport(): UseInterport {
  const sessionRef = useRef<InterportSession | null>(null)
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [pendingPeer, setPendingPeer] = useState<PeerInfo | null>(null)
  const [connectedPeer, setConnectedPeer] = useState<PeerInfo | null>(null)
  const [messages, setMessages] = useState<ReadonlyArray<InterportMessage>>([])
  const [error, setError] = useState<string | null>(null)

  // Always tear the session down when the panel unmounts.
  useEffect(() => () => sessionRef.current?.close(), [])

  const reset = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    setStatus('idle')
    setPairing(null)
    setPendingPeer(null)
    setConnectedPeer(null)
    setMessages([])
    setError(null)
  }, [])

  const startHosting = useCallback((relayAddress: string) => {
    sessionRef.current?.close()
    setPairing(null)
    setPendingPeer(null)
    setConnectedPeer(null)
    setMessages([])
    setError(null)

    const session = new InterportSession({ relayAddress, label: 'Rue · Desktop' })
    session.on('status', setStatus)
    session.on('pairing', setPairing)
    session.on('peer-pending', setPendingPeer)
    session.on('peer-connected', peer => {
      setConnectedPeer(peer)
      setPendingPeer(null)
    })
    session.on('peer-left', () => setConnectedPeer(null))
    session.on('message', message => setMessages(prev => [...prev, message]))
    session.on('error', err => setError(err.message))

    sessionRef.current = session
    void session.host()
  }, [])

  const approve = useCallback(() => {
    if (pendingPeer) sessionRef.current?.approve(pendingPeer.peerId)
  }, [pendingPeer])

  const reject = useCallback(() => {
    if (!pendingPeer) return
    sessionRef.current?.reject(pendingPeer.peerId)
    setPendingPeer(null)
  }, [pendingPeer])

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    const sent = sessionRef.current?.send('chat', { text: trimmed }) ?? false
    if (sent) {
      // Optimistic local echo — `chat-local` marks our own messages.
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), ts: Date.now(), kind: 'chat-local', body: { text: trimmed } }
      ])
    }
  }, [])

  return {
    status,
    pairing,
    pendingPeer,
    connectedPeer,
    messages,
    error,
    startHosting,
    approve,
    reject,
    sendMessage,
    reset
  }
}
