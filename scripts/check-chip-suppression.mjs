/**
 * The rule that decides when the header stops showing health chips.
 *
 * WHY THIS IS A GATE. `updateInProgress` is the only thing in the console that
 * HIDES information about whether the live feed is arriving. Hiding it is right
 * during a deploy — "Feed lost" over a server we deliberately restarted is a
 * false alarm — and wrong every other time, because the chip it suppresses is
 * the one an operator relies on to notice that the game has gone quiet. The
 * failure mode is silent and asymmetric: a console that suppresses too eagerly
 * looks calm while the server is down, and nobody discovers it until the day it
 * matters.
 *
 * THE INVARIANT, IN ONE SENTENCE: only a POSITIVE reading of the maintenance
 * window may suppress. Not knowing must always show more, never less. That is
 * the same rule `refUpdateFrom` enforces by returning `null` and never `0`, and
 * the same one #26 restored on the main-branch reading — an unpolled console
 * must not act as though it had an answer.
 *
 * A PLAIN SCRIPT, matching check-ban-rule.mjs: this repo has no test framework
 * and adding one to assert a dozen cases would be the larger change. It runs in
 * `npm run verify`.
 *
 * IMPORTED FOR REAL, unlike the ban rule's hand-copy. `src/lib/serverPhase.ts`
 * deliberately imports nothing at runtime — its only import is `import type`,
 * which erases — so tsx can load the actual shipped function and there is no
 * second copy here to drift out of step with it.
 */

import { RESTART_GRACE_MS, updateInProgress } from '../src/lib/serverPhase.ts'

const NOW = 1_700_000_000_000
const SEC = 1_000

/** [label, input, expected] — expected true = health chips suppressed. */
const cases = [
  // ---- Nothing is known. Every one of these MUST show the chips. ----
  ['no window at all', { state: null, completedAt: null, lastPushAt: NOW - SEC }, false],
  ['state undefined (payload predates the field)', { state: undefined, completedAt: undefined, lastPushAt: NOW - SEC }, false],
  ['driver has never read the row, feed also silent', { state: null, completedAt: null, lastPushAt: null }, false],
  ['no window and no feed ever — the cold console', { state: undefined, completedAt: undefined, lastPushAt: undefined }, false],

  // ---- Server is UP; its health is exactly what the operator wants. ----
  ['scheduled — nothing has happened yet', { state: 'scheduled', completedAt: null, lastPushAt: NOW - SEC }, false],
  ['draining — players still on, health matters most', { state: 'draining', completedAt: null, lastPushAt: NOW - SEC }, false],
  ['draining and the feed has died — must NOT be hidden', { state: 'draining', completedAt: null, lastPushAt: NOW - 120 * SEC }, false],
  ['cancelled', { state: 'cancelled', completedAt: null, lastPushAt: NOW - SEC }, false],

  // ---- The deploy is running. The one unconditional yes. ----
  ['deploying', { state: 'deploying', completedAt: null, lastPushAt: NOW - SEC }, true],
  ['deploying, feed still alive for the moment', { state: 'deploying', completedAt: null, lastPushAt: NOW }, true],

  // ---- Deploy finished; "complete" is the verb returning, not the server back. ----
  ['complete, server has not spoken since', { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - 60 * SEC }, true],
  ['complete, no feed at all yet', { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: null }, true],
  ['complete AND a push landed after it — it is back', { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - SEC }, false],
  ['a push in the same millisecond proves nothing', { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - 10 * SEC }, true],

  // ---- The grace bound: silence stops being excused. ----
  ['complete, silent, just inside the grace', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS - SEC), lastPushAt: null }, true],
  ['complete, silent, past the grace — let Feed lost speak', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + SEC), lastPushAt: null }, false],
  ['an old completed window from days ago', { state: 'complete', completedAt: NOW - 3 * 24 * 3600 * SEC, lastPushAt: NOW - SEC }, false],
  ['old completed window, feed dead for days', { state: 'complete', completedAt: NOW - 3 * 24 * 3600 * SEC, lastPushAt: NOW - 2 * 24 * 3600 * SEC }, false],
]

let failed = 0
for (const [label, input, expected] of cases) {
  const got = updateInProgress({ ...input, now: NOW })
  if (got !== expected) {
    failed++
    console.error(`  FAIL  ${label} -> ${got} (expected ${expected})`)
  }
}

/**
 * The invariant restated as a property, so a future case table cannot drift
 * away from the sentence at the top of this file: with no window information at
 * all, NOTHING may be suppressed, whatever the feed is doing.
 */
for (const lastPushAt of [null, undefined, NOW, NOW - 10 * 60 * SEC]) {
  for (const state of [null, undefined]) {
    if (updateInProgress({ state, completedAt: null, lastPushAt, now: NOW })) {
      failed++
      console.error(
        `  FAIL  unknown window (state=${state}, lastPushAt=${lastPushAt}) suppressed the health chips`,
      )
    }
  }
}

if (failed) {
  console.error(`\nchip suppression: ${failed} case(s) failed.`)
  console.error('Only a stated deploy may hide the feed chips — see src/lib/serverPhase.ts')
  process.exit(1)
}
console.log(`chip suppression: ${cases.length} cases match the contract`)
