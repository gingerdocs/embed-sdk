# Embed playground

A local sandbox for `@gingerdocs/embed`. Mint a session with any combination of options, watch it
mount, and see every event the SDK hands your code — plus the exact snippet you would have written.

It imports the **real built SDK** from `packages/embed/dist`, not a copy, so what you feel here is
what an integrator gets from npm.

```
┌──────────────┐  POST /mint          ┌──────────────┐  POST /v1/embed_sessions  ┌───────────┐
│  this page   │ ───────────────────► │ server.mjs   │ ────────────────────────► │ GingerDocs│
│  (no key)    │ ◄─────────────────── │ (holds key)  │ ◄──────────────────────── │    API    │
└──────────────┘   { id, url, ... }   └──────────────┘        session            └───────────┘
       │
       └── mount('#embed', { url, sessionId })  →  <iframe src="…/embed#token=…">
```

The split is the point. A playground that put the secret key in the page would be half the code and
would teach the one thing we most need people not to do.

---

## Setup

**1. Run the app.** The backend on `:8000` and the frontend on `:5173`, as usual.

**2. Get a test secret key.** Settings → Developer → API keys → Create → *Secret*, *Test*. Copy it
now; it is shown once.

**3. Register the playground's origin.** Settings → Developer → **Embed & domains**, test
environment, add:

```
http://localhost:4600
```

Skipping this is the most common way to get a mint that succeeds and a frame that refuses to open —
the origin check is enforced when the iframe loads, not when the session is minted.

**4. Start it.**

```bash
cd playground
GINGERDOCS_SECRET_KEY=gd_sk_test_YOUR_KEY node server.mjs
```

Then open <http://localhost:4600>.

### Options

| Variable | Default | |
|---|---|---|
| `GINGERDOCS_SECRET_KEY` | — | **Required.** A *test* secret key. |
| `GINGERDOCS_API` | `http://localhost:8000` | Where the API lives. |
| `PORT` | `4600` | |
| `PLAYGROUND_ORIGIN` | `http://localhost:$PORT` | Sent as `host_origin`. Must match what you registered. |

Node 18+ (it uses the built-in `fetch`). No dependencies, no build step.

---

## What to try

**`workspace` + `minimal`** — the fullest thing to look at. Needs an `external_user_id` for a user
you created with `POST /v1/users`, and at least one template. This is the flow where somebody in
your product picks a template, fills it in, names a signer and sends it, without you writing any of
that UI.

**`workspace` + `advanced`** — upload a PDF, drag fields onto it, save it as a template. Then switch
to `minimal` **as a different user** and watch that template appear in their list. That round trip
is the whole reason advanced mode exists.

**`workspace` + `read_only`** — needs a preselected document id. Try `allow_download` on and off; it
only takes effect once the document is COMPLETED, which is worth seeing rather than reading.

**`signing`** — needs the id of a document that has been SENT. This is the customer-facing one: your
client signs inside your page and never sees GingerDocs branding.

**The two parties.** Fill in `sender.*` and `recipient.*` and mint a `minimal` session: the embed's
third step opens with both already answered. Then tick `recipient.locked` and mint again — the same
fields render read-only. The lock is not a rendering trick: the frame is only where you find out,
and a write carrying a different value is refused `422 EMBED_PRESET_LOCKED` against the offending
key. Leave `recipient.locale` empty while locking the rest and watch the language control stay live,
which is the rule that a key you never set is never locked.

Leave `sender.*` empty and the document is from the workspace user this session acts as — which is
what every API document has always been from, now visible in the form and on the signing invitation
rather than derived silently.

**Then break it on purpose.** Change `PLAYGROUND_ORIGIN` to something you have not registered and
mint again. The mint is refused with a machine code. That refusal is the security model working, and
it is worth seeing once so you recognise it in a support ticket.

---

## Things worth noticing while you play

- **The page never sees your secret key.** Look at the Network tab: the only thing that crosses is a
  session URL that expires.
- **`host_origin` is set by the server, never by the page.** `server.mjs` hard-codes it. If the
  browser could choose it, the whole origin check would be decorative.
- **Events are convenience, not truth.** They come from a browser, so anything that matters —
  "this is signed", "charge the customer" — must be confirmed by the webhook or by
  `GET /v1/documents/{id}`. The event log labels which events came from the frame and which are the
  playground talking to itself.
- **"Reload with a fresh session"** is the documented answer to `session_expired`: mint again
  server-side, then `instance.reload(url, { sessionId })` with the new response's `url` and `id`.
  The frame is reused; only the session changes. The id matters here because the playground mounts
  with `sessionId`: a reload never keeps the old pin, and without the new id the SDK pins to the
  first session the new frame announces.

---

## Feedback

The point of this is to find what feels wrong before an integrator does. Worth paying attention to:

- How long from opening the page to a mounted embed?
- Does any option need the docs open to understand?
- Do the error messages tell you what to fix, or only that something broke?
- Is the snippet in section 4 something you would paste, or something you would rewrite?
