// Build a Vercel "Build Output API v3" bundle in .vercel/output, so the site can be deployed with
// `vercel deploy --prebuilt` without Vercel's local builders (which need symlink rights on Windows).
//   npm run build && node scripts/build-vercel-output.mjs && npx vercel deploy --prebuilt
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const out = join(root, '.vercel', 'output')
if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('Run `npm run build` first (dist/ is missing).')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// static site
cpSync(join(root, 'dist'), join(out, 'static'), { recursive: true })

// serverless functions: /api/assistant (Gemini) and /api/rems (Mars weather relay)
for (const [name, entry] of [['assistant', 'vercel-function.ts'], ['rems', 'vercel-rems.ts']]) {
  const fn = join(out, 'functions', 'api', `${name}.func`)
  mkdirSync(fn, { recursive: true })
  await build({
    entryPoints: [join(root, 'scripts', entry)],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: join(fn, 'index.mjs'),
    logLevel: 'warning',
  })
  writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2))
}

// routes: API first, then static files, then the SPA entry for anything else
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/api/assistant/?$', dest: '/api/assistant' },
        { src: '^/api/rems/?$', dest: '/api/rems' },
        { src: '^/(?!api/).*', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
)
console.log('Vercel build output written to .vercel/output')
