import { Button } from '@multiterm/rue-ui'
import { useEffect, useRef, useState } from 'react'
import type { RuePart } from '@multiterm/rue-sdk'
import { rue } from './client'
import { previewImage, previewVideo } from './attachments'

export function ChatAttachment({ part }: { part: RuePart }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false), [url, setUrl] = useState(''), [error, setError] = useState(false), [retry, setRetry] = useState(0)
  const name = String(part.payload.name ?? 'Attachment'), mime = String(part.payload.mimeType ?? '')
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let alive = true, objectUrl = ''
    setError(false)
    void rue.attachment(part.sessionId, part.id).then(blob => {
      if (!alive) return
      objectUrl = URL.createObjectURL(new Blob([blob], { type: previewImage(mime) || previewVideo(mime) ? mime : 'application/octet-stream' }))
      setUrl(objectUrl)
    }).catch(() => { if (alive) setError(true) })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [visible, part.sessionId, part.id, mime, retry])
  return <div ref={ref} className="chat-attachment">
    {url && previewImage(mime) && <img src={url} alt={name} loading="lazy"/>}
    {url && previewVideo(mime) && <video src={url} controls preload="metadata" aria-label={name}/>}
    {url ? <a href={url} download={name}>{name} ↓</a> : error ? <Button variant="bare" type="button" onClick={() => setRetry(n => n + 1)}>Retry downloading {name}</Button> : <span>{name} · Loading…</span>}
    <small>{Math.ceil(Number(part.payload.size ?? 0) / 1024)} KB</small>
  </div>
}
