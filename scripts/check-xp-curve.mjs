/**
 * The level curve exists twice — here and in `br_lib/shared/xp.lua` — because
 * this console cannot run Lua and the game cannot run TypeScript.
 *
 * These cases are the contract between them. The same list lives in the game
 * repo's `tools/test_stats.lua`, and both must satisfy it. Same arrangement as
 * the ban rule, for the same reason: two implementations of one rule are only
 * safe when something fails loudly the moment they disagree.
 *
 * THE BOUNDARY CASES ARE THE POINT. An unrounded port agrees with the Lua on
 * most values and diverges near a threshold — correct almost always, wrong
 * exactly when somebody is about to level up.
 */

import { levelFor, progress, thresholdFor } from '../src/lib/xp.ts'

const CASES = [
  // xp, expected level, expected into-level, expected span
  [0, 1, 0, 800],
  [1, 1, 1, 800],
  [799, 1, 799, 800],
  [800, 2, 0, 1550], // exactly on the level-2 threshold
  [801, 2, 1, 1550],
  [2349, 2, 1549, 1550], // one short of level 3
  [2350, 3, 0, 2050], // exactly on it
  [2498, 3, 148, 2050], // the value that exposed the stored-level bug
  [4399, 3, 2049, 2050],
  [4400, 4, 0, 2450],
]

const THRESHOLDS = [
  [1, 0],
  [2, 800],
  [3, 2350],
  [4, 4400],
  [5, 6850],
]

let failed = 0

for (const [level, expected] of THRESHOLDS) {
  const got = thresholdFor(level)
  if (got !== expected) {
    console.error(`thresholdFor(${level}) = ${got}, expected ${expected}`)
    failed++
  }
  if (got % 50 !== 0) {
    console.error(`thresholdFor(${level}) = ${got} is not a multiple of 50`)
    failed++
  }
}

for (const [xp, level, into, span] of CASES) {
  const gotLevel = levelFor(xp)
  const p = progress(xp)

  if (gotLevel !== level) {
    console.error(`levelFor(${xp}) = ${gotLevel}, expected ${level}`)
    failed++
  }
  if (p.into !== into || p.span !== span) {
    console.error(
      `progress(${xp}) = ${p.into}/${p.span}, expected ${into}/${span}`,
    )
    failed++
  }
}

// Monotonic, because a curve that ever goes backwards would let a player lose a
// level by earning XP — and rounding is exactly the kind of change that could
// do it if the step ever grew past the gap between two levels.
for (let l = 2; l <= 100; l++) {
  if (thresholdFor(l) <= thresholdFor(l - 1)) {
    console.error(`thresholdFor(${l}) is not greater than thresholdFor(${l - 1})`)
    failed++
    break
  }
}

if (failed > 0) {
  console.error(`\nxp curve: ${failed} case(s) failed`)
  process.exit(1)
}

console.log(`xp curve: ${CASES.length + THRESHOLDS.length} cases match the contract`)
