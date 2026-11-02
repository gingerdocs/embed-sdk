/**
 * `@gingerdocs/embed` — the GingerDocs signing experience, in your page.
 *
 * Framework-free and deliberately small. Everything it does is one of four
 * things: build an iframe with the right attributes, listen for messages that
 * are genuinely ours, hand them to you, and take it all down again.
 *
 * **Events from this SDK are UX signals, not a record.** Webhooks are the source
 * of truth (design §10.3). A `completed` event means the signer's browser told
 * us so; a closed laptop lid, a crashed tab or a network drop between the frame
 * and your page all withhold it silently. Provision on `document.completed` from
 * your webhook endpoint and use these to move a spinner.
 */

/** The catalog the embed emits (design §10.3). Frozen — the frame matches it. */
export type GingerDocsEventName =
  | 'ready'
  | 'viewed'
  | 'signed'
  | 'completed'
  | 'declined'
  // No `cancelled`. §10.3 listed one from v3 and nothing ever emitted it: the
  // frame has no way to back out of a ceremony, because backing out happens in
  // your own UI — your close button, your navigation — which your page sees
  // without us. Removed rather than kept as a name that never arrives (E10-27).
  | 'session_expiring'
  | 'session_expired'
  | 'error'
  // §10.3's workspace events, added in D5 when `minimal` mode gave a host
  // something to react to: their user just made a document, and just sent it.
  | 'document_created'
  | 'document_sent'
  // The frame deleted a document — a draft, or a voided agreement it replaced
  // — and your record of `documentId` is stale. When it follows a replacement,
  // `document_created` for the new document has already arrived.
  | 'document_deleted'
  // `advanced` mode saved a template. Emitted from E3; the union is types-only,
  // so a host on an older SDK still *receives* it — what it gains here is the
  // name in autocomplete and in `on()`'s parameter type.
  | 'template_created'
  // The one pair this SDK *acts* on rather than only forwarding: the frame asks
  // for the host's viewport, and `expand` below decides whether it gets it. They
  // are delivered to your listeners either way, so a page with a header of its
  // own can hide it for the duration.
  | 'expanded'
  | 'collapsed'

/** The envelope, as it arrives. `payload` shape varies by `type`. */
export interface GingerDocsEvent {
  type: GingerDocsEventName
  sessionId: string
  payload: Record<string, unknown>
}

export type GingerDocsListener = (event: GingerDocsEvent) => void

export interface MountOptions {
  /**
   * The `url` from `POST /v1/embed_sessions`. Pass it **verbatim** — its
   * fragment carries a credential and its query carries the value that lets our
   * edge decide who may frame this page. Rebuilding it by hand drops one or
   * both.
   */
  url: string

  /**
   * Pin the session this mount will accept messages from.
   *
   * Optional, and worth passing when you have it — it is the `id` from the same
   * mint response as `url`. Without it the SDK pins to whatever session the
   * frame announces first, which is correct but one step weaker: it trusts the
   * frame's first word rather than your server's.
   */
  sessionId?: string

  /**
   * The language the frame opens in, overriding the one the session was minted
   * with — for when your page knows better than your server did, such as a
   * language switch made since the mint.
   *
   * A BCP-47 tag, of which only the language counts (`ja-JP` opens in `ja`),
   * and a language the frame does not offer is ignored rather than refused. A
   * signer who picks a language from the frame's own menu keeps their pick: it
   * is their reading, not your page's. Omit it and the mint's `locale` stands.
   */
  locale?: string

  /** `title` on the iframe. Screen readers announce it; give it a real one. */
  title?: string

  /** Inline styles for the iframe. Defaults to filling its container. */
  style?: Partial<CSSStyleDeclaration>

  /**
   * What happens when the user presses **Expand** inside the frame.
   *
   * `'modal'` (the default) pins **this same iframe** to your viewport and locks
   * your page's scroll, restoring both on Collapse — so a 400 px embed in a
   * sidebar can become a full editor without you writing a dialog. The element
   * is never moved in the DOM: relocating an iframe reloads it, and a reload
   * here costs the session its one re-exchange grace.
   *
   * `'none'` opts out, and the frame is told: it does not show the control at
   * all, rather than showing one that does nothing. Choose it when your iframe
   * sits inside an ancestor with a `transform`, a `filter` or `overflow:
   * hidden`, since `position: fixed` resolves against that ancestor rather than
   * the viewport — or when you would rather present the modal yourself, in
   * which case listen for `expanded` / `collapsed` and do it your way.
   */
  expand?: 'modal' | 'none'
}

/** What `reload()` is told about the session it moves to. */
export interface ReloadOptions {
  /**
   * The new session's `id`, from the same mint response as the new `url` — the
   * pin `mount()`'s `sessionId` is, for the session after the move.
   */
  sessionId?: string
}

export interface GingerDocsEmbedInstance {
  /** Subscribe. Returns an unsubscribe function, so you can ignore `off`. */
  on(type: GingerDocsEventName, listener: GingerDocsListener): () => void
  off(type: GingerDocsEventName, listener: GingerDocsListener): void

  /**
   * Point the frame at a new session — the documented response to
   * `session_expired`: mint a fresh session server-side, then
   * `reload(url, { sessionId: id })` with the new response's two values.
   *
   * The old pin never survives the move, whether it came from `mount()`'s
   * `sessionId` or from the first frame's announcement: the new URL is a
   * different session, and holding the old id would drop every message the
   * new frame sends. Pass the new id to pin it from the start, as `mount()`
   * does; omit it and the mount pins to whichever session the new frame
   * announces first.
   */
  reload(url: string, options?: ReloadOptions): void

  /** Remove the iframe and stop listening. Safe to call twice. */
  unmount(): void

  /** The iframe, if you need to measure it. Null once unmounted. */
  readonly frame: HTMLIFrameElement | null
}

/** The marker the frame stamps on every message (design §10.3). */
const MESSAGE_SOURCE = 'gingerdocs-embed'

/** The marker on the one message that travels the other way — host to frame. */
const HOST_SOURCE = 'gingerdocs-host'

/**
 * The modal box.
 *
 * `top/right/bottom/left` rather than the `inset` shorthand they are equivalent
 * to, because these are applied through `Object.assign` onto a
 * `CSSStyleDeclaration`: a property the engine does not implement is silently
 * accepted as a plain JS property and never reaches the style attribute. The
 * longhands have been universal for far longer, and the failure mode of
 * guessing wrong is an iframe pinned at its original position, full-size.
 *
 * The z-index is one below the 32-bit maximum, which is where the convention
 * sits — high enough to clear a host's own overlays, low enough that a host who
 * needs to put something above this still can.
 */
const MODAL: Record<string, string> = {
  position: 'fixed',
  top: '0', right: '0', bottom: '0', left: '0',
  width: '100%', height: '100%',
  zIndex: '2147483000',
  background: 'white',
  border: '0',
  margin: '0',
  maxWidth: 'none', maxHeight: 'none',
}

/**
 * What the frame is allowed to do.
 *
 * `allow-scripts` and `allow-same-origin` together are what let the embed run
 * at all — it is our own origin inside the sandbox, not the host's, so the pair
 * does not hand the host page anything.
 *
 * `allow-popups` and `allow-downloads` are for the one thing a signer does that
 * leaves the frame: fetching the signed PDF. Without them the download silently
 * does nothing, which is the worst possible failure at the end of a ceremony.
 *
 * `allow-forms` because the signing view has real inputs.
 *
 * Deliberately **absent**: `allow-top-navigation`, so nothing inside the frame
 * can move the host's page out from under the user, and
 * `allow-modals`/`allow-pointer-lock`, which the surface has no use for.
 *
 * `allow-modals` staying out is a contract the *frame* honours, not only a flag
 * here: without it the browser silently ignores `alert()`, `confirm()`,
 * `prompt()` and `print()` inside the frame — `confirm()` returns `false` at
 * once — so every confirmation the frame needs (void, delete a draft) is
 * rendered by the frame itself, and the embed entry lints against the native
 * ones. It is not added because a native dialog over somebody else's product
 * reads as ours, and nothing in the frame is allowed to need one.
 */
const SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-downloads',
].join(' ')

/**
 * Mount the embed into `element`.
 *
 * @param element a container, or a CSS selector for one
 */
export function mount(
  element: Element | string,
  options: MountOptions,
): GingerDocsEmbedInstance {
  const container = typeof element === 'string' ? document.querySelector(element) : element

  if (container === null) {
    throw new Error(`[gingerdocs] No element matched ${JSON.stringify(element)}.`)
  }

  const listeners = new Map<GingerDocsEventName, Set<GingerDocsListener>>()

  let frame: HTMLIFrameElement | null = null
  let expectedOrigin = ''
  let pinnedSessionId: string | null = options.sessionId ?? null

  const canExpand = options.expand !== 'none'

  /**
   * The two things expanding overwrites, remembered verbatim.
   *
   * The iframe's whole `style` **attribute** rather than the properties we are
   * about to change, because that is the only restore that cannot be wrong: a
   * host's `style` option, a stylesheet's `!important`, an inline height set by
   * their own resize code — all of it comes back exactly as it was. Non-null is
   * also how we know we are expanded, so there is no second flag to keep in
   * step with it.
   */
  let savedStyle: string | null = null
  let savedBodyOverflow = ''

  function receive(event: MessageEvent): void {
    // Origin first, and by exact string. A host page's own code, its analytics
    // and every other iframe on it post into this same handler; `event.origin`
    // is the one field a sender cannot forge.
    if (event.origin !== expectedOrigin) return

    const data = event.data as Partial<GingerDocsEvent> & { source?: string }

    if (data === null || typeof data !== 'object' || data.source !== MESSAGE_SOURCE) return
    if (typeof data.type !== 'string' || typeof data.sessionId !== 'string') return

    // Two frames on one page is a real workflow — two signers side by side —
    // and they share an origin, so the origin check alone cannot tell them
    // apart. Pin on the first message when the host did not pass an id.
    if (pinnedSessionId === null) {
      pinnedSessionId = data.sessionId
    } else if (data.sessionId !== pinnedSessionId) {
      return
    }

    const detail: GingerDocsEvent = {
      type: data.type as GingerDocsEventName,
      sessionId: data.sessionId,
      payload: (data.payload ?? {}) as Record<string, unknown>,
    }

    // Before the listeners, so a host that hides its own chrome on `expanded`
    // is doing so over a frame that has already taken the viewport.
    if (detail.type === 'expanded') expand()
    if (detail.type === 'collapsed') collapse()

    // A copy, so a listener that throws — or unsubscribes — cannot disturb the
    // set being iterated. One listener's mistake is not the others' problem.
    for (const listener of [...(listeners.get(detail.type) ?? [])]) {
      try {
        listener(detail)
      } catch (error) {
        // Rethrow asynchronously: the host sees a real unhandled error with a
        // usable stack, and the remaining listeners still run.
        setTimeout(() => { throw error })
      }
    }
  }

  /**
   * Tell the frame what we can do for it — the one message that travels host →
   * frame (§10.3, amendment E0-4).
   *
   * Sent **always**, including `{ expand: false }`, rather than withheld on
   * opt-out. Silence already means "no" for every host still on an SDK that
   * predates this message, and saying it deliberately costs one `postMessage`
   * and removes the ambiguity for everyone else.
   *
   * Addressed to `expectedOrigin`, never `'*'`: this is a message about the
   * host's own page, and an iframe that navigated elsewhere must not receive it.
   */
  function announce(target: Window | null): void {
    try {
      target?.postMessage(
        { source: HOST_SOURCE, type: 'capabilities', payload: { expand: canExpand } },
        expectedOrigin,
      )
    } catch {
      // A frame removed between `load` and this line leaves a dead reference.
      // The frame simply shows no Expand control, which is the safe default.
    }
  }

  /** Pin the existing iframe over the host page. No re-parenting — see `expand` above. */
  function expand(): void {
    if (!canExpand || frame === null || savedStyle !== null) return

    savedStyle = frame.getAttribute('style') ?? ''
    savedBodyOverflow = document.body.style.overflow

    Object.assign(frame.style, MODAL)
    document.body.style.overflow = 'hidden'
  }

  /**
   * Put both back.
   *
   * Called on `collapsed`, and again — unconditionally — from `reload()` and
   * `unmount()`. A host whose frame is torn down mid-modal would otherwise be
   * left with a page that cannot scroll and no element left to explain why.
   */
  function collapse(): void {
    if (savedStyle === null) return

    frame?.setAttribute('style', savedStyle)
    document.body.style.overflow = savedBodyOverflow

    savedStyle = null
    savedBodyOverflow = ''
  }

  function build(url: string): void {
    expectedOrigin = originOf(url)

    const iframe = document.createElement('iframe')

    iframe.src = url
    iframe.title = options.title ?? 'GingerDocs'

    // §10.3: this is what restores the framing signal in Firefox, which has no
    // `location.ancestorOrigins`. Without it the frame cannot prove to our
    // server which page is showing it, and the exchange fails closed.
    iframe.setAttribute('referrerpolicy', 'strict-origin')
    iframe.setAttribute('sandbox', SANDBOX)
    iframe.setAttribute('allow', 'clipboard-write')

    Object.assign(iframe.style, { border: '0', width: '100%', height: '100%' }, options.style ?? {})

    // Once, after the frame is loaded: before that there is no `contentWindow`
    // document to receive it. The frame listens from its entry script rather
    // than from React, because this lands before its session exchange resolves.
    iframe.addEventListener('load', () => { announce(iframe.contentWindow) }, { once: true })

    container!.appendChild(iframe)
    frame = iframe
  }

  // `originOf` before anything is appended to the DOM: a URL we cannot place is
  // a mount that must not happen at all, rather than one that half-happens.
  window.addEventListener('message', receive)
  build(withLocale(options.url, options.locale))

  return {
    on(type, listener) {
      const set = listeners.get(type) ?? new Set<GingerDocsListener>()
      set.add(listener)
      listeners.set(type, set)

      return () => { set.delete(listener) }
    },

    off(type, listener) {
      listeners.get(type)?.delete(listener)
    },

    reload(url, { sessionId } = {}) {
      // Before the frame goes: the new one is built fresh from `options.style`,
      // and the host's scroll lock belongs to a modal that no longer exists.
      collapse()
      frame?.remove()
      // A new session means a new id. Keeping the old pin would reject every
      // message the replacement frame sends — the failure would look like the
      // embed having gone silent. So never `options.sessionId`: that is the
      // *first* session's id, and restoring it here was exactly that failure
      // for every host that pinned one (E10-27).
      pinnedSessionId = sessionId ?? null
      build(withLocale(url, options.locale))
    },

    unmount() {
      window.removeEventListener('message', receive)
      collapse()
      frame?.remove()
      frame = null
      listeners.clear()
    },

    get frame() {
      return frame
    },
  }
}

/**
 * The origin a URL belongs to, for comparing against `event.origin`.
 *
 * **Parsed without a base, so a relative URL throws** — which is the guard, not
 * pedantry. `new URL(url, location.href)` resolves `/embed#token=…` against the
 * *host's* origin: the mount would then point an iframe at a path on their own
 * site and, worse, pin `expectedOrigin` to their origin, so the SDK would start
 * trusting messages from the host page itself. Refusing to start is the only
 * safe answer to a URL we cannot place.
 *
 * The mint always returns an absolute URL, so the only way here is building one
 * by hand — which the message says not to do.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new Error(`[gingerdocs] ${JSON.stringify(url)} is not an absolute URL. Pass the \`url\` from POST /v1/embed_sessions verbatim.`)
  }
}

/**
 * Add `locale` to the query without disturbing the fragment.
 *
 * A query parameter rather than part of the host → frame `capabilities`
 * message because the frame reads it before its first render: the screens
 * shown before the session is exchanged — loading, or a refusal — are in the
 * host's language too, and the message only arrives after `load`.
 *
 * `URL` keeps the hash where it is, which matters more than it looks: the
 * session token lives there, and naive string concatenation of a query onto a
 * URL that already has a fragment produces `#token=…?locale=en` — a token with
 * a query glued to it, and an exchange that fails.
 */
function withLocale(url: string, locale?: string): string {
  if (locale === undefined || locale === '') return url

  // No base here either, for `originOf`'s reason — and unreachable with a bad
  // URL anyway, since `build()` calls `originOf` first and it throws.
  const parsed = new URL(url)
  parsed.searchParams.set('locale', locale)

  return parsed.toString()
}

/**
 * The namespace a `<script>` tag gets as `window.GingerDocsEmbed`.
 *
 * Named export only — no `export default` beside it. A module with both makes
 * the UMD global carry a `.default`, so the no-build-step integrator the UMD
 * bundle exists for would have to write `GingerDocsEmbed.default.mount(...)`,
 * which is exactly the audience least able to work out why.
 */
export const GingerDocsEmbed = { mount }
