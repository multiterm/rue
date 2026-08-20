import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 4173)
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' }
createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  let file = join(root, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream')
  response.setHeader('cache-control', file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable')
  createReadStream(file).on('error', () => { response.statusCode = 404; response.end('Not found') }).pipe(response)
}).listen(port, '0.0.0.0', () => console.log(`static service listening on ${port}`))
