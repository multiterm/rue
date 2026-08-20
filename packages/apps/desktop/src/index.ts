import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'Rue',
    backgroundColor: '#09120e',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('https://app.rue.multiterm.dev')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.RUE_WEBAPP_URL) await window.loadURL(process.env.RUE_WEBAPP_URL)
  else await window.loadFile(join(app.getAppPath(), '../webapp/dist/index.html'))
}

app.whenReady().then(async () => {
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
