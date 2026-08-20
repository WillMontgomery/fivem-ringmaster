/**
 * The rule that decides when the header claims a deploy is under way.
 *
 * WHY THIS IS A GATE. `updateInProgress` is the one expression that puts an
 * "Updating" spinner in the chrome of every page, and the failure mode is
 * silent and asymmetric: a console that claims too eagerly shows a calm amber
 * spinner over a server nobody is deploying to, and one that claims on no
 * evidence at all has invented a deploy.
 *
 * WHAT THIS FILE USED TO GUARD, because the cases below still read that way and
 * they are still the right cases. This rule used to SUPPRESS the feed-health
 * chips — Live, Falling behind, Feed lost — so that a deliberately restarted
 * server did not set off three alarms at once. Those chips are gone (the owner
 * asked for them to be hidden) and the same predicate now decides what the
 * cluster SHOWS instead of what it hides. The polarity of the invariant is
 * unchanged, which is why the table did not have to move: a positive reading
 * makes a claim, and everything else makes none.
 *
 * THE INVARIANT, IN ONE SENTENCE: only a POSITIVE reading of the maintenance
 * window may produce a claim. Not knowing must assert nothing. That is the same
 * rule `refUpdateFrom` enforces by returning `null` and never `0`, and the same
 * one #26 restored on the main-branch reading — an unpolled console must not act
 * as though it had an answer.
 *
 * THE COMPLETION SIDE OF `serverPhase` IS CHECKED NEXT DOOR, in
 * `check-deploy-phase.mjs`: what counts as evidence the server came back, and
 * that the wait for it always ends. This file holds the boolean the header
 * renders from; that one holds the five-state verdict underneath it.
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

/** [label, input, expected] — expected true = the header claims "Updating". */
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
  ['complete, silent, past the grace — the wait has become a stated failure', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + SEC), lastPushAt: null }, false],
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
        `  FAIL  unknown window (state=${state}, lastPushAt=${lastPushAt}) claimed a deploy`,
      )
    }
  }
}

if (failed) {
  console.error(`\nchip suppression: ${failed} case(s) failed.`)
  console.error(
    'Only a stated deploy may put "Updating" in the header — see src/lib/serverPhase.ts',
  )
  process.exit(1)
}
console.log(`chip suppression: ${cases.length} cases match the contract`)
