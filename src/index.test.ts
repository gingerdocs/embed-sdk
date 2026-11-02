import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type GingerDocsEvent } from './index'

/**
 * `@gingerdocs/embed` (design §10.3).
 *
 * The SDK's whole job is to be a filter that does not leak. A host page's own
 * code, its analytics, its other iframes and — in the case that matters — a
 * *hostile* page all post into the same `message` handler, so every test here
 * is about something the SDK must refuse.
 *
 * The iframe attributes get the same treatment, because each is load-bearing
 * and invisible: without `referrerpolicy="strict-origin"` the exchange fails
 * closed in Firefox, and without `allow-downloads` the signer's PDF button
 * silently does nothing at the end of a ceremony.
 */

const EMBED_ORIGIN = 'https://app.gingerdocs.test'
const URL_ONE = `${EMBED_ORIGIN}/embed?fa=aHR0cHM6Ly9ob3N0LnRlc3Q#token=gdet_one`
const URL_TWO = `${EMBED_ORIGIN}/embed?fa=aHR0cHM6Ly9ob3N0LnRlc3Q#token=gdet_two`

let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  host.remove()
  vi.restoreAllMocks()
})

/** Deliver a message as the browser would, with a controllable origin. */
function post(body: unknown, origin = EMBED_ORIGIN): void {
  window.dispatchEvent(new MessageEvent('message', { data: body, origin }))
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'gingerdocs-embed',
    type: 'ready',
    sessionId: 'sess-1',
    payload: {},
    ...overrides,
  }
}

describe('mount', () => {
  it('builds the iframe with the attributes the frame depends on', () => {
    const embed = mount(host, { url: URL_ONE })
    const frame = embed.frame!

    expect(frame.tagName).toBe('IFRAME')
    expect(frame.src).toBe(URL_ONE)

    // §10.3: Firefox has no `location.ancestorOrigins`, so this is the only way
    // the frame can tell our server which page is showing it. Drop it and the
    // exchange fails closed — in one browser, which is the worst kind of bug.
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin')

    const sandbox = frame.getAttribute('sandbox') ?? ''

    // The pair that lets the embed run at all.
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')

    // The signed PDF is the one thing a signer does that leaves the frame.
    expect(sandbox).toContain('allow-downloads')
    expect(sandbox).toContain('allow-popups')

    // Never: nothing inside the frame moves the host's page out from under
    // the user.
    expect(sandbox).not.toContain('allow-top-navigation')

    // Never, and the frame is built for it: with no `allow-modals` a native
    // `confirm()` inside the frame is ignored (returns false at once), so every
    // confirmation the frame needs is rendered in the frame. Adding the flag
    // here would only let a future native dialog *appear* to work.
    expect(sandbox).not.toContain('allow-modals')

    embed.unmount()
  })

  it('accepts a selector as well as an element, and refuses one that matches nothing', () => {
    host.id = 'mount-here'

    const embed = mount('#mount-here', { url: URL_ONE })
    expect(host.querySelector('iframe')).not.toBeNull()
    embed.unmount()

    expect(() => mount('#nothing-here', { url: URL_ONE })).toThrow(/No element matched/)
  })

  /**
   * A URL built by hand rather than taken from the mint response.
   *
   * **A relative one is the dangerous case**, and it is why this is parsed
   * without a base: `/embed#token=…` resolved against `location` points the
   * iframe at a path on the *host's* own site and pins `expectedOrigin` to the
   * host's origin — so the SDK would start trusting messages from the host page
   * itself. Refusing to mount is the only safe answer.
   */
  it('refuses a relative or unparseable url rather than pinning to the host origin', () => {
    for (const bad of ['/embed#token=x', 'embed?fa=1', 'not a url', '']) {
      expect(() => mount(host, { url: bad })).toThrow(/is not an absolute URL/)
    }

    // …and nothing was appended on the way out.
    expect(host.querySelector('iframe')).toBeNull()
  })

  /**
   * `locale` goes in the query, and the fragment has to survive it. Concatenating
   * naively onto a URL that already has a hash produces `#token=…?locale=en` — a
   * token with a query glued to its end, and an exchange that fails.
   */
  it('adds locale without disturbing the token in the fragment', () => {
    const embed = mount(host, { url: URL_ONE, locale: 'ja' })
    const src = new URL(embed.frame!.src)

    expect(src.searchParams.get('locale')).toBe('ja')
    expect(src.hash).toBe('#token=gdet_one')
    expect(src.searchParams.get('fa')).toBe('aHR0cHM6Ly9ob3N0LnRlc3Q')

    embed.unmount()
  })
})

describe('event filtering', () => {
  it('delivers our messages to the listener for their type', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: GingerDocsEvent[] = []

    embed.on('completed', e => { seen.push(e) })
    embed.on('ready', () => { seen.push({ type: 'ready', sessionId: 'x', payload: {} }) })

    post(message({ type: 'completed', payload: { documentId: 'doc-1' } }))

    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('completed')
    expect(seen[0].payload).toEqual({ documentId: 'doc-1' })

    embed.unmount()
  })

  /**
   * The check that matters most. A page that can post into the host — another
   * iframe, an ad, an extension's content script — must not be able to announce
   * that a document was signed.
   */
  it('ignores a message from any other origin', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('completed', () => seen.push('completed'))

    post(message({ type: 'completed' }), 'https://evil.test')
    post(message({ type: 'completed' }), 'http://app.gingerdocs.test') // scheme differs
    post(message({ type: 'completed' }), 'https://app.gingerdocs.test.evil.test')

    expect(seen).toEqual([])

    embed.unmount()
  })

  it('ignores anything without our source marker, and anything malformed', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('ready', () => seen.push('ready'))

    post({ type: 'ready', sessionId: 'sess-1' })                       // no marker
    post(message({ source: 'someone-else' }))
    post(message({ sessionId: undefined }))
    post(message({ type: undefined }))
    post('a string')
    post(null)

    expect(seen).toEqual([])

    embed.unmount()
  })

  /**
   * Two signers side by side is a real workflow, and the two frames share an
   * origin — so the origin check alone cannot tell them apart.
   */
  it('pins to the first session it hears from and ignores the other frame', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('viewed', e => seen.push(e.sessionId))

    post(message({ type: 'viewed', sessionId: 'sess-1' }))
    post(message({ type: 'viewed', sessionId: 'sess-2' }))
    post(message({ type: 'viewed', sessionId: 'sess-1' }))

    expect(seen).toEqual(['sess-1', 'sess-1'])

    embed.unmount()
  })

  /**
   * …and when the host passes the id from its own mint response, the pin is set
   * before the frame says anything at all — so even the *first* message from a
   * session the host did not create is refused.
   */
  it('honours a session id supplied by the host from the start', () => {
    const embed = mount(host, { url: URL_ONE, sessionId: 'sess-mine' })
    const seen: string[] = []
    embed.on('ready', e => seen.push(e.sessionId))

    post(message({ sessionId: 'sess-theirs' }))
    expect(seen).toEqual([])

    post(message({ sessionId: 'sess-mine' }))
    expect(seen).toEqual(['sess-mine'])

    embed.unmount()
  })

  it('stops delivering after off(), and after the returned unsubscribe', () => {
    const embed = mount(host, { url: URL_ONE })
    const viaOff: string[] = []
    const viaReturn: string[] = []

    const offMe = (e: GingerDocsEvent) => viaOff.push(e.type)
    embed.on('ready', offMe)
    const unsubscribe = embed.on('ready', e => viaReturn.push(e.type))

    post(message())
    expect([viaOff.length, viaReturn.length]).toEqual([1, 1])

    embed.off('ready', offMe)
    unsubscribe()

    post(message())
    expect([viaOff.length, viaReturn.length]).toEqual([1, 1])

    embed.unmount()
  })

  /**
   * One listener's mistake is not the others' problem — a host with an
   * analytics call that throws must not stop its own completion handler from
   * running.
   */
  it('keeps calling the remaining listeners when one throws', () => {
    vi.useFakeTimers()

    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []

    embed.on('ready', () => { throw new Error('host bug') })
    embed.on('ready', () => seen.push('second'))

    post(message())

    expect(seen).toEqual(['second'])

    // The error is not swallowed: it is rethrown asynchronously so the host
    // still sees a real unhandled error rather than silence.
    expect(() => vi.runAllTimers()).toThrow('host bug')

    embed.unmount()
    vi.useRealTimers()
  })
})

describe('reload and unmount', () => {
  /** §10.3's `session_expired` contract: mint a new session, then reload. */
  it('replaces the frame and accepts the new session', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('ready', e => seen.push(e.sessionId))

    post(message({ sessionId: 'sess-old' }))
    expect(seen).toEqual(['sess-old'])

    embed.reload(URL_TWO)

    expect(host.querySelectorAll('iframe')).toHaveLength(1)
    expect(embed.frame!.src).toBe(URL_TWO)

    // The pin was cleared with the old frame. Holding it would reject every
    // message the replacement sends, and the embed would look like it had
    // simply gone quiet.
    post(message({ sessionId: 'sess-new' }))
    expect(seen).toEqual(['sess-old', 'sess-new'])

    embed.unmount()
  })

  /**
   * E10-27. This test used to be called "keeps a host-supplied pin across a
   * reload", and that pin was the defect: the URL is a new session, so the id
   * from `mount()` names one that no longer exists, and every message from the
   * frame the host just reloaded onto — `ready`, `completed` — was dropped. A
   * host that followed the advice to pass `sessionId` lost every event after
   * its first `session_expired`.
   */
  it('does not carry a host-supplied pin into the reloaded session', () => {
    const embed = mount(host, { url: URL_ONE, sessionId: 'sess-mine' })
    const seen: string[] = []
    embed.on('ready', e => seen.push(e.sessionId))

    embed.reload(URL_TWO)

    // No id for the new session, so the new frame's first word pins it — the
    // same rule as a mount without `sessionId`.
    post(message({ sessionId: 'sess-new' }))
    expect(seen).toEqual(['sess-new'])

    // …and the old id is just another session now.
    post(message({ sessionId: 'sess-mine' }))
    expect(seen).toEqual(['sess-new'])

    embed.unmount()
  })

  /** The stronger form: the new mint response's `id`, pinned before the frame speaks. */
  it('pins the id passed to reload() from the start', () => {
    const embed = mount(host, { url: URL_ONE, sessionId: 'sess-mine' })
    const seen: string[] = []
    embed.on('ready', e => seen.push(e.sessionId))

    embed.reload(URL_TWO, { sessionId: 'sess-next' })

    post(message({ sessionId: 'sess-someone-else' }))
    post(message({ sessionId: 'sess-mine' }))
    expect(seen).toEqual([])

    post(message({ sessionId: 'sess-next' }))
    expect(seen).toEqual(['sess-next'])

    embed.unmount()
  })

  it('pins a reloaded session even when the mount itself had no id', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('ready', e => seen.push(e.sessionId))

    post(message({ sessionId: 'sess-old' }))
    embed.reload(URL_TWO, { sessionId: 'sess-next' })

    post(message({ sessionId: 'sess-someone-else' }))
    post(message({ sessionId: 'sess-next' }))

    expect(seen).toEqual(['sess-old', 'sess-next'])

    embed.unmount()
  })

  /** The mount's `locale` belongs to the mount, not to its first session. */
  it('keeps the mount locale on the reloaded frame', () => {
    const embed = mount(host, { url: URL_ONE, locale: 'ja' })

    embed.reload(URL_TWO)

    const src = new URL(embed.frame!.src)
    expect(src.searchParams.get('locale')).toBe('ja')
    expect(src.hash).toBe('#token=gdet_two')

    embed.unmount()
  })

  it('removes the frame, detaches from window, and is safe to call twice', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []
    embed.on('ready', () => seen.push('ready'))

    const attached = add.mock.calls.find(([type]) => type === 'message')?.[1]
    expect(attached).toBeDefined()

    embed.unmount()

    expect(host.querySelector('iframe')).toBeNull()
    expect(embed.frame).toBeNull()

    /**
     * **The window listener is detached, not merely made silent.**
     *
     * Clearing the subscriber map alone would make this test's `post()` below
     * deliver nothing — which is why asserting only that is not enough: the
     * handler would stay bound to `window` for the life of the page, holding
     * its whole closure. A host that mounts and unmounts on every route change
     * would accumulate one per navigation. Mutation-checked: deleting the
     * `removeEventListener` call passes a silence assertion and fails this one.
     */
    expect(remove).toHaveBeenCalledWith('message', attached)

    post(message())
    expect(seen).toEqual([])

    expect(() => embed.unmount()).not.toThrow()
  })

  /**
   * A second mount on the same page must not be deafened by the first one's
   * teardown — `unmount` removes only its own listener.
   */
  it('does not deafen a sibling mount', () => {
    const first = mount(host, { url: URL_ONE })
    const second = mount(host, { url: URL_ONE })
    const seen: string[] = []
    second.on('ready', () => seen.push('ready'))

    first.unmount()
    post(message())

    expect(seen).toEqual(['ready'])

    second.unmount()
  })
})

/**
 * Expand-to-modal (design §10.3, amendment E0-4).
 *
 * Two claims, and the second is the one that would hurt. The SDK must present
 * the frame over the host page when the frame asks — and it must give the page
 * back **exactly** as it found it, on every path out: collapse, reload, unmount.
 * A host left with `overflow: hidden` on `<body>` has a page that cannot scroll
 * and nothing on screen to explain why.
 *
 * The announcement is tested for shape and for address, because it is the only
 * message that travels host → frame and the frame refuses it on both.
 */
describe('expand', () => {
  /** The frame's `load`, which jsdom does not fire for an un-fetched `src`. */
  function load(frame: HTMLIFrameElement): ReturnType<typeof vi.spyOn> {
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
    frame.dispatchEvent(new Event('load'))
    return posted as ReturnType<typeof vi.spyOn>
  }

  it('announces what the host can do, once, addressed to the frame origin', () => {
    const embed = mount(host, { url: URL_ONE })
    const posted = load(embed.frame!)

    expect(posted).toHaveBeenCalledTimes(1)
    expect(posted).toHaveBeenCalledWith(
      { source: 'gingerdocs-host', type: 'capabilities', payload: { expand: true } },
      EMBED_ORIGIN,
    )

    // Never `'*'`: this describes the host's own page, and a frame that
    // navigated elsewhere must not be told about it.
    expect(posted.mock.calls[0][1]).not.toBe('*')

    embed.unmount()
  })

  /**
   * Opting out is *said*, not withheld. Silence already means "no" for every
   * host on an SDK older than this message; saying it costs one `postMessage`
   * and removes the ambiguity for everyone else.
   */
  it('announces expand: false when the host opted out', () => {
    const embed = mount(host, { url: URL_ONE, expand: 'none' })
    const posted = load(embed.frame!)

    expect(posted).toHaveBeenCalledWith(
      { source: 'gingerdocs-host', type: 'capabilities', payload: { expand: false } },
      EMBED_ORIGIN,
    )

    embed.unmount()
  })

  it('pins the frame over the page on expanded and locks the host scroll', () => {
    const embed = mount(host, { url: URL_ONE })
    const frame = embed.frame!

    post(message({ type: 'expanded' }))

    expect(frame.style.position).toBe('fixed')
    expect(frame.style.width).toBe('100%')
    expect(frame.style.height).toBe('100%')
    expect(frame.style.zIndex).toBe('2147483000')
    expect(frame.style.background).toBe('white')
    // `inset: 0`, written as the longhands `Object.assign` cannot silently drop.
    expect([frame.style.top, frame.style.right, frame.style.bottom, frame.style.left])
      .toEqual(['0px', '0px', '0px', '0px'])

    expect(document.body.style.overflow).toBe('hidden')

    // The element stays exactly where it was in the DOM: moving an iframe
    // reloads it, and a reload would spend the session's re-exchange grace.
    expect(frame.parentElement).toBe(host)

    embed.unmount()
  })

  it('restores the host style and the page scroll on collapsed', () => {
    document.body.style.overflow = 'auto'

    const embed = mount(host, { url: URL_ONE, style: { height: '25rem', border: '1px solid red' } })
    const frame = embed.frame!
    const before = frame.getAttribute('style')

    post(message({ type: 'expanded' }))
    expect(frame.getAttribute('style')).not.toBe(before)

    post(message({ type: 'collapsed' }))

    // Byte-for-byte, which is why the whole attribute is saved rather than the
    // handful of properties the modal overwrites.
    expect(frame.getAttribute('style')).toBe(before)
    expect(frame.style.height).toBe('25rem')
    expect(document.body.style.overflow).toBe('auto')

    embed.unmount()
    document.body.style.overflow = ''
  })

  it('re-emits both to the host, so a page can hide its own chrome', () => {
    const embed = mount(host, { url: URL_ONE })
    const seen: string[] = []

    embed.on('expanded', e => seen.push(e.type))
    embed.on('collapsed', e => seen.push(e.type))

    post(message({ type: 'expanded' }))
    post(message({ type: 'collapsed' }))

    expect(seen).toEqual(['expanded', 'collapsed'])

    embed.unmount()
  })

  /**
   * The frame is told `expand: false` and does not render the control, so this
   * is a message it should never send. If it does — an older frame, a host page
   * forging one — the answer is to forward the event and touch nothing.
   */
  it('does not move the frame when the host opted out', () => {
    const embed = mount(host, { url: URL_ONE, expand: 'none' })
    const frame = embed.frame!
    const before = frame.getAttribute('style')
    const seen: string[] = []

    embed.on('expanded', () => seen.push('expanded'))
    post(message({ type: 'expanded' }))

    expect(frame.getAttribute('style')).toBe(before)
    expect(document.body.style.overflow).toBe('')
    expect(seen).toEqual(['expanded'])

    embed.unmount()
  })

  /**
   * The filters that guard every other event guard this one, and here they are
   * guarding a *write to the host's page* rather than a callback. A page that
   * could be pinned by any origin shouting `expanded` would be a clickjacking
   * surface handed over by its own SDK.
   */
  it('refuses to expand for another origin, or for another session', () => {
    const embed = mount(host, { url: URL_ONE, sessionId: 'sess-1' })
    const frame = embed.frame!
    const before = frame.getAttribute('style')

    post(message({ type: 'expanded' }), 'https://evil.test')
    post(message({ type: 'expanded', sessionId: 'sess-other' }))
    post({ source: 'somebody-else', type: 'expanded', sessionId: 'sess-1', payload: {} })

    expect(frame.getAttribute('style')).toBe(before)
    expect(document.body.style.overflow).toBe('')

    embed.unmount()
  })

  it('restores the page when the frame is reloaded while expanded', () => {
    const embed = mount(host, { url: URL_ONE, style: { height: '25rem' } })
    const before = embed.frame!.getAttribute('style')

    post(message({ type: 'expanded' }))
    embed.reload(URL_TWO)

    // The replacement is built from `options.style`, so it is the *same* box the
    // host had before — and the lock it inherited is gone.
    expect(embed.frame!.getAttribute('style')).toBe(before)
    expect(embed.frame!.style.position).not.toBe('fixed')
    expect(document.body.style.overflow).toBe('')

    embed.unmount()
  })

  it('restores the page when the embed is unmounted while expanded', () => {
    document.body.style.overflow = 'auto'

    const embed = mount(host, { url: URL_ONE })
    post(message({ type: 'expanded' }))

    embed.unmount()

    // The frame is gone; the page must not still be holding its scroll lock.
    expect(document.body.style.overflow).toBe('auto')

    document.body.style.overflow = ''
  })
})
