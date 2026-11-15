/**
 * Node-style (req, res) entry for /api/assistant, used when the app is deployed from a prebuilt
 * Vercel Build Output (see scripts/build-vercel-output.mjs). Same logic as api/assistant.ts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FORBIDDEN, assistantStatus, clientOf, handleAssistant, rateLimited, sameOrigin, tooMany, type AssistantEnv, type AssistantResult } from '../api/assistant'

const env = (): AssistantEnv => ({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL })

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 64_000) reject(new Error('too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  let result: AssistantResult
  try {
    if (req.method === 'GET') result = assistantStatus(env())
    else if (req.method === 'POST') {
      const wait = sameOrigin((req.headers.origin as string | undefined) ?? null, (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? null)
        ? rateLimited(clientOf(req.headers['x-forwarded-for'] as string | undefined, req.socket.remoteAddress))
        : -1
      if (wait < 0) result = FORBIDDEN
      else if (wait > 0) result = tooMany(wait)
      else {
        let body: unknown = null
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          /* bad request */
        }
        result = await handleAssistant(body, env())
      }
    } else result = { status: 405, body: { error: 'method_not_allowed' } }
  } catch {
    result = { status: 500, body: { error: 'internal', message: 'The assistant failed unexpectedly.' } }
  }
  res.statusCode = result.status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(result.body))
}
