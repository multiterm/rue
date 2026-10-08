import { request } from 'node:http'

/** Read-only engine probe. No arbitrary paths, shell commands, or Docker options. */
export function dockerInfo(socketPath: string, signal?: AbortSignal): Promise<{ version: string; cpus: number; totalMemoryBytes: number }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/info', method: 'GET', signal }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error('worker_docker_unavailable')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_048_576) req.destroy(Error('worker_docker_response_too_large'))
        else chunks.push(chunk)
      })
      response.on('error', () => reject(Error('worker_docker_unavailable')))
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString())
          if (typeof value.ServerVersion !== 'string' || value.ServerVersion.length > 80 || !Number.isSafeInteger(value.NCPU) || value.NCPU < 1 || !Number.isSafeInteger(value.MemTotal) || value.MemTotal < 1) throw Error()
          resolve({ version: value.ServerVersion, cpus: value.NCPU, totalMemoryBytes: value.MemTotal })
        } catch { reject(Error('worker_docker_response_invalid')) }
      })
    })
    const deadline = setTimeout(() => req.destroy(Error('worker_docker_timeout')), 5000)
    req.on('close', () => clearTimeout(deadline))
    req.on('error', () => reject(Error('worker_docker_unavailable')))
    req.end()
  })
}
