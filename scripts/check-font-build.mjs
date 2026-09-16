#!/usr/bin/env node
/**
 * The committed `src/lib/scoreboardFonts.ts` is what its generator emits today.
 *
 *   node scripts/check-font-build.mjs
 *
 * ═══ THE HALF THAT WAS MISSING, AND WHY EVERY GATE STAYED GREEN WITHOUT IT ═══
 *
 * `src/lib/scoreboardFonts.ts` is generated output that is committed, so a clean
 * clone builds with no generation step. The price of committing generated output
 * is that it can stop being generated output, and nothing looks wrong when it
 * does.
 *
 * `src/lib/scoreboard.check.ts` already guards half of it, at section H: it
 * decodes `EMBEDDED_FACES`, compares the bytes to the woff2 beside them, and
 * fails if somebody swaps a face on disk without re-running the generator. That
 * is a real check and it stays. It is also only about the PAYLOAD.
 *
 * It cannot see the FILE. Rename a constant, reorder the faces, reword the
 * header, drop the license paragraph, change the interface, change how the
 * base64 is wrapped: the decode still finds the same bytes at the same names and
 * passes, `typecheck` passes because the file is still valid TypeScript, `lint`
 * passes, and the committed artifact has quietly stopped being the output of
 * `scripts/build-scoreboard-fonts.mjs`. The next person to run the generator
 * gets a diff they did not write and cannot explain, on a file whose own header
 * says do not edit by hand.
 *
 * The owner asked for exactly this, in these words: "make sure it actually
 * builds and byte-compares the result against the committed bundle, same as we
 * do today for gamemode."
 *
 * ═══ WHAT IT DOES NOT WRITE ═══
 *
 * Nothing. The gamemode's `ui-src/scripts/check-build.mjs` has to copy the
 * committed bundle aside, build over the real one, compare and restore in a
 * `finally`, because `vite build` cannot be asked for a string. That leaves a
 * window in which the tracked output is gone, and an abort inside it damages the
 * worktree as a side effect of checking it.
 *
 * `scripts/build-scoreboard-fonts.mjs` exports `renderScoreboardFonts()`
 * instead, which returns the file as a string and touches no disk, so there is
 * no window to abort inside and nothing to restore. It is also the REAL
 * generator rather than a second copy of it: re-implementing the render here
 * would prove that two functions agree and nothing about the committed file,
 * which is the mistake `scripts/check-ban-rule.mjs` documents having to live
 * with for its own reasons.
 *
 * ═══ NEWLINES, WHICH WOULD OTHERWISE MAKE THIS FAIL FOREVER ON WINDOWS ═══
 *
 * This repository has `core.autocrlf=true` and no `.gitattributes`. Every file
 * involved is LF in the index and Git says so out loud on every diff of the
 * generated file: "LF will be replaced by CRLF the next time Git touches it". So
 * a fresh clone on a Windows box has a CRLF `src/lib/scoreboardFonts.ts` AND a
 * CRLF `scripts/build-scoreboard-fonts.mjs`, and the generator's output carries
 * whatever line terminator its own template literal has in the working tree.
 *
 * A RAW BYTE COMPARE WOULD THEREFORE BE A COIN TOSS, not a check. It passes when
 * the two files happen to share a line ending and fails when they do not, and
 * this worktree right now is mixed: some files are CRLF and their neighbors are
 * LF, because tools that rewrite a file do not all agree. Worse, the generator's
 * output is internally mixed on a CRLF checkout, since the `join('\n\n')`
 * between the two face constants is a JavaScript escape and stays LF while every
 * line around it turns CRLF.
 *
 * SO THE COMPARE NORMALIZES CRLF TO LF ON BOTH SIDES, and that gives up nothing
 * this check is for. The payload is base64, whose alphabet contains no carriage
 * return, and it lives on a single line, so a line terminator can never be part
 * of a font. Every other byte is compared exactly. What is deliberately NOT
 * asserted is that the committed file is LF on disk: it legitimately is not on a
 * normal Windows checkout, and asserting it would break the gate for everybody
 * who cloned the repository the ordinary way.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OUT, renderScoreboardFonts } from './build-scoreboard-fonts.mjs'

/** The one normalization, in one place, so the two sides cannot differ in it. */
function lf(text) {
  return text.replace(/\r\n/g, '\n')
}

/**
 * Named relative to the repository and not to `process.cwd()`, so that the path
 * this prints and the command it tells you to run are in the same frame of
 * reference wherever the chain was invoked from.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const where = relative(ROOT, OUT).split(sep).join('/')
const FIX = 'Fix: node scripts/build-scoreboard-fonts.mjs'

function fail(...lines) {
  for (const line of lines) console.error(line)
  console.error(FIX)
  process.exit(1)
}

if (!existsSync(OUT)) {
  fail(`font build: the committed generated file is missing: ${where}`)
}

let rendered
try {
  rendered = renderScoreboardFonts().source
} catch (error) {
  /**
   * A THROW OUT OF THE GENERATOR IS A FAILING GATE, not a crash to read past.
   * It means a woff2 under `src/lib/fonts/` is missing or is not woff2, which is
   * a state the repository must not be committed in.
   */
  fail(
    'font build: the generator could not run.',
    `  ${error instanceof Error ? error.message : String(error)}`,
  )
}

/**
 * A GATE THAT COMPARES NOTHING TO NOTHING IS THE FAILURE MODE ISSUE #53 IS
 * ABOUT. If the render ever returned an empty string it would match an empty
 * committed file and report success, so refuse to draw a conclusion from either
 * side being empty before comparing them.
 */
if (rendered.trim() === '') {
  fail('font build: the generator produced nothing, so there is no check here.')
}

const committed = readFileSync(OUT, 'utf8')
if (committed.trim() === '') {
  fail(`font build: ${where} is empty.`)
}

const want = lf(rendered)
const got = lf(committed)

if (want === got) {
  console.log(
    `font build: ${where} is byte-identical to what ` +
      `scripts/build-scoreboard-fonts.mjs emits (${got.length.toLocaleString()} ` +
      'characters, newlines normalized)',
  )
  process.exit(0)
}

/**
 * THE DIFFERENCE HAS TO BE NAMEABLE. One of these lines is thirty thousand
 * characters of base64, so printing the pair is useless and printing nothing is
 * worse. Report the first line that differs and a short prefix of each side,
 * which is enough to tell "the header was edited" from "the fonts changed".
 */
const wantLines = want.split('\n')
const gotLines = got.split('\n')
const clip = (line) =>
  line === undefined
    ? '(no such line)'
    : line.length > 110
      ? `${line.slice(0, 110)}... (${line.length.toLocaleString()} characters)`
      : line

let at = 0
while (at < wantLines.length && at < gotLines.length && wantLines[at] === gotLines[at]) at++

console.error(`font build: ${where} is not what its generator emits.`)
console.error(`  first difference at line ${at + 1}:`)
console.error(`    generator: ${clip(wantLines[at])}`)
console.error(`    committed: ${clip(gotLines[at])}`)
if (wantLines.length !== gotLines.length) {
  console.error(
    `  the generator emits ${wantLines.length} lines, the committed file has ${gotLines.length}.`,
  )
}
console.error(
  '  The committed file is generated output and has stopped matching its producer.',
)
console.error(FIX)
process.exit(1)
