import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'

/** Path of the debug trace log — under Electron's per-user logs directory. */
function logPath(): string {
  return join(app.getPath('logs'), 'rue-debug.log')
}

/**
 * Append one already-serialised debug trace line to the log file. Best-effort:
 * a logging failure must never disrupt the chat, so write errors are swallowed.
 */
export async function appendDebugLog(line: string): Promise<void> {
  await appendFile(logPath(), `${line}\n`, 'utf8').catch(() => undefined)
}

export function registerDebugIpc(): void {
  ipcMain.handle('rue:debug:log', (_e, line: string) => appendDebugLog(line))
}
