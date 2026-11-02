// The playground's browser half.
//
// `/sdk/` is served straight out of packages/embed/dist — the real built file,
// not a copy — so what you feel here is exactly what an integrator gets from
// npm. Rebuild the package (`npm run build` in packages/embed) and reload to
// see a change.

import { mount } from '/sdk/gingerdocs-embed.js'

const $ = (id) => document.getElementById(id)

// Above `syncFields()` rather than beside `payload()`, which is where it reads
// best: that function runs once at module load, reaches this through
// `renderSnippet()`, and a `const` declared below it is still in its temporal
// dead zone — the whole page threw on boot.
const val = (id) => $(id).value.trim()

let instance = null
let session  = null
let config   = { api: '', origin: '', keyConfigured: false }

// ── Boot ─────────────────────────────────────────────────────────────────────

fetch('/config').then(r => r.json()).then(c => {
  config = c
  $('status').innerHTML = c.keyConfigured
    ? `<span class="ok">key loaded</span> <code>${c.api}</code>`
    : `<span class="bad">no secret key</span> — see README`
  renderSnippet()
})

// ── Form wiring ──────────────────────────────────────────────────────────────

/** What each mode does with the two party presets — stated, rather than left to be discovered. */
const PARTY_NOTE = {
  minimal:   'minimal reads both: its third step names who it is from and who signs.',
  advanced:  'advanced reads the recipient on its upload form. The sender has no form there — it is '
             + 'taken from the preset, or from the workspace user.',
  read_only: 'read_only has no form at all, so neither preset renders. The mint accepts them; '
             + 'nothing in the frame will show them.',
}

function syncFields() {
  const signing = $('kind').value === 'signing'
  const mode    = $('mode').value

  $('signing-fields').hidden   = !signing
  $('workspace-fields').hidden = signing

  $('preselect-id-row').hidden = $('preselect_type').value === ''
  $('party-note').textContent  = PARTY_NOTE[mode] ?? ''

  $('user_value').placeholder = $('user_ref').value === 'user_id'
    ? '7b3f…  (uuid from POST /v1/users)'
    : 'your-app-user-42'

  renderSnippet()
}

;[
  'kind', 'mode', 'locale', 'document_id', 'allow_download',
  'user_ref', 'user_value', 'preselect_type', 'preselect_id',
  'sender_name', 'sender_email', 'sender_locked',
  'recipient_name', 'recipient_email', 'recipient_locale', 'recipient_locked',
].forEach(id => {
  $(id).addEventListener('input', syncFields)
  $(id).addEventListener('change', syncFields)
})

syncFields()

// ── What we'd send ───────────────────────────────────────────────────────────

/**
 * One party preset, or undefined when the boxes are empty.
 *
 * `locked` rides inside the object rather than beside it because it qualifies
 * *that* preset — locking the signer while leaving the sender free is the
 * ordinary case. It is only sent when something is pinned: `{ locked: true }`
 * on its own would be a lock on nothing, and the mint's `required_with` would
 * (rightly) ask for a name.
 */
function party(prefix, keys) {
  const preset = {}

  for (const key of keys) {
    const v = val(`${prefix}_${key}`)
    if (v) preset[key] = v
  }

  if (Object.keys(preset).length === 0) return undefined
  if ($(`${prefix}_locked`).checked) preset.locked = true

  return preset
}

/**
 * The mint payload, minus `host_origin` — the server sets that itself.
 *
 * Worth noticing while you play: there is no way for this page to choose which
 * origin the session may be framed on. That is deliberate, and it is the check
 * that stops a leaked session URL opening on someone else's site.
 *
 * Every other parameter `POST /v1/embed_sessions` takes has a control above.
 * Empty ones are omitted rather than sent blank — an absent key and an empty
 * string are different answers on this surface, and the snippet below is meant
 * to be copied.
 */
function payload() {
  const kind = $('kind').value
  const body = { kind }

  const locale = $('locale').value
  if (locale) body.locale = locale

  if (kind === 'signing') {
    if (val('document_id')) body.document_id = val('document_id')
    return body
  }

  body.mode = $('mode').value

  // One of the two spellings of the same person, never both — the mint refuses
  // a body carrying both rather than picking a winner.
  if (val('user_value')) body[$('user_ref').value] = val('user_value')

  if ($('allow_download').checked) body.allow_download = true

  const preselect = $('preselect_type').value
  if (preselect && val('preselect_id')) body.preselect = { [preselect]: val('preselect_id') }

  const sender    = party('sender', ['name', 'email'])
  const recipient = party('recipient', ['name', 'email', 'locale'])

  if (sender !== undefined)    body.sender = sender
  if (recipient !== undefined) body.recipient = recipient

  return body
}

// ── Mint + mount ─────────────────────────────────────────────────────────────

async function mintSession() {
  const res  = await fetch('/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload()),
  })
  const body = await res.json()

  if (!res.ok) {
    // The machine `code` is the useful half — it is what an integrator branches
    // on, and what they can search their own logs for.
    const code = body.code ? ` [${body.code}]` : ''

    // …and the per-field codes, because a 422 that says "see `errors`" without
    // showing them makes you open a second tab. Found by using this page: the
    // message was correct and still left you nowhere to go.
    const fields = body.errors
      ? '\n' + Object.entries(body.errors)
          .map(([field, list]) => `  ${field}: ${(list ?? []).map(e => e.code ?? e).join(', ')}`)
          .join('\n')
      : ''

    throw new Error(`${res.status}${code} ${body.message ?? body.error ?? ''}`.trim() + fields)
  }

  return body
}

async function mintAndMount() {
  showError(null)
  $('mint').disabled = true

  try {
    session = await mintSession()

    $('session-json').textContent = JSON.stringify(session, null, 2)
    $('session-details').hidden = false

    if (!session.url) {
      throw new Error('The mint returned no url — nothing to mount.')
    }

    unmountCurrent()

    const host = $('embed')
    host.innerHTML = ''

    instance = mount(host, {
      url: session.url,
      // Passing it is the stronger of the two pinnings: without it the SDK
      // trusts whichever session the frame announces first.
      sessionId: session.id,
      title: 'GingerDocs embed playground',
      // `modal` is the default; `none` is here so you can watch the Expand
      // control disappear from inside the frame when the host opts out.
      expand: $('expand').value,
    })

    for (const type of EVENTS) {
      instance.on(type, (event) => logEvent(event))
    }

    logLocal('mounted', `${session.kind}${session.mode ? ' · ' + session.mode : ''}`)
  } catch (e) {
    showError(String(e.message ?? e))
  } finally {
    $('mint').disabled = false
  }
}

const EVENTS = [
  'ready', 'viewed', 'signed', 'completed', 'declined',
  'session_expiring', 'session_expired', 'error',
  'document_created', 'document_sent', 'document_deleted', 'template_created',
  // The SDK pins and unpins the iframe on these two *before* handing them on,
  // so a host page that has chrome of its own can hide it here.
  'expanded', 'collapsed',
]

function unmountCurrent() {
  if (instance !== null) {
    // `unmount()`, not `destroy()` — the SDK's own name. Worth stating because
    // `destroy()` is what everyone types first, and the playground did too.
    instance.unmount()
    instance = null
  }
}

/**
 * The host's own box, which is the thing Expand is an answer to.
 *
 * Applied to the container rather than to the iframe, because that is where an
 * integrator's layout actually decides it — and it leaves the SDK's inline
 * style on the iframe untouched, which is what it restores a collapse to.
 */
function applyFrameWidth() {
  const width = $('frame-width').value
  $('embed').style.width = width
  $('embed').style.marginInline = width === '' ? '' : 'auto'
}

$('frame-width').addEventListener('change', applyFrameWidth)
$('expand').addEventListener('change', renderSnippet)
applyFrameWidth()

$('mint').addEventListener('click', () => { void mintAndMount() })

$('unmount').addEventListener('click', () => {
  unmountCurrent()
  $('embed').innerHTML = '<p class="placeholder">Unmounted.</p>'
  logLocal('unmounted', 'instance.unmount() — listeners detached, frame removed')
})

/**
 * The documented answer to `session_expired`: mint a fresh session server-side,
 * then `reload(url, { sessionId })`. The frame is reused; only the session
 * changes — and the new `id` is passed because the mount above pinned the old
 * one. Before E10-27 `reload(url)` kept that old pin, and every event from the
 * reloaded frame vanished from the log below.
 */
$('reload').addEventListener('click', async () => {
  if (instance === null) return showError('Nothing mounted yet.')

  try {
    const next = await mintSession()
    instance.reload(next.url, { sessionId: next.id })
    session = next
    $('session-json').textContent = JSON.stringify(next, null, 2)
    logLocal('reloaded', 'instance.reload(url, { sessionId }) with a freshly minted session')
  } catch (e) {
    showError(String(e.message ?? e))
  }
})

// ── Event log ────────────────────────────────────────────────────────────────

function logEvent(event) {
  add(event.type, JSON.stringify(event.payload ?? {}), 'from the frame')
}

function logLocal(name, detail) {
  add(name, detail, 'local')
}

function add(name, detail, source) {
  const li = document.createElement('li')
  const time = new Date().toLocaleTimeString()

  li.innerHTML = `<span class="t">${time}</span>`
    + `<span class="n ${source === 'local' ? 'local' : ''}">${escapeHtml(name)}</span>`
    + `<span class="d">${escapeHtml(detail)}</span>`

  $('events').prepend(li)
}

$('clear-events').addEventListener('click', () => { $('events').innerHTML = '' })

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

function showError(message) {
  const el = $('error')
  el.hidden = message === null
  el.textContent = message ?? ''
}

// ── The snippet ──────────────────────────────────────────────────────────────

/** Only shown when it is not the default — the snippet is meant to be copied. */
function expandLine() {
  return $('expand').value === 'none'
    ? `\n  expand: 'none',         // don't let the frame take over this page`
    : ''
}

function renderSnippet() {
  const body = JSON.stringify({ ...payload(), host_origin: config.origin || 'https://app.yoursite.com' }, null, 2)
    .split('\n').map((l, i) => (i === 0 ? l : '    ' + l)).join('\n')

  $('snippet').textContent = `// ── your server ─────────────────────────────────────────
const res = await fetch('${config.api || 'https://api.gingerdocs.com'}/api/v1/embed_sessions', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${process.env.GINGERDOCS_SECRET_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${body}),
})

const session = await res.json()   // { id, url, expires_at, ... }

// ── your browser ────────────────────────────────────────────
import { mount } from '@gingerdocs/embed'

const embed = mount('#signing', {
  url: session.url,          // verbatim — the fragment carries a credential
  sessionId: session.id,${expandLine()}
})

embed.on('completed', (event) => {
  // event: { type, sessionId, payload }
  // Confirm with the webhook before you act on it.
})`
}
