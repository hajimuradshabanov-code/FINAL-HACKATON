import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FORBIDDEN, assistantStatus, handleAssistant, rateLimited, sameOrigin, tooMany, type AssistantEnv, type AssistantResult } from './api/assistant'
import { handleRems, remsHeaders } from './api/rems'

/** Serves /api/rems (Mars weather relay) during `vite` and `vite preview`, like the Vercel function. */
function remsApi(): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const result = req.method === 'GET' ? await handleRems() : { status: 405, body: { error: 'method_not_allowed' } }
    res.statusCode = result.status
    for (const [k, v] of Object.entries(remsHeaders(result.status))) res.setHeader(k, v)
    res.end(JSON.stringify(result.body))
  }
  return {
    name: 'rems-api',
    configureServer: (server) => void server.middlewares.use('/api/rems', handle),
    configurePreviewServer: (server) => void server.middlewares.use('/api/rems', handle),
  }
}

/**
 * Serves /api/assistant during `vite` and `vite preview`, using the same handler as the Vercel
 * function. GEMINI_API_KEY is read from `.env` / the environment on the server side only; it has no
 * VITE_ prefix, so it is never bundled into the client.
 */
function assistantApi(env: AssistantEnv): Plugin {
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 64_000) reject(new Error('too large'))
      })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    let result: AssistantResult
    if (req.method === 'GET') result = assistantStatus(env)
    else if (req.method === 'POST') {
      const wait = sameOrigin(req.headers.origin ?? null, req.headers.host ?? null) ? rateLimited(req.socket.remoteAddress ?? '') : -1
      if (wait < 0) result = FORBIDDEN
      else if (wait > 0) result = tooMany(wait)
      else {
        let body: unknown = null
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          /* bad request */
        }
        result = await handleAssistant(body, env)
      }
    } else result = { status: 405, body: { error: 'method_not_allowed' } }
    res.statusCode = result.status
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(result.body))
  }
  return {
    name: 'assistant-api',
    configureServer: (server) => void server.middlewares.use('/api/assistant', handle),
    configurePreviewServer: (server) => void server.middlewares.use('/api/assistant', handle),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss(), assistantApi({ GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_MODEL: env.GEMINI_MODEL }), remsApi()],
    server: { host: true, port: 5173 },
  }
})
