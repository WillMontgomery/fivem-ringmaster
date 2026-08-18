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

/*
 * RUN THROUGH `tsx`, NOT BARE NODE, and that is not a preference.
 *
 * This imports a .ts file so the contract is checked against the SAME source
 * the app uses rather than a copy. Node 24 strips types natively and Node 20
 * does not, so running it with `node` passed on my machine and failed in CI on
 * the first run — which is exactly the version-dependent behaviour a contract
 * check must not have. `tsx` makes it the same everywhere.
 */
import { levelFor, nextThresholdFor, progress, thresholdFor } from '../src/lib/xp.ts'

/*
 * THE CUMULATIVE PAIR IS PINNED HERE TOO, and that is the whole point of this
 * revision. These cases used to assert `into`/`span` alone — the offset inside
 * the current level and what that level costs — which is the pair every screen
 * was rendering, and it is not the pair a player is asking about. 18,196 XP
 * showed as "1,846 / 3,750" and the owner reasonably read it as a level 8
 * player holding less lifetime XP than level 3 costs.
 *
 * So each case now carries `next` as well, and the invariants at the bottom
 * assert the two representations are the same fact rather than two facts that
 * happen to be near each other. Pinning one and not the other is how a display
 * ends up disagreeing with the curve underneath it while every test passes.
 */
const CASES = [
  // xp, expected level, expected into-level, expected span, expected next threshold
  [0, 1, 0, 800, 800],
  [1, 1, 1, 800, 800],
  [799, 1, 799, 800, 800],
  [800, 2, 0, 1550, 2350], // exactly on the level-2 threshold
  [801, 2, 1, 1550, 2350],
  [2349, 2, 1549, 1550, 2350], // one short of level 3
  [2350, 3, 0, 2050, 4400], // exactly on it
  [2498, 3, 148, 2050, 4400], // the value that exposed the stored-level bug
  [4399, 3, 2049, 2050, 4400],
  [4400, 4, 0, 2450, 6850],

  // THE OWNER'S OWN PROFILE (2026-08-17). The reported reading was level 8 and
  // "1,846 / 3,750", which is this total. Level 8 begins at 16,350 and costs
  // 3,750, so 16,350 + 1,846 = 18,196 and the next level begins at 20,100 —
  // the curve was right and the label was wrong. Pinned by the exact numbers
  // that were reported so the report itself is now a regression test.
  [18196, 8, 1846, 3750, 20100],

  // The top of the curve, both sides of it. `next` is 0 at max level rather
  // than a threshold that does not exist, and the display has to branch on it:
  // the old code rendered max level as "0 / 0".
  [991549, 99, 15449, 15450, 991550],
  [991550, 100, 0, 0, 0],

  // Negative totals are impossible through the store, which only ever applies
  // non-negative ADDs — but `levelFor` clamps and `progress` has to clamp with
  // it, or one function answers level 1 while the other answers into: -500.
  [-500, 1, 0, 800, 800],
]

/*
 * THE FIRST TEN, not the first five. These are the numbers quoted to the owner
 * when the curve was explained, so they are the numbers that have to still be
 * true — a curve tuning that moves level 7 is a curve tuning that moves who is
 * level 7, and it should fail here rather than on someone's profile.
 */
const THRESHOLDS = [
  [1, 0],
  [2, 800],
  [3, 2350],
  [4, 4400],
  [5, 6850],
  [6, 9700],
  [7, 12850],
  [8, 16350],
  [9, 20100],
  [10, 24100],
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

for (const [xp, level, into, span, next] of CASES) {
  const gotLevel = levelFor(xp)
  const p = progress(xp)

  if (gotLevel !== level) {
    console.error(`levelFor(${xp}) = ${gotLevel}, expected ${level}`)
    failed++
  }
  if (p.into !== into || p.span !== span) {
    console.error(
      `progress(${xp}) into/span = ${p.into}/${p.span}, expected ${into}/${span}`,
    )
    failed++
  }

  // THE PAIR THE PLAYER READS. `total`/`next` is what a profile renders, and
  // it is asserted separately from into/span rather than derived from it here
  // — a check that recomputed the expectation from the same code under test
  // would pass no matter what that code did.
  if (p.next !== next) {
    console.error(`progress(${xp}).next = ${p.next}, expected ${next}`)
    failed++
  }
  if (nextThresholdFor(xp) !== next) {
    console.error(
      `nextThresholdFor(${xp}) = ${nextThresholdFor(xp)}, expected ${next}`,
    )
    failed++
  }
  if (p.total !== Math.max(0, xp)) {
    console.error(`progress(${xp}).total = ${p.total}, expected ${Math.max(0, xp)}`)
    failed++
  }
}

/*
 * THE TWO REPRESENTATIONS ARE ONE FACT, asserted across the whole curve rather
 * than at the handful of totals above.
 *
 * This is the check the feature was missing. The cumulative pair and the bar's
 * per-level pair describe the same position, and nothing anywhere said so — so
 * the profile could render one while the level came from the other and every
 * test still passed. That is this project's standing failure in miniature, and
 * it is what let "level 8, 1,846 / 3,750" ship.
 */
for (let xp = 0; xp <= 1_100_000; xp += 617) {
  const p = progress(xp)
  const floor = thresholdFor(p.level)

  // MAX LEVEL IS A DIFFERENT CONTRACT AND HAS TO BE STATED AS ONE.
  //
  // The first version of this sweep asserted `into === total - floor`
  // everywhere and failed at 992,136 — in BOTH repos, at the identical total,
  // which is the fixture doing its job. Past 991,550 a player keeps earning XP
  // and `into` stays 0, because there is no level to be part-way through. That
  // is deliberate: `into`/`span` is bar geometry, and there is no bar up there.
  // The cumulative pair is the one that stays meaningful, and it is the reason
  // the profile now renders "1,014,300 / max" rather than "0 / 0".
  if (p.next === 0) {
    if (p.level !== 100 || p.into !== 0 || p.span !== 0 || p.pct !== 1) {
      console.error(
        `at ${xp}: max level should be 100/0/0/1, got ${p.level}/${p.into}/${p.span}/${p.pct}`,
      )
      failed++
      break
    }
    if (p.total < thresholdFor(100)) {
      console.error(`at ${xp}: no next level below the level-100 threshold`)
      failed++
      break
    }
    continue
  }

  if (p.into !== p.total - floor) {
    console.error(
      `at ${xp}: into ${p.into} != total ${p.total} - floor ${floor}`,
    )
    failed++
    break
  }
  if (p.next !== floor + p.span) {
    console.error(
      `at ${xp}: next ${p.next} != floor ${floor} + span ${p.span}`,
    )
    failed++
    break
  }
  // The cumulative pair has to bracket the total, or "18,196 / 20,100" is not
  // a statement about where this player is.
  if (!(p.total >= floor && p.total < p.next)) {
    console.error(`at ${xp}: total ${p.total} outside [${floor}, ${p.next})`)
    failed++
    break
  }
  if (levelFor(p.next) !== p.level + 1) {
    console.error(
      `at ${xp}: next ${p.next} is level ${levelFor(p.next)}, expected ${p.level + 1}`,
    )
    failed++
    break
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
