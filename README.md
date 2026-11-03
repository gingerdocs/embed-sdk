# @gingerdocs/embed

[![npm](https://img.shields.io/npm/v/%40gingerdocs%2Fembed?label=npm)](https://www.npmjs.com/package/@gingerdocs/embed) [![CI](https://github.com/gingerdocs/embed-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/gingerdocs/embed-sdk/actions/workflows/ci.yml) [![licence](https://img.shields.io/npm/l/%40gingerdocs%2Fembed)](https://github.com/gingerdocs/embed-sdk/blob/main/LICENSE)

Put the GingerDocs signing experience inside your own page.

Framework-free, under 1.5 KB gzipped, no dependencies. A React wrapper lives in
[`@gingerdocs/react`](https://github.com/gingerdocs/embed-react-sdk).

```bash
npm install @gingerdocs/embed
```

---

## ⚠️ Read this first: webhooks are the source of truth

**The events this SDK emits are UX signals. They are not a record of what
happened.**

A `completed` event means the signer's browser managed to tell your page so. A
closed laptop lid, a crashed tab, an aggressive extension or a dropped network
withholds it — silently, with no error anywhere. If your fulfilment runs on a
browser event, some fraction of your customers will sign a document and never
get what they paid for, and nothing in your logs will say why.

Provision on the **`document.completed` webhook**. Use these events to hide a
spinner, advance a wizard, and show a confirmation. Never to decide that
something is done.

---

## Quick start

Sessions are minted **server-side**, with your secret key. The token in the
returned URL can sign a document; it must never be minted from a browser.

```js
// Your server
const res = await fetch('https://api.gingerdocs.com/api/v1/embed_sessions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.GINGERDOCS_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    kind: 'signing',
    document_id: documentId,
    host_origin: 'https://app.yourproduct.com', // must be registered — see below
  }),
})

const { id, url } = await res.json()
// Send `id` and `url` to your frontend.
```

```js
// Your page
import { mount } from '@gingerdocs/embed'

// `url` and `id` from the same mint response.
const embed = mount('#signing', { url, sessionId: id })

embed.on('completed', ({ payload }) => {
  showConfirmation()          // …and let your webhook do the real work.
})

embed.on('session_expired', async () => {
  const fresh = await refetchSession()   // your server mints a new one
  embed.reload(fresh.url, { sessionId: fresh.id })
})
```

**Pass `url` verbatim.** Its fragment carries the session credential and its
query carries the value our edge uses to decide who is allowed to frame the
page. Rebuilding the string by hand drops one or both.

### Register your domain first

`host_origin` must exactly match a domain registered under **Settings →
Developer** for that key's environment — an origin (`scheme://host[:port]`),
with no path. An unregistered one is refused at mint with
`EMBED_ORIGIN_NOT_REGISTERED`.

In the **test** environment `http://localhost` on any port is allowed
implicitly, so you do not have to register your dev machine.

---

## API

### `mount(element, options) → instance`

`element` is a DOM element or a CSS selector.

| Option | Type | Notes |
| --- | --- | --- |
| `url` | `string` | **Required.** From the mint response, verbatim. Must be absolute. |
| `sessionId` | `string` | The `id` from the same response. Optional — see below, and give `reload()` the new one. |
| `locale` | `string` | The language the frame opens in, overriding the `locale` your server minted the session with. Only a tag's language counts (`ja-JP` opens in `ja`), and one the frame does not offer is ignored. See below for what outranks it. |
| `title` | `string` | `title` on the iframe. Screen readers announce it. Default `'GingerDocs'`. |
| `style` | `Partial<CSSStyleDeclaration>` | Inline styles for the iframe, camelCase keys, merged over the default `{ border: '0', width: '100%', height: '100%' }`. |
| `expand` | `'modal' \| 'none'` | What happens when the user presses **Expand** inside the frame. Default `'modal'`. See below. |

**Pass `sessionId` when you have it.** Without it the SDK pins to whichever
session the frame announces first, which is correct but trusts the frame's first
word; with it, the pin comes from your own server before anything is rendered.
It matters when you mount two frames on one page — two signers side by side —
because they share an origin, so the origin check alone cannot tell them apart.

**Give `reload()` the new id too.** A reload moves the mount to another
session, so the old pin never carries over: `reload(url, { sessionId })` pins
the new session's `id` before its frame says anything, and a bare `reload(url)`
pins to whichever session the new frame announces first.

**Which language wins.** Your `locale` outranks the session's, from the first
screen on — including a refusal shown before the session opens. On a signing
session the signer outranks you both: a language they pick from the frame's own
menu sticks to that signing link on that device. With no `locale` from you and
none on the session, a signing session opens in the document owner's language,
and a workspace session in the one the frame last used in that browser, else the
browser's own — English when that is not one the frame offers.

`mount()` throws synchronously when the selector matches nothing or `url` is
not absolute.

### Expand

A user in a narrow frame — a 400 px sidebar, a phone — can press **Expand** inside the editor and
get your whole viewport back; **Collapse** returns it. On `'modal'` (the default) the SDK does this
for you:

- it pins **this same iframe** with `position: fixed; inset: 0; z-index: 2147483000`,
- it sets `overflow: hidden` on `<body>` so your page stops scrolling behind it,
- and on `collapsed` — and on `reload()` and `unmount()` — it restores your iframe's `style`
  attribute byte for byte and gives your scroll back.

**The element is never moved in the DOM.** Re-parenting an iframe reloads it, and a reload here
would re-exchange the session and lose whatever the user had not yet submitted — for a cosmetic
gesture.

Pass `expand: 'none'` when:

- your iframe sits inside an ancestor with a `transform`, a `filter`, `will-change` or `contain` —
  those make that ancestor the containing block for `position: fixed`, so the "modal" would be
  pinned inside your sidebar; or
- you would rather not offer it at all.

The frame is told either way, and on `'none'` it **hides the control** rather than offering a
button that does nothing — so on `'none'` there is no Expand and no `expanded` / `collapsed`.
To present it your own way, build the iframe yourself and implement the host half of the
protocol (see [Rolling your own iframe](#rolling-your-own-iframe)). Both events still reach your listeners on `'modal'`, so you can hide
your own header for the duration.

```js
const embed = mount('#signing', { url, sessionId })

embed.on('expanded',  () => header.hidden = true)
embed.on('collapsed', () => header.hidden = false)
```

### How much room the frame needs

**Minimum 360 × 520 px; comfortable from 900 × 700.** Under 768 px wide it switches to the compact
layout — the same one a phone gets, with a bottom bar instead of a sidebar — which is a supported
shape rather than a fallback. At any width the document page opens fitted to the room it has, and
re-fits when that room changes, Expand included. Height is the one nothing can rescue: a document
page has an aspect ratio, and under ~500 px the user reads it through a letterbox. That is what
Expand is for.

### `instance.on(type, listener) → unsubscribe`

Returns its own unsubscribe function, so you can ignore `off()` entirely.

### `instance.off(type, listener)`

### `instance.reload(url, options?)`

Points the frame at a new session. This is the documented answer to
`session_expired`: mint a fresh session on your server, then
`reload(url, { sessionId: id })` with its URL and id. It replaces the iframe —
`instance.frame` becomes a new element, and anything the user had not submitted
is lost. The old pin is always dropped: `options.sessionId` pins the new session
from the start, and without it the mount pins to whichever session the new frame
announces first.

### `instance.unmount()`

Removes the iframe and stops listening. Safe to call twice.

### `instance.frame`

The `HTMLIFrameElement`, or `null` once unmounted.

---

## Events

| Event | Payload | Meaning |
| --- | --- | --- |
| `ready` | `{ sessionId, kind, environment }` | The frame is up and authenticated. Hide your loader. |
| `viewed` | `{ documentId, recipientId }` | The document is on screen. A workspace session sends `{ documentId }` only, on the first load of a document. |
| `signed` | `{ recipientId }` | This signer is done. |
| `completed` | `{ documentId }` | The document is legally complete — **not** that the PDF is downloadable. That is the `document.download_ready` webhook. |
| `declined` | `{ reason }` | The signer declined. |
| `session_expiring` | `{ secondsRemaining }` | Five minutes left (`secondsRemaining` is always `300`, and fires at once if the frame opens with less left). Mint a replacement now. |
| `session_expired` | `{}` | Mint a new session and `reload(url, { sessionId })` onto it. |
| `error` | `{ code }` | A machine code: any API error code the frame met, or the frame's own `INVALID_LINK`, `ACTION_FAILED` or `DOWNLOAD_FAILED`. Branch on `code`, never on any message beside it — messages are translated. |
| `document_created` | `{ documentId }` | *Workspace.* Your user made a document. |
| `document_sent` | `{ documentId }` | *Workspace.* Your user sent it for signature. |
| `document_deleted` | `{ documentId }` | *Workspace.* Your user deleted a draft, or replaced a voided agreement (which deletes it). Your record of `documentId` is stale — drop it. A replacement's `document_created` arrives first, so follow that one. |
| `template_created` | `{ templateId }` | *Workspace, `advanced`.* Your user saved a template. |
| `expanded` | `{}` | The frame asked for your viewport. On `expand: 'modal'` the SDK has **already** pinned it by the time you see this. |
| `collapsed` | `{}` | …and asked for it back. The SDK has already restored your page. |

A frame that **fails to open at all** — a spent token, a wrong origin — emits
nothing, because there is no session to address the message to. If you gate your
UI on `ready`, give it a timeout.

---

## Rolling your own iframe

You do not have to use this package, but if you build the iframe yourself, three
attributes are not optional:

```html
<iframe
  src="<the url from the mint, verbatim>"
  referrerpolicy="strict-origin"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
></iframe>
```

- **`referrerpolicy="strict-origin"`** — Firefox has no
  `location.ancestorOrigins`, so the referrer is the only way the frame can tell
  our server which page is showing it. Without this the session exchange fails
  closed, **in Firefox only**, which is the kind of bug that reaches production.
- **`allow-downloads` and `allow-popups`** — the signed PDF is the one thing a
  signer does that leaves the frame. Without them the download button silently
  does nothing at the end of a ceremony.
- **`allow-scripts allow-same-origin`** — the frame is our origin inside the
  sandbox, not yours; the pair grants your page nothing.
- **No `allow-modals`**, and none is needed: every confirmation (void, delete a
  draft) is rendered inside the frame, never as a native dialog over your page.

And verify **both** `event.origin` and `sessionId` on every message you accept.
Anything on the host page can post into your `message` handler.

You will also lose **Expand**, unless you implement its half of the protocol. The frame shows the
control only once the host has announced it can present a modal, so send this to
`iframe.contentWindow` once, on the iframe's `load` event, addressed to the frame's origin and
never to `'*'`:

```js
iframe.addEventListener('load', () => {
  iframe.contentWindow.postMessage(
    { source: 'gingerdocs-host', type: 'capabilities', payload: { expand: true } },
    new URL(url).origin,
  )
}, { once: true })
```

Then handle `expanded` / `collapsed` yourself. Announce `{ expand: false }`, or nothing at all, and
the frame simply never offers the control — which is the right default, because a button that does
nothing is worse than no button.

---

## Things worth knowing

- **Signing URLs and session URLs are bearer secrets.** Treat them like
  passwords: do not log them, do not put them in analytics, do not email them.
- **We may still email the signer a one-time code.** Under `standard` signer
  verification an expired access proof falls back to an OTP wall, which sends
  mail. Set `signer_verification: 'none'` at send time if you need us to send
  nothing at all — the Certificate of Completion then states plainly that no
  independent verification was performed.
- **Test mode signs nothing binding.** Test documents carry a "TEST — NOT LEGALLY
  BINDING" watermark and the embed shows a banner. No mail leaves the building.
- **The Integrator Terms make you the verifying party** for embedded signing.
  Minting a signing session is the act of vouching for that person's identity,
  and the Certificate of Completion says so by name.
- **The frame can take your colour.** Add `theme: { primary_color: '#0F766E' }`
  to the mint body and its buttons, links, selection and focus rings follow it,
  with the text on them kept readable whatever colour you choose. The test-mode
  banner, status colours and the signing page's Submit and Reject buttons keep
  ours.

---

## Fonts: one third-party request

**The frame loads fonts from `fonts.googleapis.com`.** Your users choose a typeface for a signature
or a text field from the same catalogue our own app offers, in every script we support; a
self-hosted subset would mean a Japanese or Korean user picking a font and watching it not render.

The frame sends `Referrer-Policy: no-referrer`, so neither your origin nor ours appears in those
logs and the fact that a document is open is not disclosed. What remains is a request to Google's
CDN **from your page, under your privacy policy** — so it is yours to disclose, and we would rather
state it here than decide it for you.

---

## Browser support

Any browser with `postMessage` and `URL` — in practice everything from 2018
onwards. Chromium and Safari use `location.ancestorOrigins`; Firefox uses the
referrer, which is why the referrer policy above matters.
