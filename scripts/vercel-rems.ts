/**
 * Node-style (req, res) entry for /api/rems, used when the app is deployed from a prebuilt Vercel
 * Build Output (see scripts/build-vercel-output.mjs). Same logic as api/rems.ts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleRems, remsHeaders } from '../api/rems'

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const result = req.method === 'GET' ? await handleRems() : { status: 405, body: { error: 'method_not_allowed' } }
  res.statusCode = result.status
  for (const [k, v] of Object.entries(remsHeaders(result.status))) res.setHeader(k, v)
  res.end(JSON.stringify(result.body))
}
