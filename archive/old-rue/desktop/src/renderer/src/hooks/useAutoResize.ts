import { useEffect, useRef } from 'react'

/**
 * Watch an element's measured height and forward it to the Electron main
 * process so the BrowserWindow shrinks/grows to fit content. Only useful in
 * "bar" mode where the spotlight needs to grow when attachments are added;
 * in chat/settings mode the window is mode-snapped to a fixed size and
 * internal ScrollAreas handle overflow.
 *
 * Throttled to one update per animation frame so streaming-driven layout
 * thrash doesn't fire 60+ setBounds calls per second.
 */
export function useAutoResize<T extends HTMLElement>(enabled: boolean): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  const rafRef = useRef<number | null>(null)
  const lastSentRef = useRef<number>(0)

  useEffect(() => {
    if (!enabled) {
      lastSentRef.current = 0
      return
    }
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const height = Math.ceil(entry.contentRect.height)
      if (height === lastSentRef.current) return

      // A large jump is a mode transition (collapsing chat → bar) — tween it
      // so it matches the animated expand. Small per-frame deltas (a chip
      // added, a line wrapped) resize instantly; tweening those would fight
      // the high-frequency stream of updates.
      const animate = Math.abs(height - lastSentRef.current) > 64

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        lastSentRef.current = height
        void window.rue.setWindowHeight(height, animate)
      })
    })

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [enabled])

  return ref
}
