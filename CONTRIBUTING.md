# Contributing

Issues are the most useful thing you can send, especially the ones that begin "I expected X".

## Reporting

- **A bug** — [open a bug report](../../issues/new?template=bug.yml). The version, the browser, and
  what you expected are the three fields that decide whether we can reproduce it.
- **Something confusing** — [ask](../../issues/new?template=integration-question.yml). A question the
  docs should have answered is a docs bug, and we would rather fix it than answer it twice.
- **A security issue** — not here. See [SECURITY.md](SECURITY.md).

## Working on the SDK

Each package is its own repo — [`@gingerdocs/embed`](https://github.com/gingerdocs/embed-sdk) and
[`@gingerdocs/react`](https://github.com/gingerdocs/embed-react-sdk) — and each is a plain npm package at the repo root:

```bash
npm install
npm test          # vitest
npm run build     # tsc + vite
npm run size      # the gzip budget — @gingerdocs/embed only
```

The React package declares the core as a peer and installs the published `@gingerdocs/embed` for
its tests. To test it against an unpublished core, `npm link` a local checkout of the core repo.

### Things to know before you open a PR

**The size budget is real.** `@gingerdocs/embed` is about 1.4 kB gzipped against a 5,120 B ceiling, and
`npm run size` fails the build if a change blows it. It is small because it is loaded on other
people's pages, sometimes on their checkout. A feature that needs a dependency probably belongs on
our side of the iframe, not in the SDK.

**The SDK holds no credentials and makes no API calls.** It moves messages between two windows. If a
change has it fetching from our API, that is a sign the design has drifted — the whole reason this
package is safe to publish is that there is nothing in it to steal.

**Origin and session pinning are not optional.** Every `postMessage` is checked against both. If a
change makes either check conditional, it needs a very good reason and a test that fails without it.

**Match the surrounding style.** The code explains *why*, not *what* — that is deliberate, and a PR
that strips the comments will be asked to put them back.

### Tests

Every behaviour change needs one. We check that guards work by breaking them: remove the guard, and
a named test must fail. A guard whose removal leaves the suite green is not tested.

## What we are unlikely to merge

- A dependency in `@gingerdocs/embed`. It has none, and that is a feature.
- A default export in `@gingerdocs/react`. Mixing it with named exports puts the component behind
  `.default` on the UMD global.
- Anything that makes the SDK render document content itself. The frame does that, on our origin,
  where the sanitiser lives.
