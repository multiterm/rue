import { app, BrowserWindow, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { RueSettings } from './store.js'

let tray: Tray | null = null
let trayWin: BrowserWindow | null = null

const TRAY_ICON_FILE = 'rue-hat.png'

// Opens the window straight into the expanded chat surface.
let openAgentHandler: (() => void) | null = null
// Opens the window straight into Preferences (Settings).
let openSettingsHandler: (() => void) | null = null

export function setOpenAgentHandler(handler: () => void): void {
  openAgentHandler = handler
}

export function setOpenSettingsHandler(handler: () => void): void {
  openSettingsHandler = handler
}

/**
 * Resolve the tray-icon PNG path across dev (running from source) and prod
 * (running from the packaged .app). In prod, `extraResources` in
 * electron-builder.yml drops the file at `process.resourcesPath/<file>`.
 */
function resolveTrayIconPath(): string {
  const prodPath = join(process.resourcesPath, TRAY_ICON_FILE)
  if (existsSync(prodPath)) return prodPath
  const devCandidates = [
    join(app.getAppPath(), 'resources', TRAY_ICON_FILE),
    join(app.getAppPath(), '..', 'resources', TRAY_ICON_FILE),
    join(__dirname, '..', '..', 'resources', TRAY_ICON_FILE)
  ]
  for (const p of devCandidates) {
    if (existsSync(p)) return p
  }
  return prodPath
}

/**
 * Load the hat mark as the tray icon — a black silhouette with alpha, flagged
 * as a macOS template image so the OS recolors it to the menu bar.
 */
function loadTrayIcon(): NativeImage {
  const raw = nativeImage.createFromPath(resolveTrayIconPath())
  if (raw.isEmpty()) return raw
  const icon = raw.resize({ width: 22, height: 22, quality: 'best' })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon
}

/**
 * Build the menu-bar menu, Tailscale-style: a profile header, then sections
 * separated by dividers, with Quit pinned last.
 */
function buildMenu(win: BrowserWindow, settings: RueSettings | null): Menu {
  const name = settings?.profileName?.trim() || 'Rue'
  const email = settings?.profileEmail?.trim() || 'Set your name & email in Preferences'

  return Menu.buildFromTemplate([
    // ── Profile ────────────────────────────────────────
    { label: name, enabled: false },
    { label: email, enabled: false },
    { type: 'separator' },
    // ── Open ───────────────────────────────────────────
    {
      label: 'Open Rue',
      click: () => {
        win.show()
        win.focus()
      }
    },
    { type: 'separator' },
    // ── App ────────────────────────────────────────────
    { label: 'About Rue', click: () => app.showAboutPanel() },
    { label: 'Preferences…', click: () => openSettingsHandler?.() },
    { type: 'separator' },
    // ── Chats ──────────────────────────────────────────
    { label: 'Chats', click: () => openAgentHandler?.() },
    { type: 'separator' },
    // ── Quit (always last) ─────────────────────────────
    { label: 'Quit Rue', click: () => app.quit() }
  ])
}

export function createTray(win: BrowserWindow): Tray | null {
  if (tray && !tray.isDestroyed()) return tray

  try {
    tray = new Tray(loadTrayIcon())
  } catch (err) {
    console.error('[rue] tray creation failed:', (err as Error).message)
    return null
  }

  trayWin = win
  tray.setToolTip('Rue')
  // No tray-icon click handler — clicking the icon only opens this menu. The
  // window opens via "Open Rue", never from a bare icon click.
  tray.setContextMenu(buildMenu(win, null))
  return tray
}

/** Rebuild the menu — call after settings change so the profile stays current. */
export function updateTrayMenu(settings: RueSettings): void {
  if (tray && !tray.isDestroyed() && trayWin) {
    tray.setContextMenu(buildMenu(trayWin, settings))
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
  trayWin = null
}
