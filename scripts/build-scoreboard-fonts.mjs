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
 * ═══ THE GENERATED FILE IS COMMITTED, AND TWO CHECKS PROVE IT MATCHES ═══
 *
 * `src/lib/scoreboardFonts.ts` is checked in so that a clean clone builds with no
 * generation step. `src/lib/scoreboard.check.ts` decodes both constants and
 * compares them byte for byte against the woff2 beside them, so a font swapped
 * on disk without re-running this fails `npm run verify` rather than shipping a
 * page whose comment and whose bytes disagree.
 *
 * THAT PROVES THE PAYLOAD AND NOT THE FILE, which was the hole. The decode check
 * reads `EMBEDDED_FACES` and asks whether the bytes inside it are the bytes on
 * disk; it never asks whether the file around them is what this generator would
 * write today. Change the shape of the output here, rename a constant, edit the
 * header or the license paragraph, and the committed file silently stops being
 * the output of its own producer with every existing assertion still green.
 * `scripts/check-font-build.mjs` closes that: it calls `renderScoreboardFonts()`
 * below and compares the result to the committed file.
 *
 * ═══ WHY THE RENDER IS EXPORTED RATHER THAN WRITTEN AND RESTORED ═══
 *
 * The gamemode's equivalent (`ui-src/scripts/check-build.mjs`) copies the
 * committed bundle to a temporary directory, builds over the real one, compares,
 * and restores in a `finally`. That is the shape available when the producer is
 * `vite build` and cannot be asked for a string. It leaves a window: an abort,
 * a power cut or a killed terminal between the build and the restore leaves the
 * tracked output replaced or missing, and the repository is damaged by the act
 * of checking it.
 *
 * There is no such constraint here, because the producer is this file. So the
 * render is a pure function of `src/lib/fonts/*.woff2` that returns a string and
 * writes nothing, and only the CLI block at the bottom touches the disk. A
 * checker that never writes cannot leave a mess when it dies.
 *
 * IT ALSO KEEPS THE CHECK ABLE TO RUN AT ALL, which the gamemode learned the
 * hard way: its br_ddb rebuild check needed a `node_modules` nobody had, so it
 * printed `skip` for months and then went red for somebody else's reason
 * (#218). This render needs `node:fs` and two committed files. No install, no
 * subprocess, no toolchain. On this box process creation is the expensive thing
 * in the gate, and an in-process call costs none.
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

/**
 * The one tracked file this generator owns, exported so the checker cannot get
 * it wrong. Two copies of this path is two things to keep in step, and keeping
 * two things in step by hand is the defect issue #53 is about.
 */
export const OUT = join(ROOT, 'src', 'lib', 'scoreboardFonts.ts')

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

/**
 * woff2 begins with the four bytes `wOF2`. A woff or a ttf here is a mistake.
 *
 * IT THROWS RATHER THAN EXITING because the render is now called from
 * `scripts/check-font-build.mjs` as well as from the CLI below, and a library
 * that kills the process takes the caller's own reporting down with it. The CLI
 * block catches and prints the message on one line, so what an operator running
 * the generator sees is unchanged.
 */
function assertWoff2(name, bytes) {
  const magic = bytes.subarray(0, 4).toString('latin1')
  if (magic !== 'wOF2') {
    throw new Error(`${name} does not begin with wOF2 (got ${JSON.stringify(magic)}).`)
  }
}

/**
 * The exact content of `src/lib/scoreboardFonts.ts`, as a string, written
 * nowhere.
 *
 * Returns `{ source, parts }`: the file, and the per-face numbers the CLI prints
 * so that the logging lives with the command an operator ran and not inside a
 * function a gate calls.
 */
export function renderScoreboardFonts() {
  const parts = []
  for (const face of FACES) {
    const bytes = readFileSync(join(FONT_DIR, face.file))
    assertWoff2(face.file, bytes)
    const b64 = bytes.toString('base64')
    parts.push({ ...face, bytes: bytes.length, b64 })
  }

  /**
   * THE LINES INSIDE THIS TEMPLATE BEGIN AT COLUMN ZERO ON PURPOSE. They are the
   * content of the generated file, not code in this one: indenting them to line
   * up with the function around them would indent every line of the output, and
   * `scripts/check-font-build.mjs` would report a whitespace difference in a
   * fifty-thousand-character file for a change that looks like tidying in a
   * review. Leave the left margin alone.
   *
   * NOTE ALSO THAT ITS NEWLINES ARE THIS FILE'S NEWLINES. The outer template
   * carries whatever line terminator `scripts/build-scoreboard-fonts.mjs` has in
   * the working tree, while the `join('\n\n')` below is an escape and is always
   * LF, so on a CRLF checkout the output is genuinely mixed. That is why the
   * checker compares with newlines normalized and says so at length.
   */
  const source = `/**
 * The warmup board's two typefaces, base64 woff2 (#247).
 *
 * ⚠ GENERATED. Do not edit by hand.
 *
 *   node scripts/build-scoreboard-fonts.mjs
 *
 * The source bytes are \`src/lib/fonts/*.woff2\`, and two gates hold this file to
 * them. \`src/lib/scoreboard.check.ts\` decodes every constant below and compares
 * it to the file beside it, so the payload cannot drift. And
 * \`scripts/check-font-build.mjs\` re-runs the generator and compares this whole
 * file to what it emits, so the shape around the payload cannot drift either.
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

  return { source, parts }
}

/**
 * The CLI, and the only code here that writes anything.
 *
 * THE ENTRY-POINT TEST IS COMPARED BOTH WAYS ON WINDOWS. `process.argv[1]` is
 * already absolute when Node resolves it, but the drive letter's case is not
 * guaranteed to match the one in `import.meta.url`, and getting this wrong in
 * the quiet direction would mean `node scripts/build-scoreboard-fonts.mjs`
 * printing nothing and writing nothing while appearing to succeed. A
 * case-insensitive compare on win32 costs one line and removes that.
 */
function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  const self = fileURLToPath(import.meta.url)
  const a = resolve(entry)
  return process.platform === 'win32' ? a.toLowerCase() === self.toLowerCase() : a === self
}

if (invokedDirectly()) {
  try {
    const { source, parts } = renderScoreboardFonts()
    for (const p of parts) {
      console.log(
        `  ${p.file.padEnd(30)} ${String(p.bytes).padStart(6)} bytes ` +
          `-> ${p.b64.length.toLocaleString()} base64 characters`,
      )
    }
    writeFileSync(OUT, source, 'utf8')
    console.log(`\nwrote ${OUT} (${source.length.toLocaleString()} bytes)`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
