import { app, BrowserWindow, dialog, ipcMain, session, systemPreferences } from 'electron'
import { createOverlayWindow, setStealth, setWindowHeight, setWindowMode, toggleMaximize } from './window.js'
import { createTray, destroyTray, setOpenAgentHandler, setOpenSettingsHandler, updateTrayMenu } from './tray.js'
import { getSettings, resetSettings, setSettings, type RueSettings } from './store.js'
import { captureScreenshot } from './capture/screenshot.js'
import { captureSelectedText } from './capture/selection.js'
import { fetchWebPage } from './capture/web.js'
import { closeHistory, initHistory, registerHistoryIpc } from './history.js'
import { registerSearchIpc } from './agents/search.js'
import { reconnectAll as mcpReconnect, disconnectAll as mcpDisconnect, registerMcpIpc } from './mcp/client.js'
import { closeNotebooks, initNotebooks, registerNotebookIpc } from './notebook/index.js'
import { registerScopeIpc } from './scope.js'
import { registerToolsIpc } from './tools/builtin.js'
import { registerSkillsIpc } from './skills/loader.js'
import { registerMemoryIpc } from './memory/memdir.js'
import { registerDebugIpc } from './debug.js'
import {
  registerScheduleIpc,
  setScheduleTarget,
  startScheduler,
  stopScheduler
} from './schedule/scheduler.js'
import { registerShortcut, unregisterAll as unregisterShortcuts } from './shortcut.js'

const bootErrors: string[] = []

function tryStep(label: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    const msg = `${label}: ${(err as Error).message}`
    console.error('[rue boot]', msg)
    bootErrors.push(msg)
  }
}

let overlay: BrowserWindow | null = null

function registerShortcuts(settings: RueSettings): { readonly accelerator: boolean } {
  return registerShortcut({
    accelerator: settings.shortcut,
    onSummon: () => void onSummon()
  })
}

async function onSummon(): Promise<void> {
  if (!overlay) return
  const visible = overlay.isVisible() && overlay.isFocused()
  if (visible) {
    overlay.hide()
    return
  }
  const settings = getSettings()
  if (settings.autoAttachSelection) {
    try {
      const { text } = await captureSelectedText()
      if (text.trim()) overlay.webContents.send('rue:autoselection', text)
    } catch {
      // Fail open — still show the overlay.
    }
  }
  overlay.show()
  overlay.focus()
}

/**
 * Open the overlay straight into the expanded chat ("agent") surface, rather
 * than the compact ask-bar. Used by the tray's "Open Agent Window" item.
 */
function openAgentWindow(): void {
  if (!overlay) return
  overlay.show()
  overlay.focus()
  overlay.webContents.send('rue:open-chat')
}

/** Open the window straight into Preferences (Settings). */
function openSettings(): void {
  if (!overlay) return
  overlay.show()
  overlay.focus()
  overlay.webContents.send('rue:open-settings')
}

/** Reflect the launch-at-login preference into the OS login items. */
function applyLoginItem(enabled: boolean): void {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (err) {
    console.error('[rue] setLoginItemSettings failed:', (err as Error).message)
  }
}

/** Show or hide the macOS Dock icon. No-op on other platforms. */
function applyDockVisibility(show: boolean): void {
  if (process.platform !== 'darwin' || !app.dock) return
  if (show) void app.dock.show()
  else app.dock.hide()
}

/** Create or tear down the menu-bar / system-tray icon. */
function applyMenuBar(show: boolean): void {
  if (show) {
    if (overlay) createTray(overlay)
  } else {
    destroyTray()
  }
}

function registerIpc(): void {
  ipcMain.handle('rue:settings:get', () => getSettings())

  ipcMain.handle('rue:settings:reset', () => {
    const next = resetSettings()
    registerShortcuts(next)
    if (overlay) setStealth(overlay, next.stealth)
    applyLoginItem(next.launchAtLogin)
    applyDockVisibility(next.showInDock)
    applyMenuBar(next.showInMenuBar)
    updateTrayMenu(next)
    return next
  })

  ipcMain.handle('rue:settings:set', (_e, partial: Partial<RueSettings>) => {
    const next = setSettings(partial)
    if (partial.shortcut !== undefined) registerShortcuts(next)
    if (partial.stealth !== undefined && overlay) setStealth(overlay, next.stealth)
    if (partial.mcpServers !== undefined) void mcpReconnect()
    if (partial.launchAtLogin !== undefined) applyLoginItem(next.launchAtLogin)
    if (partial.showInDock !== undefined) applyDockVisibility(next.showInDock)
    if (partial.showInMenuBar !== undefined) applyMenuBar(next.showInMenuBar)
    updateTrayMenu(next)
    return next
  })

  // macOS gates camera/mic at the OS level — prompt for access on first use.
  ipcMain.handle('rue:media:ensure-access', async (_e, kind: 'camera' | 'microphone') => {
    if (process.platform !== 'darwin') return true
    if (systemPreferences.getMediaAccessStatus(kind) === 'granted') return true
    return systemPreferences.askForMediaAccess(kind)
  })

  ipcMain.handle('rue:capture:screenshot', () => captureScreenshot())
  ipcMain.handle('rue:capture:selection', () => captureSelectedText())
  ipcMain.handle('rue:capture:web', (_e, url: string) => fetchWebPage(url))

  ipcMain.handle('rue:window:hide', () => overlay?.hide())
  ipcMain.handle('rue:window:show', () => {
    if (!overlay) return
    overlay.show()
    overlay.focus()
  })
  ipcMain.handle('rue:window:mode', (_e, mode: 'bar' | 'chat' | 'settings' | 'welcome') => {
    if (overlay) setWindowMode(overlay, mode)
  })
  ipcMain.handle('rue:window:height', (_e, height: number, animate?: boolean) => {
    if (overlay) setWindowHeight(overlay, height, animate ?? false)
  })
  ipcMain.handle('rue:window:toggle-maximize', () => (overlay ? toggleMaximize(overlay) : false))
}

app.whenReady().then(() => {
  app.setAboutPanelOptions({
    applicationName: 'Rue',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026',
    credits: 'An AI assistant for your desktop — chat with context from screenshots, selections, and web pages.'
  })

  // Create the window + tray FIRST so the user has visible feedback even if
  // downstream init (SQLite, MCP, etc.) explodes.
  try {
    overlay = createOverlayWindow()
  } catch (err) {
    dialog.showErrorBox('Rue — cannot create window', (err as Error).stack ?? String(err))
    return
  }

  // Create the tray up front as a guaranteed escape hatch — even if later
  // init fails. The "Show in menu bar" setting may tear it down afterwards.
  setOpenAgentHandler(openAgentWindow)
  setOpenSettingsHandler(openSettings)
  createTray(overlay)

  // Route fired scheduled tasks into this window, then start the ticker.
  setScheduleTarget(overlay.webContents)
  startScheduler()

  // Grant the renderer's getUserMedia (camera / microphone) requests — the OS
  // permission prompt is the real gate; this just clears Chromium's layer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  // Clicking the Dock icon (macOS) opens / focuses the window.
  app.on('activate', () => {
    if (overlay) {
      overlay.show()
      overlay.focus()
    }
  })

  tryStep('initHistory', initHistory)
  tryStep('initNotebooks', initNotebooks)
  tryStep('registerIpc', registerIpc)
  tryStep('registerHistoryIpc', registerHistoryIpc)
  tryStep('registerSearchIpc', registerSearchIpc)
  tryStep('registerMcpIpc', registerMcpIpc)
  tryStep('registerNotebookIpc', registerNotebookIpc)
  tryStep('registerScopeIpc', registerScopeIpc)
  tryStep('registerToolsIpc', registerToolsIpc)
  tryStep('registerSkillsIpc', registerSkillsIpc)
  tryStep('registerMemoryIpc', registerMemoryIpc)
  tryStep('registerScheduleIpc', registerScheduleIpc)
  tryStep('registerDebugIpc', registerDebugIpc)

  let settings: RueSettings | null = null
  try {
    settings = getSettings()
  } catch (err) {
    bootErrors.push(`getSettings: ${(err as Error).message}`)
  }

  if (settings) {
    applyLoginItem(settings.launchAtLogin)
    applyDockVisibility(settings.showInDock)
    applyMenuBar(settings.showInMenuBar)
    updateTrayMenu(settings)
    const { accelerator } = registerShortcuts(settings)
    if (!accelerator && settings.shortcut) {
      bootErrors.push(
        `Shortcut '${settings.shortcut}' could not be registered. Another app may be using it.\n` +
          'Pick a different one in Settings → Window.'
      )
    }
    if (settings.stealth) setStealth(overlay, true)
    if (settings.mcpServers.length > 0) void mcpReconnect()
  }

  // Surface any boot errors so the user knows something failed even if the
  // window appears to work for everything else.
  if (bootErrors.length > 0) {
    console.error('[rue] boot errors:\n  ' + bootErrors.join('\n  '))
    dialog.showErrorBox(
      'Rue started with errors',
      bootErrors.join('\n\n') +
        '\n\nRue is running but some features may not work. The tray icon is your fallback — click it to show/hide the window.'
    )
  }

  app.on('activate', () => {
    if (!overlay || overlay.isDestroyed()) {
      try {
        overlay = createOverlayWindow()
      } catch (err) {
        dialog.showErrorBox('Rue — cannot recreate window', String(err))
      }
    }
  })
}).catch(err => {
  // app.whenReady() itself rejecting is extraordinarily rare — bug in Electron
  // or something deeply wrong with the process. Surface it.
  dialog.showErrorBox('Rue failed to start', (err as Error).stack ?? String(err))
})

app.on('will-quit', () => {
  unregisterShortcuts()
  stopScheduler()
  closeHistory()
  closeNotebooks()
  void mcpDisconnect()
})

app.on('window-all-closed', () => {
  // Keep app alive when overlay is hidden — shortcut should re-open it.
})
