#!/usr/bin/env node
//
// The playground's tiny backend.
//
// It exists to be the one thing an integrator's server does: hold the secret
// key and mint sessions with it. Everything else — the page, the SDK, the
// iframe — runs in the browser and never sees the key.
//
// That shape is the point. A playground that put the key in the page would be
// simpler to write and would teach the one thing we most need people not to do,
// so this is ~120 lines of Node instead. It is also the shortest honest answer
// to "how do I integrate this": the whole server side is `POST
// /v1/embed_sessions` with a bearer token.
//
// No dependencies, no build step. `node server.mjs`.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Where the *real* built SDK lives, served at `/sdk/`.
 *
 * An explicit route rather than a copy into this folder, and rather than
 * loosening the static handler's "never climb out of here" check. The point of
 * the playground is that it exercises the same file npm ships — a copy would
 * drift the first time somebody edited the package and forgot to re-copy.
 */
const SDK = join(HERE, '..', 'packages', 'embed', 'dist')

const PORT    = Number(process.env.PORT || 4600)
const API     = (process.env.GINGERDOCS_API || 'http://localhost:8000').replace(/\/$/, '')
const KEY     = (process.env.GINGERDOCS_SECRET_KEY || '').trim()
const ORIGIN  = process.env.PLAYGROUND_ORIGIN || `http://localhost:${PORT}`

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * A key that cannot go in a header is caught here, not 40 lines later inside undici.
 *
 * Header values are ByteStrings, so `fetch` throws on any codepoint above 255.
 * This README used to say `GINGERDOCS_SECRET_KEY=gd_sk_test_… node server.mjs`,
 * and pasting that line verbatim put U+2026 at index 18 of `Bearer gd_sk_test_…`
 * — a 500 whose message talked about ByteString conversion and mentioned neither
 * the key nor the paste. The placeholder is ASCII now; this is the backstop, and
 * it names the character so the next one is a five-second fix.
 *
 * Only the impossible is fatal. A key of the wrong *shape* still gets sent: the
 * API is the authority on whether a key is good, and its `INVALID_API_KEY` says
 * so far better than a guess made here.
 */
function checkKey(key) {
  for (const ch of key) {
    const cp = ch.codePointAt(0)
    if (cp > 255) {
      const u = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
      console.error(`\n  \x1b[31mGINGERDOCS_SECRET_KEY cannot be used.\x1b[0m`)
      console.error(`  It contains ${JSON.stringify(ch)} (${u}), which is not allowed in an HTTP header.`)
      console.error(`  If you pasted the example key, replace gd_sk_test_YOUR_KEY with a real one:`)
      console.error(`  Settings → Developer → API keys → Create → Secret, Test.\n`)
      process.exit(1)
    }
  }

  if (key !== '' && !/^gd_sk_(test|live)_/.test(key)) {
    console.warn(`\n  \x1b[33mThat does not look like a secret key\x1b[0m (expected a gd_sk_test_ prefix).`)
    console.warn(`  Sending it anyway — the API will have the final word.\n`)
  }
}

/** Read a JSON request body, with a small cap — this is a local toy. */
async function readJson(req) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('Body too large.')
    chunks.push(chunk)
  }

  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * `POST /mint` — the only interesting route.
 *
 * Forwards the browser's chosen options to `POST /v1/embed_sessions` with the
 * secret key attached, and returns the mint response verbatim.
 *
 * **`host_origin` is set here, not taken from the request.** It is the value
 * that decides which page may frame the session, and letting the browser choose
 * it would hand away the entire origin check. A real integrator's server should
 * do exactly this: hard-code its own origin, or derive it from its own config —
 * never from the caller.
 */
async function mint(req, res) {
  if (KEY === '') {
    return json(res, 500, {
      error: 'GINGERDOCS_SECRET_KEY is not set.',
      hint: 'Create a test secret key in Settings → Developer → API keys, then restart with '
        + 'GINGERDOCS_SECRET_KEY=gd_sk_test_YOUR_KEY node server.mjs',
    })
  }

  let body
  try {
    body = await readJson(req)
  } catch (e) {
    return json(res, 400, { error: String(e.message) })
  }

  // Whitelisted, so a stray key in the page cannot become part of the mint.
  const allowed = ['kind', 'mode', 'locale', 'document_id', 'user_id', 'external_user_id',
    'preselect', 'allow_download', 'recipient', 'sender']

  const payload = { host_origin: ORIGIN }
  for (const k of allowed) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') payload[k] = body[k]
  }

  const upstream = await fetch(`${API}/api/v1/embed_sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await upstream.text()

  // Passed through unchanged, status included. When a mint is refused, the
  // machine `code` in the body is the useful part and rewrapping it would hide
  // exactly what an integrator needs to see.
  res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** `GET /config` — what the page needs to know about its own server. */
function config(res) {
  json(res, 200, { api: API, origin: ORIGIN, keyConfigured: KEY !== '' })
}

/** `GET /sdk/*` — the built package, straight out of packages/embed/dist. */
async function serveSdk(req, res, pathname) {
  const name = normalize(pathname.slice('/sdk/'.length))
  const file = join(SDK, name)

  if (!file.startsWith(SDK)) return json(res, 403, { error: 'Nope.' })

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('The SDK is not built. Run: cd packages/embed && npm run build')
  }
}

async function serveStatic(req, res) {
  const url  = new URL(req.url, `http://localhost:${PORT}`)
  const rel  = url.pathname === '/' ? '/index.html' : url.pathname
  // normalize + prefix check: a path is not allowed to climb out of here.
  const file = join(HERE, normalize(rel))

  if (!file.startsWith(HERE)) return json(res, 403, { error: 'Nope.' })

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}

checkKey(KEY)

createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/mint')  return await mint(req, res)
    if (req.method === 'GET'  && req.url === '/config') return config(res)
    if (req.method === 'GET' && req.url.startsWith('/sdk/')) {
      return await serveSdk(req, res, new URL(req.url, `http://localhost:${PORT}`).pathname)
    }
    if (req.method === 'GET') return await serveStatic(req, res)

    json(res, 405, { error: 'Method not allowed.' })
  } catch (e) {
    json(res, 500, { error: String(e?.message ?? e) })
  }
}).listen(PORT, () => {
  console.log(`\n  GingerDocs embed playground`)
  console.log(`  ${ORIGIN}`)
  console.log(`  API      ${API}`)
  console.log(`  Key      ${KEY === '' ? '\x1b[31mnot set — see README\x1b[0m' : KEY.slice(0, 12) + '…'}`)
  console.log(`\n  Register ${ORIGIN} in Settings → Developer → Embed & domains (test).\n`)
})
