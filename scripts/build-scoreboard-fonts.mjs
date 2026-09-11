#!/usr/bin/env node
/**
 * Turn the two woff2 faces in `src/lib/fonts/` into the TypeScript constant the
 * warmup board embeds (#247).
 *
 *   node scripts/build-scoreboard-fonts.mjs
 *
 * ═══ WHY THE FONT IS A GENERATED CONSTANT AND NOT A FILE READ AT RUNTIME ═══
 *
 * The board is served by a route handler, and the document it writes must be ONE
 * request: a DUI is a browser on a player's own machine fetching this over the
 * public internet at the moment their client is streaming a map, and a second
 * round trip for a font is a round trip that can hang. So the faces travel
 * inside the document as `data:` URIs, which means the bytes have to be reachable
 * from the bundle.
 *
 * `readFileSync` AT REQUEST TIME WOULD BE THE OTHER WAY AND IT IS WORSE. It
 * depends on `src/lib/fonts/` still sitting beside the built server at whatever
 * cwd systemd starts it in, which is true today and is not a property anything
 * checks. A constant is in the bundle by construction.
 *
 * ═══ THE GENERATED FILE IS COMMITTED, AND THE CHECK PROVES IT MATCHES ═══
 *
 * `src/lib/scoreboardFonts.ts` is checked in so that a clean clone builds with no
 * generation step. `src/lib/scoreboard.check.ts` decodes both constants and
 * compares them byte for byte against the woff2 beside them, so a font swapped
 * on disk without re-running this fails `npm run verify` rather than shipping a
 * page whose comment and whose bytes disagree.
 *
 * ═══ NOT SUBSETTED, DELIBERATELY ═══
 *
 * Anton carries five fixed labels and the digits and could be cut to a couple of
 * kilobytes, but Barlow carries PLAYER NAMES, which are arbitrary, so it cannot
 * be. Subsetting one of the two would buy about sixteen kilobytes on a document
 * fetched once per player per session, and would cost this Node repository a
 * Python font toolchain in its build path. The trade is not worth it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONT_DIR = join(ROOT, 'src', 'lib', 'fonts')
const OUT = join(ROOT, 'src', 'lib', 'scoreboardFonts.ts')

/**
 * The two faces, and they are the game's own.
 *
 * `ui-src/tailwind.config.ts` in the gamemode repository sets exactly two
 * families: `display: Anton` and `sans: Barlow`. `ui-src/src/index.css` says what
 * each is for in one line - "Barlow carries every word. Anton carries every
 * quantity and every shout" - and that is the split this board uses.
 *
 * BOTH ARE SIL OPEN FONT LICENSE 1.1 and the notices travel beside them in
 * `src/lib/fonts/`. Nothing here is paid for and nothing is fetched from a font
 * host at render time.
 */
const FACES = [
  {
    constant: 'ANTON_400',
    file: 'anton-latin-400-normal.woff2',
    family: 'Anton',
    weight: 400,
  },
  {
    constant: 'BARLOW_600',
    file: 'barlow-latin-600-normal.woff2',
    family: 'Barlow',
    weight: 600,
  },
]

/** woff2 begins with the four bytes `wOF2`. A woff or a ttf here is a mistake. */
function assertWoff2(name, bytes) {
  const magic = bytes.subarray(0, 4).toString('latin1')
  if (magic !== 'wOF2') {
    console.error(`${name} does not begin with wOF2 (got ${JSON.stringify(magic)}).`)
    process.exit(1)
  }
}

const parts = []
for (const face of FACES) {
  const bytes = readFileSync(join(FONT_DIR, face.file))
  assertWoff2(face.file, bytes)
  const b64 = bytes.toString('base64')
  parts.push({ ...face, bytes: bytes.length, b64 })
  console.log(
    `  ${face.file.padEnd(30)} ${String(bytes.length).padStart(6)} bytes ` +
      `-> ${b64.length.toLocaleString()} base64 characters`,
  )
}

const body = `/**
 * The warmup board's two typefaces, base64 woff2 (#247).
 *
 * ⚠ GENERATED. Do not edit by hand.
 *
 *   node scripts/build-scoreboard-fonts.mjs
 *
 * The source bytes are \`src/lib/fonts/*.woff2\` and \`src/lib/scoreboard.check.ts\`
 * decodes every constant below and compares it to the file beside it, so this
 * file drifting from those is a failing gate rather than a silent difference.
 *
 * WHY THEY TRAVEL INSIDE THE DOCUMENT. The board is fetched by a DUI - a browser
 * on a player's machine, over the public internet, while their client streams a
 * map - and the document is deliberately one request with nothing to follow up.
 * See scripts/build-scoreboard-fonts.mjs.
 *
 * SIL OPEN FONT LICENSE 1.1, both of them. The notices are checked in beside the
 * files, at src/lib/fonts/OFL-Anton.txt and src/lib/fonts/OFL-Barlow.txt.
 */

export interface EmbeddedFace {
  /** The \`font-family\` name the stylesheet asks for. */
  family: string
  weight: number
  /** The file in \`src/lib/fonts/\` these bytes came from. */
  file: string
  /** Decoded length in bytes, so the check has something to compare. */
  bytes: number
  base64: string
}

${parts
  .map(
    (p) => `export const ${p.constant}: EmbeddedFace = {
  family: '${p.family}',
  weight: ${p.weight},
  file: '${p.file}',
  bytes: ${p.bytes},
  base64:
    '${p.b64}',
}`,
  )
  .join('\n\n')}

/** Every embedded face, in the order the stylesheet declares them. */
export const EMBEDDED_FACES: readonly EmbeddedFace[] = [${parts
  .map((p) => p.constant)
  .join(', ')}]
`

writeFileSync(OUT, body, 'utf8')
console.log(`\nwrote ${OUT} (${body.length.toLocaleString()} bytes)`)
