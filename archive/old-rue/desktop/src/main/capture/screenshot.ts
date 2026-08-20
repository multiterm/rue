import { desktopCapturer, screen } from 'electron'

export interface ScreenshotResult {
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
  const primary = screen.getPrimaryDisplay()
  const { width, height } = primary.size
  const scale = primary.scaleFactor

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale)
    }
  })

  const target = sources.find(s => s.display_id === String(primary.id)) ?? sources[0]
  if (!target) throw new Error('No screen source available')

  const image = target.thumbnail
  const size = image.getSize()
  return {
    dataUrl: image.toDataURL(),
    width: size.width,
    height: size.height
  }
}
