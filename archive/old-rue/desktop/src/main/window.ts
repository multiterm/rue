import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const WIDTH = 720
export const ASK_BAR_HEIGHT = 72
export const SETTINGS_HEIGHT = 600
// Chat shares the settings surface's height so the two expanded views match.
export const CHAT_HEIGHT = SETTINGS_HEIGHT

// Hard upper bound — even if content asks for more, never go taller than this
// so the overlay can't take over a small laptop screen.
export const MAX_HEIGHT = 720
// Floor so the window never collapses below a usable input row.
export const MIN_HEIGHT = 56

/**
 * Create Rue's main application window. It is a normal app window — it
 * appears in the Dock and the window list, keeps a shadow, and does NOT hide
 * on blur or float above everything (it is not an overlay). The frame is
 * still custom-drawn (ChatHeader provides the title bar / drag region).
 */
export function createOverlayWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2)
  const y = Math.round(workArea.y + (workArea.height - CHAT_HEIGHT) / 2)

  const win = new BrowserWindow({
    width: WIDTH,
    height: CHAT_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: true,
    maximizable: true,
    minWidth: 380,
    minHeight: 120,
    movable: true,
    show: false,
    skipTaskbar: false,
    fullscreenable: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Show once the renderer has painted, so launch doesn't flash an empty frame.
  win.once('ready-to-show', () => win.show())

  return win
}

export function toggleWindow(win: BrowserWindow): void {
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

export function setStealth(win: BrowserWindow, enabled: boolean): void {
  win.setContentProtection(enabled)
}

/**
 * Morph the window between the compact ask-bar and the expanded chat/settings
 * surfaces. Pin the BOTTOM edge when expanding upward so the input row stays
 * where the user's cursor is — same trick Thuki uses for "growsUpward" mode.
 * The `welcome` mode is the exception: it re-centers on screen instead.
 */
export type WindowMode = 'bar' | 'chat' | 'settings' | 'welcome'

export function setWindowMode(win: BrowserWindow, mode: WindowMode): void {
  // Any mode swap leaves the maximized state behind.
  savedBounds = null
  if (mode === 'welcome') {
    centerWindow(win, SETTINGS_HEIGHT)
    return
  }
  // If the window was maximized (or otherwise off the standard width),
  // restore the canonical WIDTH and re-center horizontally before sizing.
  const b = win.getBounds()
  if (b.width !== WIDTH) {
    const { workArea } = screen.getPrimaryDisplay()
    win.setBounds(
      { x: Math.round(workArea.x + (workArea.width - WIDTH) / 2), y: b.y, width: WIDTH, height: b.height },
      false
    )
  }
  const target = mode === 'settings' ? SETTINGS_HEIGHT : mode === 'chat' ? CHAT_HEIGHT : ASK_BAR_HEIGHT
  // Mode swaps are user-driven and infrequent — animate them so the expand /
  // collapse reads as one smooth motion rather than an instant jump.
  setWindowHeight(win, target, true)
}

// Bounds captured before maximizing, so "restore" can put the window back.
let savedBounds: Electron.Rectangle | null = null

/**
 * Toggle the expanded window between its current size and a maximized state
 * that fills the primary display's work area. Returns the new maximized flag.
 */
export function toggleMaximize(win: BrowserWindow): boolean {
  cancelResizeTween()
  if (savedBounds) {
    win.setBounds(savedBounds, false)
    savedBounds = null
    return false
  }
  savedBounds = win.getBounds()
  win.setBounds(screen.getPrimaryDisplay().workArea, false)
  return true
}

// Holds the in-flight resize tween's interval id, if any.
let resizeTween: ReturnType<typeof setInterval> | null = null

function cancelResizeTween(): void {
  if (resizeTween) {
    clearInterval(resizeTween)
    resizeTween = null
  }
}

/** Bottom-pinned bounds write: keep `bottom` fixed, move the top edge. */
function applyHeight(win: BrowserWindow, bottom: number, height: number): void {
  const b = win.getBounds()
  const h = Math.round(height)
  win.setBounds({ x: b.x, y: Math.max(0, Math.round(bottom - h)), width: b.width, height: h }, false)
}

/**
 * Resize the window to a specific content height. Clamps to [MIN, MAX].
 * Bottom-pinned: the window's bottom edge stays put, the top edge moves so
 * the input row never drifts under the user's cursor.
 *
 * `animate` tweens the height over ~180ms (easeOutCubic). Used for mode swaps
 * and the first ResizeObserver measurement after a mode change. Per-frame
 * observer updates pass `animate=false` — they're already smooth and a tween
 * there would fight the high-frequency stream of updates.
 */
export function setWindowHeight(win: BrowserWindow, requestedHeight: number, animate = false): void {
  const target = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(requestedHeight)))
  cancelResizeTween()
  const bounds = win.getBounds()
  if (bounds.height === target) return
  const bottom = bounds.y + bounds.height

  if (!animate) {
    applyHeight(win, bottom, target)
    return
  }

  const start = bounds.height
  const startedAt = Date.now()
  const duration = 180
  resizeTween = setInterval(() => {
    if (win.isDestroyed()) {
      cancelResizeTween()
      return
    }
    const t = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - t, 3)
    applyHeight(win, bottom, start + (target - start) * eased)
    if (t >= 1) cancelResizeTween()
  }, 1000 / 60)
}

/** Resize to `height` and recenter the window on the primary display. */
function centerWindow(win: BrowserWindow, height: number): void {
  cancelResizeTween()
  const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)))
  const { workArea } = screen.getPrimaryDisplay()
  win.setBounds(
    {
      x: Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      y: Math.round(workArea.y + (workArea.height - h) / 2),
      width: WIDTH,
      height: h
    },
    false
  )
}
