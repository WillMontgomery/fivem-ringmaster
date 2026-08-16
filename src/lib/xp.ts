/**
 * The level curve — a second implementation of `br_lib/shared/xp.lua`.
 *
 * A DUPLICATE IMPLEMENTATION IS A LIABILITY, and this one is deliberate. The
 * alternative was worse.
 *
 * The game's player row stores BOTH `xp` and `level`. `xp` accumulates through
 * an atomic ADD and is therefore always right. `level` is DERIVED data written
 * at match end from a read-modify-write — so a stale read, a failed fetch or a
 * curve change leaves it disagreeing with the xp sitting beside it. Which is
 * exactly what happened: Ringmaster showed level 2 for a player the lobby
 * showed as level 3, because the lobby derives from xp and this console was
 * trusting the stored field.
 *
 * So: `xp` is the source of truth and the level is computed from it, on both
 * sides. That means the curve has to exist here too, because this console
 * cannot run Lua.
 *
 * WHAT KEEPS THE TWO HONEST is `scripts/check-xp-curve.mjs`, which runs the
 * same fixture cases this file and the Lua file must both satisfy. It is the
 * pattern the ban rule already uses for the same reason — two implementations
 * of one rule, pinned by shared cases rather than by hope. If you change the
 * curve, change it in `br_lib/shared/xp.lua`, mirror it here, and the fixture
 * will tell you if the two disagree.
 */

const BASE = 800
const EXPONENT = 1.55
const MAX_LEVEL = 100

/**
 * Rounded to the nearest 50, matching the Lua.
 *
 * Not cosmetic here: an unrounded port would agree with Lua on most values and
 * disagree on the ones near a boundary, which is the worst possible failure —
 * correct almost always, wrong exactly when somebody is about to level up.
 */
const ROUND_TO = 50

/** Total XP required to have REACHED a given level. */
export function thresholdFor(level: number): number {
  if (level <= 1) return 0
  const raw = BASE * Math.pow(level - 1, EXPONENT)
  return Math.floor(raw / ROUND_TO + 0.5) * ROUND_TO
}

/** The level implied by a total XP value. */
export function levelFor(xp: number): number {
  if (xp <= 0) return 1

  // Walk rather than invert. The Lua inverts the curve and then corrects with
  // two guard loops; a straight walk to 100 is trivially cheap here and cannot
  // land a hair off a boundary the way a floating-point inversion can.
  let level = 1
  while (level < MAX_LEVEL && xp >= thresholdFor(level + 1)) level++
  return level
}

/** Progress through the current level. */
export function progress(xp: number): {
  level: number
  into: number
  span: number
  pct: number
} {
  const level = levelFor(xp)
  if (level >= MAX_LEVEL) return { level, into: 0, span: 0, pct: 1 }

  const lo = thresholdFor(level)
  const span = thresholdFor(level + 1) - lo
  if (span <= 0) return { level, into: 0, span: 0, pct: 0 }

  return { level, into: xp - lo, span, pct: (xp - lo) / span }
}
