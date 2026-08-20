/**
 * The media library — a thin wrapper over the browser media APIs for device
 * enumeration, audio/video capture, and still-frame grabbing. Voice and camera
 * features build on this; it carries no UI and no model concepts.
 */

export type MediaDeviceKind = 'audioinput' | 'videoinput' | 'audiooutput'

export interface MediaDeviceOption {
  readonly deviceId: string
  readonly label: string
  readonly kind: MediaDeviceKind
  readonly groupId: string
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

function mediaDevices(): MediaDevices {
  const api = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!api) {
    throw new MediaError('Media devices are unavailable — the window must run in a secure context.')
  }
  return api
}

export function isMediaSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.enumerateDevices)
}

/**
 * List input/output devices. Labels are only populated once the user has
 * granted media permission once — call after a successful getUserMedia.
 */
export async function listDevices(kind?: MediaDeviceKind): Promise<ReadonlyArray<MediaDeviceOption>> {
  const devices = await mediaDevices().enumerateDevices()
  return devices
    .filter(device => !kind || device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || fallbackLabel(device.kind as MediaDeviceKind, index),
      kind: device.kind as MediaDeviceKind,
      groupId: device.groupId
    }))
}

function fallbackLabel(kind: MediaDeviceKind, index: number): string {
  const noun = kind === 'videoinput' ? 'Camera' : kind === 'audioinput' ? 'Microphone' : 'Speaker'
  return `${noun} ${index + 1}`
}

/** Subscribe to device hot-plug events. Returns an unsubscribe function. */
export function onDeviceChange(callback: () => void): () => void {
  const api = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!api) return () => undefined
  api.addEventListener('devicechange', callback)
  return () => api.removeEventListener('devicechange', callback)
}

export async function getAudioStream(deviceId?: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true }
  if (deviceId) audio.deviceId = { exact: deviceId }
  try {
    return await mediaDevices().getUserMedia({ audio })
  } catch (err) {
    // An `exact` device that has been unplugged fails — fall back to default.
    if (deviceId) return retryDefault({ audio: { echoCancellation: true, noiseSuppression: true } })
    throw new MediaError(describeMediaError(err))
  }
}

export async function getVideoStream(deviceId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } }
  if (deviceId) video.deviceId = { exact: deviceId }
  try {
    return await mediaDevices().getUserMedia({ video })
  } catch (err) {
    if (deviceId) return retryDefault({ video: true })
    throw new MediaError(describeMediaError(err))
  }
}

async function retryDefault(constraints: MediaStreamConstraints): Promise<MediaStream> {
  try {
    return await mediaDevices().getUserMedia(constraints)
  } catch (err) {
    throw new MediaError(describeMediaError(err))
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/** Map a raw getUserMedia rejection to a user-legible message. */
export function describeMediaError(err: unknown): string {
  switch ((err as { name?: string }).name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone access was denied. Grant Rue permission in System Settings → Privacy & Security.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No matching camera or microphone was found.'
    case 'NotReadableError':
      return 'The camera or microphone is already in use by another application.'
    default:
      return `Media error: ${(err as Error)?.message || String(err)}`
  }
}

/** Grab a single still frame from a video stream as a JPEG data URL. */
export async function captureFrame(stream: MediaStream): Promise<string> {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  await video.play().catch(() => undefined)
  await waitForFrame(video)

  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || 1280
  canvas.height = video.videoHeight || 720
  const context = canvas.getContext('2d')
  if (!context) throw new MediaError('Could not acquire a 2D canvas context.')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)

  video.pause()
  video.srcObject = null
  return canvas.toDataURL('image/jpeg', 0.85)
}

function waitForFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise(resolve => {
    if (video.videoWidth > 0) return resolve()
    video.addEventListener('loadeddata', () => resolve(), { once: true })
  })
}

/** The best-supported audio container for MediaRecorder on this platform. */
export function preferredAudioMimeType(): MediaRecorderOptions {
  if (typeof MediaRecorder === 'undefined') return {}
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return { mimeType: type }
  }
  return {}
}

/**
 * Record `durationMs` of audio from a stream into a single Blob. Resolves
 * early if the abort signal fires (the user stopped generation).
 */
export function recordAudio(stream: MediaStream, durationMs: number, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const recorder = new MediaRecorder(stream, preferredAudioMimeType())
    const chunks: Blob[] = []
    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    recorder.onerror = () => reject(new MediaError('Audio recording failed.'))

    const finish = (): void => {
      if (recorder.state !== 'inactive') recorder.stop()
    }
    const timer = setTimeout(finish, durationMs)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        finish()
      },
      { once: true }
    )
    recorder.start()
  })
}
