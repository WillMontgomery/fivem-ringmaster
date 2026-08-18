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

/**
 * The LIFETIME total at which this player reaches their next level.
 *
 * THE CURVE HAS ALWAYS BEEN CUMULATIVE AND THE SCREEN HAS ALWAYS HIDDEN IT.
 * `progress` below returns `into`/`span` — where you are inside the current
 * level, counted from zero every time you level up — and that pair was what
 * the profile rendered. So a player with 18,196 lifetime XP read "1,846 /
 * 3,750" next to a level 8 chip, and asked the obvious question: how can I be
 * level 8 holding less XP than level 3 costs? (owner, 2026-08-17)
 *
 * They could not, and they never were. Both numbers were true and neither was
 * the one being asked for. This is the pair that answers it — 18,196 / 20,100
 * — the same two numbers the level itself is derived from.
 *
 * 0 MEANS THERE IS NO NEXT LEVEL rather than "the next level costs nothing".
 * The alternative was null, and a null here would have to cross into Lua as a
 * nil that every arithmetic caller would have to guard; 0 fails the `> 0` test
 * that the max-level branch needs anyway.
 */
export function nextThresholdFor(xp: number): number {
  const level = levelFor(xp)
  if (level >= MAX_LEVEL) return 0
  return thresholdFor(level + 1)
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

/**
 * Everything about where one lifetime XP total sits on the curve.
 *
 * TWO REPRESENTATIONS OF ONE POSITION, AND BOTH ARE NEEDED — which is exactly
 * why they are returned together rather than from two functions a caller can
 * pick the wrong one of:
 *
 *   `total` / `next`   THE CUMULATIVE PAIR. Lifetime XP, and the lifetime XP
 *                      the next level starts at. This is the owner's model and
 *                      the only pair that means anything on its own: 18,196 /
 *                      20,100 is legible without knowing what level you are.
 *   `into` / `span`    THE BAR'S GEOMETRY. A bar cannot be drawn from the
 *                      cumulative pair — 18,196 out of 20,100 is 90% full at
 *                      level 8 and 99% full at level 50, so every bar past the
 *                      early game would read as nearly done. A bar's zero is
 *                      the level's floor, not the player's first ever match.
 *
 * The two are the same fact: `into === total - thresholdFor(level)` and
 * `next === thresholdFor(level) + span`. `check-xp-curve.mjs` asserts that on
 * every case, because this repo's standing failure is two representations of
 * one thing with nothing checking they agree — and this feature is that shape
 * twice over (per-level vs cumulative here, TypeScript vs Lua across repos).
 */
export function progress(xp: number): {
  level: number
  /** Lifetime XP, clamped at zero. */
  total: number
  /** Lifetime XP at which the next level begins. 0 at max level. */
  next: number
  into: number
  span: number
  pct: number
} {
  // Clamped rather than echoed. A negative total is impossible — the store
  // only ever applies non-negative ADDs — but `levelFor` already answers 1 for
  // it, and returning level 1 alongside `into: -500` would be the two halves
  // of this function disagreeing about the same input.
  const total = xp > 0 ? xp : 0

  const level = levelFor(total)
  if (level >= MAX_LEVEL) {
    return { level, total, next: 0, into: 0, span: 0, pct: 1 }
  }

  const lo = thresholdFor(level)
  const next = thresholdFor(level + 1)
  const span = next - lo
  if (span <= 0) return { level, total, next, into: 0, span: 0, pct: 0 }

  return { level, total, next, into: total - lo, span, pct: (total - lo) / span }
}
