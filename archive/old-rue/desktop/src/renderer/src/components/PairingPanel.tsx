import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import QRCode from 'qrcode'
import { Check, Link2, RefreshCw, Send, Smartphone, X } from 'lucide-react'
import { useInterport } from '../hooks/useInterport.js'
import { INLINE } from '../lib/motion.js'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting to relay…',
  'awaiting-peer': 'Waiting for a device to scan',
  'peer-pending': 'A device wants to connect',
  negotiating: 'Negotiating connection…',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Connection failed'
}

interface PairingPanelProps {
  readonly onClose: () => void
}

/**
 * "Connect a device" surface. Rue desktop acts as the Interport host:
 * it reserves a relay slot, shows a QR code, and approves the mobile guest.
 */
export function PairingPanel({ onClose }: PairingPanelProps) {
  const interport = useInterport()
  const [relayAddress, setRelayAddress] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  // Render the pairing payload as a QR code whenever it changes.
  useEffect(() => {
    if (!interport.pairing) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(interport.pairing.pairingPayload, { width: 232, margin: 1 })
      .then(url => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [interport.pairing])

  // Tick down the pairing-token expiry.
  useEffect(() => {
    const expiresAt = interport.pairing?.pairingExpiresAt
    if (!expiresAt) {
      setSecondsLeft(null)
      return
    }
    const tick = (): void => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [interport.pairing])

  const { status, pairing, pendingPeer, connectedPeer, messages, error } = interport

  return (
    <motion.div
      key="connect"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={INLINE}
      className="flex flex-1 min-h-0 flex-col"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="size-4 text-primary" />
          Connect a device
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        <p className="text-xs text-muted-foreground">{STATUS_LABEL[status] ?? status}</p>

        {/* ── idle: enter the relay address ── */}
        {status === 'idle' && (
          <div className="mt-4 flex flex-col gap-3">
            <label className="text-sm font-medium" htmlFor="relay-addr">
              Relay multiaddr
            </label>
            <input
              id="relay-addr"
              value={relayAddress}
              onChange={e => setRelayAddress(e.target.value)}
              placeholder="/ip4/203.0.113.7/tcp/9090/ws/p2p/<RelayPeerId>"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="text-[11px] text-muted-foreground">
              Printed by the Interport relay on startup.
            </p>
            <button
              disabled={relayAddress.trim().length === 0}
              onClick={() => interport.startHosting(relayAddress.trim())}
              className="mt-1 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Link2 className="size-4" />
              Create pairing code
            </button>
          </div>
        )}

        {/* ── awaiting a guest: show the QR ── */}
        {(status === 'connecting' || status === 'awaiting-peer') && (
          <div className="mt-4 flex flex-col items-center gap-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Pairing QR code"
                className="rounded-lg border border-border bg-white p-2"
              />
            ) : (
              <div className="flex h-[232px] w-[232px] items-center justify-center text-xs text-muted-foreground">
                {status === 'connecting' ? 'Reserving a relay slot…' : 'Generating QR…'}
              </div>
            )}
            {secondsLeft !== null && (
              <p className="text-[11px] text-muted-foreground">
                Code expires in {secondsLeft}s — scan it with Rue mobile.
              </p>
            )}
            {pairing && (
              <code className="max-w-full break-all rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                {pairing.pairingPayload}
              </code>
            )}
          </div>
        )}

        {/* ── a guest is pending approval ── */}
        {status === 'peer-pending' && pendingPeer && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border p-4">
            <p className="text-sm">
              <span className="font-medium">{pendingPeer.label}</span> wants to connect.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => interport.approve()}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                <Check className="size-4" />
                Approve
              </button>
              <button
                onClick={() => interport.reject()}
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <X className="size-4" />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* ── connected: prove the channel works ── */}
        {status === 'connected' && connectedPeer && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-primary">
              <Check className="size-4" />
              Linked to {connectedPeer.label}
            </div>
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-3">
              {messages.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No messages yet.</p>
              )}
              {messages.map(message => {
                const mine = message.kind === 'chat-local'
                const text =
                  typeof message.body === 'object' && message.body !== null
                    ? String((message.body as { text?: unknown }).text ?? '')
                    : String(message.body)
                return (
                  <div
                    key={message.id}
                    className={`text-xs ${mine ? 'self-end text-primary' : 'self-start text-foreground'}`}
                  >
                    {text}
                  </div>
                )
              })}
            </div>
            <form
              onSubmit={e => {
                e.preventDefault()
                interport.sendMessage(draft)
                setDraft('')
              }}
              className="flex gap-2"
            >
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="Send a test message…"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="flex items-center justify-center rounded-md bg-primary px-3 text-primary-foreground"
                aria-label="Send"
              >
                <Send className="size-4" />
              </button>
            </form>
          </div>
        )}

        {(status === 'failed' || status === 'disconnected') && (
          <button
            onClick={() => interport.reset()}
            className="mt-4 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <RefreshCw className="size-4" />
            Start over
          </button>
        )}

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      </div>
    </motion.div>
  )
}
