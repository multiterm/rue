import { clipboard } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface SelectionResult {
  readonly text: string
}

const COPY_DELAY_MS = 120

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function sendCopyKeystroke(): Promise<void> {
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
    await execAsync(`powershell -NoProfile -Command "${ps}"`)
    return
  }
  if (process.platform === 'darwin') {
    const osa = `tell application "System Events" to keystroke "c" using command down`
    await execAsync(`osascript -e '${osa}'`)
    return
  }
  await execAsync('xdotool key --clearmodifiers ctrl+c')
}

export async function captureSelectedText(): Promise<SelectionResult> {
  const previous = clipboard.readText()
  clipboard.writeText('')

  try {
    await sendCopyKeystroke()
  } catch (err) {
    clipboard.writeText(previous)
    throw new SelectionError('Failed to send copy keystroke', err)
  }

  await sleep(COPY_DELAY_MS)
  const captured = clipboard.readText()
  clipboard.writeText(previous)

  return { text: captured }
}

class SelectionError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message)
    this.name = 'SelectionError'
  }
}
