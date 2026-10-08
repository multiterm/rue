import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from 'react'

/** Pin newly selected conversations after data, visibility and media layout settle. */
export function useChatScroll(sessionId: string | undefined, visible: boolean, ready: boolean) {
  const viewport = useRef<HTMLDivElement>(null), following = useRef(true), opening = useRef(true)
  const lastTop = useRef(0), frame = useRef<number | undefined>(undefined), readyRef = useRef(ready)
  readyRef.current = ready
  const [showLatest, setShowLatest] = useState(false)
  const scheduleBottom = useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      const el = viewport.current
      if (!el || !following.current || !readyRef.current || !el.clientHeight) return
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
      opening.current = false
      setShowLatest(false)
    })
  }, [])
  const reset = useCallback(() => {
    following.current = true; opening.current = true; setShowLatest(false)
    lastTop.current = viewport.current?.scrollTop ?? 0
    scheduleBottom()
  }, [scheduleBottom])
  useLayoutEffect(reset, [sessionId, visible, reset])
  // Query results, streaming text and status messages can all change the layout.
  useLayoutEffect(() => { if (following.current) scheduleBottom() })
  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    // Observe content as well as the viewport: images/fonts/tool expansion and
    // opening a hidden mobile chat can change geometry without new query data.
    const observer = new ResizeObserver(() => { if (following.current) scheduleBottom() })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => { observer.disconnect(); if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined }
  }, [sessionId, visible, ready, scheduleBottom])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (opening.current) { scheduleBottom(); return }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (atBottom) { following.current = true; setShowLatest(false) }
    else if (!following.current || el.scrollTop < lastTop.current - 1) {
      // Actual upward movement opts out. Content growth alone must not disable
      // following before the resize observer has a chance to settle the layout.
      following.current = false; setShowLatest(true)
    } else scheduleBottom()
    lastTop.current = el.scrollTop
  }, [scheduleBottom])
  const jumpTo = useCallback((target:HTMLElement) => {
    const el=viewport.current
    if(!el||!el.contains(target))return
    following.current=false;opening.current=false
    if(frame.current!==undefined){cancelAnimationFrame(frame.current);frame.current=undefined}
    const box=target.getBoundingClientRect(),view=el.getBoundingClientRect()
    // Search is an explicit navigation intent, not content growth. Jump without
    // smooth-scroll intermediate frames that could re-enable bottom following.
    const previous=el.style.scrollBehavior;el.style.scrollBehavior='auto'
    el.scrollTop=Math.max(0,el.scrollTop+box.top-view.top-(el.clientHeight-box.height)/2)
    el.style.scrollBehavior=previous;lastTop.current=el.scrollTop
    const atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<64
    following.current=atBottom;setShowLatest(!atBottom)
  }, [])
  return { viewport, showLatest, onScroll, reset, jumpTo }
}
