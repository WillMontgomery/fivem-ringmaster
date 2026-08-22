/**
 * Making somebody else's colour safe to put text on.
 *
 * THE PROBLEM IS NOT HYPOTHETICAL. A Discord accent colour is picked by the
 * account holder from the whole 24-bit cube, and plenty of people pick
 * `#ffffff`, `#000000` or something one step away from either. Painting that
 * raw behind a player's name gives you white-on-white for a fraction of players
 * — and the fraction you cannot see is exactly the one you never test with,
 * because your own account looks fine.
 *
 * SO TWO SEPARATE THINGS GO WRONG AND BOTH ARE FIXED HERE:
 *
 *   1. TEXT LEGIBILITY. Solved by deriving the foreground from the background's
 *      relative luminance rather than picking one and hoping. Light backgrounds
 *      get near-black text, dark ones near-white, and the crossover is checked
 *      numerically rather than guessed — see `pickForeground`.
 *
 *   2. SURFACE SEPARATION. A white accent is perfectly legible with black text
 *      and still wrong: the panel dissolves into the white card behind it, and
 *      on the dark theme a black accent does the same. Legibility maths cannot
 *      see this, because it is a relationship with the PAGE and not with the
 *      text. Solved by clamping lightness into a mid band, so an accent surface
 *      is always distinguishable from both themes' backgrounds.
 *
 * CLAMPING CHANGES A COLOUR SOMEBODY CHOSE, and that is a deliberate trade.
 * `#ffffff` renders as `#c7c7c7`; it is recognisably still their (absence of a)
 * colour, and it is a surface rather than a hole. `raw` is kept on the result so
 * anything that wants the untouched value — a swatch, a debug view — can have
 * it, and `clamped` says whether the two differ.
 *
 * WCAG 2.1 relative luminance and contrast ratio. Not because a moderation
 * console is legally obliged to hit AA, but because AA is a number, and "looks
 * fine to me on my monitor" is not.
 */

/** Text/icon colour for a light surface. Not pure black — pure black on a
 *  saturated mid-tone reads as a hole rather than as text. */
const DARK_FG = '#0d0d12'

/** And for a dark surface. Not pure white, for the mirror-image reason. */
const LIGHT_FG = '#f8f8fb'

/**
 * The lightness band an accent surface is allowed to occupy, in HSL.
 *
 * Chosen against the two page backgrounds this console actually has: the light
 * theme's card is `oklch(1 0 0)` (white) and the dark theme's is
 * `oklch(0.185 0.013 285)`. A surface inside [0.22, 0.78] is visibly separated
 * from both without a border doing the work.
 */
const L_MIN = 0.22
const L_MAX = 0.78

/** WCAG AA for normal text. The floor this module guarantees, not a target. */
const TARGET_RATIO = 4.5

/** How far one nudge moves lightness when the clamped colour still misses AA. */
const NUDGE = 0.01

/** Enough nudges to cross the whole range. A bounded loop, not a `while (true)`. */
const MAX_NUDGES = 100

export interface AccentSurface {
  /** What to actually paint. `#rrggbb`, after clamping. */
  background: string
  /** What to write on it. Derived from `background`, never chosen by hand. */
  foreground: string
  /** WCAG contrast of `foreground` on `background`. Never below 4.5. */
  ratio: number
  /** What Discord reported, untouched. */
  raw: string
  /** True when the band or the AA floor moved it — i.e. `raw !== background`. */
  clamped: boolean
}

/** `#rgb`, `#rrggbb` or a bare hex, to three 0-1 channels. Null if it is not one. */
export function parseHex(input: string): [number, number, number] | null {
  const hex = input.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = Number.parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * A 24-bit integer to `#rrggbb`.
 *
 * DISCORD SENDS THE SAME VALUE TWO WAYS — `accent_color: 16716287` and
 * `banner_color: "#ff11ff"` are one colour, not two fields. Everything
 * downstream of this function deals in the hex string, so there is exactly one
 * code path for a colour however it arrived on the wire.
 */
export function hexFromInt(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) return null
  return `#${n.toString(16).padStart(6, '0')}`
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

/** sRGB channel to linear light. The gamma curve, exactly as WCAG defines it. */
function linearise(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(linearise) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two luminances. 1 (identical) to 21 (b/w). */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hueChannel(p: number, q: number, t: number): number {
  const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    hueChannel(p, q, h + 1 / 3),
    hueChannel(p, q, h),
    hueChannel(p, q, h - 1 / 3),
  ]
}

/**
 * Near-black text or near-white text, decided by the surface's luminance.
 *
 * The crossover is not 0.5. Luminance is not perceptual lightness, and the
 * point where black and white text are equally readable on a colour sits near
 * Y = 0.1859 — which is where `contrast(Y, white)` and `contrast(Y, black)`
 * cross for this pair of foregrounds. Rather than hard-code that, both are
 * measured and the better one wins, so changing DARK_FG or LIGHT_FG cannot
 * silently move the boundary out from under the maths.
 */
function pickForeground(bgLum: number): { color: string; lum: number } {
  const dark = { color: DARK_FG, lum: lumOf(DARK_FG) }
  const light = { color: LIGHT_FG, lum: lumOf(LIGHT_FG) }
  return contrastRatio(bgLum, dark.lum) >= contrastRatio(bgLum, light.lum)
    ? dark
    : light
}

function lumOf(hex: string): number {
  const rgb = parseHex(hex)
  // Both constants are literals in this file; a parse failure is a typo, and
  // 0 is the safe answer (it makes the colour look dark, never invisible).
  return rgb ? relativeLuminance(rgb) : 0
}

/**
 * Somebody's accent colour, turned into a surface that can be painted on.
 *
 * Returns null for anything that is not a colour, so callers can ask "did they
 * set one" and "is it usable" with the same check.
 *
 * THE AA GUARANTEE IS REAL AND BOUNDED. After the band clamp, the worst case in
 * the whole 24-bit cube lands a little under 4.5:1 — colours near the
 * black/white crossover are readable with neither foreground — so the surface
 * is nudged away from its chosen text colour until it clears the floor. That
 * loop is why `ratio` can be trusted rather than merely reported: run
 * `scripts/check-contrast.mjs`, which walks every one of the 16,777,216
 * possible accent colours and fails if any of them comes back under 4.5.
 */
export function accentSurface(input: string | null | undefined): AccentSurface | null {
  if (!input) return null
  const rgb = parseHex(input)
  if (!rgb) return null

  const raw = toHex(rgb)
  const [h, s, l0] = rgbToHsl(rgb)

  let l = Math.min(L_MAX, Math.max(L_MIN, l0))
  let background = toHex(hslToRgb(h, s, l))
  let bgLum = relativeLuminance(parseHex(background) as [number, number, number])
  const fg = pickForeground(bgLum)
  let ratio = contrastRatio(bgLum, fg.lum)

  // Push the SURFACE away from its text, not the text away from the surface:
  // the text colour is one of two fixed values and moving it would undo the
  // decision `pickForeground` just made. A step of 0.01 in HSL lightness is
  // invisible one at a time and never runs away, because the loop stops the
  // moment the floor is cleared.
  const towardsLighter = fg.color === DARK_FG
  for (let i = 0; i < MAX_NUDGES && ratio < TARGET_RATIO; i++) {
    const next = towardsLighter ? l + NUDGE : l - NUDGE
    if (next <= 0 || next >= 1) break
    l = next
    background = toHex(hslToRgb(h, s, l))
    bgLum = relativeLuminance(parseHex(background) as [number, number, number])
    // The foreground is NOT re-picked inside the loop. Re-deciding it every
    // step lets a colour oscillate across the crossover forever instead of
    // converging on one side of it.
    ratio = contrastRatio(bgLum, fg.lum)
  }

  return {
    background,
    foreground: fg.color,
    ratio: Math.round(ratio * 100) / 100,
    raw,
    clamped: background !== raw,
  }
}
