import { gzipSync } from 'node:zlib'
import { readFileSync, statSync } from 'node:fs'

/**
 * The size budget the phase set: **under 5 KB**.
 *
 * Measured gzipped on the ESM build, because that is what an integrator's
 * bundler ships and what their users download. The raw byte count is reported
 * beside it so a regression is legible either way.
 *
 * A budget nobody checks is a wish, so this exits non-zero — it is wired into
 * the package's own `npm run size` and named in the README.
 */
const LIMIT = 5 * 1024
const file = new URL('../dist/gingerdocs-embed.js', import.meta.url)

const raw = readFileSync(file)
const gzipped = gzipSync(raw).length

const line = `gingerdocs-embed.js  ${statSync(file).size} B raw  ${gzipped} B gzipped  (budget ${LIMIT} B)`

if (gzipped > LIMIT) {
  console.error(`✖ over budget — ${line}`)
  process.exit(1)
}

console.log(`✔ ${line}`)
