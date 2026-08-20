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

import { readFileSync } from 'node:fs'

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

/*
 * THE CHART SERIES, IN BOTH THEMES.
 *
 * A SECOND POPULATION OF COLOURS, AND UNTIL NOW AN UNMEASURED ONE. Everything
 * above is about a colour a STRANGER picked; this is about five colours we
 * picked ourselves and wrote into globals.css, which is exactly why nobody had
 * ever checked them — an accent from the Discord API obviously needs guarding,
 * and a hex somebody chose deliberately obviously does not. The light theme
 * shipped three chart tokens under the floor on precisely that reasoning.
 *
 * IT READS THE STYLESHEET RATHER THAN A COPY OF THE VALUES. A table of colours
 * duplicated into this script would be correct on the day it was written and
 * silently wrong the first time somebody retuned the palette without opening
 * scripts/ — the failure mode this whole file exists to prevent. globals.css is
 * the source of truth, so globals.css is what gets parsed.
 *
 * AGAINST BOTH SURFACES A CHART IS DRAWN ON, and the lower of the two ratios is
 * the one that counts. A series sits on `--card` inside a Card and on
 * `--background` in anything that is not one, and those differ in the light
 * theme (pure white vs a faintly grey page), so passing on one proves nothing
 * about the other.
 */

/** oklch(L C H) -> sRGB 0-1, per CSS Color 4. Returns null if out of gamut. */
function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]

  /*
   * OUT OF GAMUT IS A FAILURE, NOT SOMETHING TO CLAMP AND CARRY ON. A token the
   * browser has to gamut-map is a token whose rendered colour is not the one
   * measured here, so the ratio printed below would be a number about a colour
   * nobody ever sees. Better to reject it and make somebody pick a real one.
   */
  if (lin.some((u) => u < -0.0005 || u > 1.0005)) return null

  return lin.map((u) => {
    const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055
    return Math.min(1, Math.max(0, v))
  })
}

/** Pull one `{ … }` rule body out of the stylesheet by its selector. */
function ruleBody(css, selector) {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return null
  const end = css.indexOf('\n}', start)
  return end === -1 ? null : css.slice(start, end)
}

/** `--name: oklch(L C H)` out of a rule body, as sRGB. */
function token(body, name) {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(body)
  if (!m) return null
  return oklchToSrgb(Number(m[1]), Number(m[2]), Number(m[3]))
}

const CSS = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5']

console.log('')
console.log('chart series — globals.css, against both surfaces of each theme')

for (const [theme, selector] of [
  ['light', ':root'],
  ['dark', '.dark'],
]) {
  const body = ruleBody(CSS, selector)
  if (!body) {
    console.error(`  could not find the ${selector} rule in globals.css`)
    failed++
    continue
  }

  const card = token(body, 'card')
  const background = token(body, 'background')
  if (!card || !background) {
    console.error(`  ${theme}: --card or --background is missing or not oklch()`)
    failed++
    continue
  }
  const onCard = relativeLuminance(card)
  const onBg = relativeLuminance(background)

  for (const name of SERIES) {
    const rgb = token(body, name)
    if (!rgb) {
      console.error(`  \x1b[31mFAIL\x1b[0m  ${theme} --${name} is missing, not oklch(), or outside sRGB`)
      failed++
      continue
    }
    const lum = relativeLuminance(rgb)
    const rCard = contrastRatio(lum, onCard)
    const rBg = contrastRatio(lum, onBg)
    const worst = Math.min(rCard, rBg)
    const ok = worst >= FLOOR
    if (!ok) failed++
    console.log(
      `  ${ok ? '  ok' : '\x1b[31mFAIL\x1b[0m'}  ${theme.padEnd(5)} --${name}  ` +
        `card ${rCard.toFixed(2)}:1  background ${rBg.toFixed(2)}:1`,
    )
  }
}

if (failed > 0) {
  console.error('')
  console.error(`\x1b[31m${failed} contrast problem(s).\x1b[0m`)
  process.exit(1)
}

console.log('')
console.log(`\x1b[32mok\x1b[0m   every accent colour and chart series clears ${FLOOR}:1`)
