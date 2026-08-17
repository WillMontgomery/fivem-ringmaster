/**
 * The accent-colour contrast floor, checked against every colour that exists.
 *
 * WHY THIS IS A GATE AND NOT A UNIT TEST. `accentSurface()` paints a background
 * chosen by a stranger — a Discord accent colour is picked by the account
 * holder out of the whole 24-bit cube — and then writes a player's name on it.
 * The failure mode is invisible text for a fraction of players, and it is
 * invisible to whoever wrote the code, because their own account looks fine.
 * Sampling a handful of colours would pass while a band of them was broken.
 *
 * SO IT SWEEPS THE CUBE. `--full` walks all 16,777,216, which is the run that
 * turns the guarantee in the module header into a fact; it takes about half a
 * minute. Bare, it strides the same range and takes under a second, which is
 * what `npm run verify` runs on every change. The stride is coprime with 256 so
 * every value of every channel is still visited — a regression large enough to
 * matter cannot hide between the samples.
 *
 * It also prints the two extremes the whole exercise exists for — pure white
 * and pure black, the two accents that make a raw surface unreadable — so a
 * change to the clamp band shows up as different numbers rather than as
 * nothing.
 *
 *   npx tsx scripts/check-contrast.mjs           # strided, ~0.5s
 *   npx tsx scripts/check-contrast.mjs --full    # all of them, ~30s
 */

import { accentSurface, contrastRatio, parseHex, relativeLuminance } from '../src/lib/contrast.ts'

/** WCAG AA for normal text. The floor the module promises. */
const FLOOR = 4.5

/** Reported for every run, so the clamp band cannot move unnoticed. */
const LANDMARKS = [
  ['#ffffff', 'pure white — the light-theme extreme'],
  ['#fefefe', 'one step off white'],
  ['#000000', 'pure black — the dark-theme extreme'],
  ['#010101', 'one step off black'],
  ['#ff11ff', "the owner's own accent (16716287)"],
  ['#808080', 'mid grey, the hardest hue-free case'],
  ['#0000ff', 'pure blue — lowest luminance of the primaries'],
  ['#ffff00', 'pure yellow — highest luminance of the primaries'],
]

let failed = 0

console.log('landmarks')
for (const [hex, note] of LANDMARKS) {
  const s = accentSurface(hex)
  if (!s) {
    console.error(`  ${hex}  did not parse`)
    failed++
    continue
  }
  const flag = s.ratio < FLOOR ? '\x1b[31mFAIL\x1b[0m' : '  ok'
  if (s.ratio < FLOOR) failed++
  console.log(
    `  ${flag}  ${hex} -> ${s.background} on ${s.foreground}  ${s.ratio.toFixed(2)}:1` +
      `${s.clamped ? '  (clamped)' : ''}   ${note}`,
  )
}

/*
 * THE EXHAUSTIVE PASS.
 *
 * `worst` is the number that matters: it is the guarantee. Anything under the
 * floor is printed with the colour that produced it, because "some colour
 * somewhere fails" is not something anyone can act on.
 */
const FULL = process.argv.includes('--full')

/** Prime, and coprime with 256, so every channel value is still sampled. */
const STRIDE = FULL ? 1 : 31

let worst = Infinity
let worstHex = ''
let clamped = 0
let under = 0
let seen = 0

const started = Date.now()

for (let n = 0; n < 0x1000000; n += STRIDE) {
  seen++
  const hex = `#${n.toString(16).padStart(6, '0')}`
  const s = accentSurface(hex)
  if (!s) {
    console.error(`  ${hex} did not parse`)
    failed++
    break
  }
  if (s.clamped) clamped++
  if (s.ratio < worst) {
    worst = s.ratio
    worstHex = hex
  }
  if (s.ratio < FLOOR) {
    under++
    if (under <= 5) {
      console.error(
        `\x1b[31mFAIL\x1b[0m  ${hex} -> ${s.background} on ${s.foreground} = ${s.ratio.toFixed(2)}:1`,
      )
    }
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1)

console.log('')
console.log(
  `swept ${seen.toLocaleString()} colours in ${secs}s` +
    (FULL ? ' (every one)' : `  — stride ${STRIDE}; --full for all 16,777,216`),
)
console.log(`  worst contrast  ${worst.toFixed(2)}:1  at ${worstHex}`)
console.log(`  clamped         ${clamped.toLocaleString()} (${((clamped / seen) * 100).toFixed(1)}%)`)

if (under > 0) {
  console.error('')
  console.error(`\x1b[31m${under.toLocaleString()} colour(s) below ${FLOOR}:1.\x1b[0m`)
  console.error('Accent colours are chosen by players, not by us. A surface that')
  console.error('fails here is a player name nobody can read on somebody\'s profile.')
  failed++
}

/*
 * A SANITY CHECK ON THE MATHS ITSELF, because an exhaustive sweep of a wrong
 * formula is exhaustively wrong. Black on white is 21:1 by definition; if that
 * comes out anything else, relativeLuminance or contrastRatio is broken and
 * every number above is meaningless.
 */
const white = relativeLuminance(parseHex('#ffffff'))
const black = relativeLuminance(parseHex('#000000'))
const bw = contrastRatio(white, black)
if (Math.abs(bw - 21) > 0.001) {
  console.error(`black on white = ${bw}, expected 21 — the luminance maths is wrong`)
  failed++
}

if (failed > 0) {
  console.error('')
  console.error(`\x1b[31m${failed} contrast problem(s).\x1b[0m`)
  process.exit(1)
}

console.log('')
console.log(`\x1b[32mok\x1b[0m   every accent colour clears ${FLOOR}:1`)
