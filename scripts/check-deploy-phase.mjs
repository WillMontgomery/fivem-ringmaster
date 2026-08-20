/**
 * The rule that decides when a deploy is finished.
 *
 * WHY THIS IS A GATE. `deployPhase` is the only thing in the console that says
 * an update has landed, and the evidence it works from is a heartbeat from the
 * game server. Getting it wrong is silent and asymmetric in both directions: too
 * eager and the console shows a green tick over a server that is down, which is
 * the exact failure the owner asked to close ("not show that the update is
 * complete until we receive the first heartbeat from br_ringmaster"); too
 * reluctant and it shows a spinner forever over a server that came back fine,
 * which teaches an operator to ignore it.
 *
 * THE THREE PROPERTIES THIS FILE EXISTS TO HOLD:
 *
 *   1. A HEARTBEAT FROM BEFORE THE RESTART DOES NOT COUNT. The deploy verb
 *      returns once `royale-deploy` has kicked the restart off, not once
 *      FXServer has stopped — so the dying process can and does land one more
 *      push AFTER `completedAt`. Timestamps alone cannot tell that from the new
 *      server reporting in; `bootEpoch` can, and must.
 *
 *   2. A HEARTBEAT FROM AFTER IT DOES. A different boot epoch is the game
 *      itself saying "this is a new process", and nothing except the thing we
 *      are asking about can produce it.
 *
 *   3. THE WAIT ENDS. Silence past `RESTART_GRACE_MS` reaches `unconfirmed`, a
 *      stated terminal failure — never `confirming` forever, and never `idle`,
 *      which would be the console quietly deciding a dead server was fine.
 *
 * A PLAIN SCRIPT, matching check-chip-suppression.mjs and check-ban-rule.mjs:
 * this repo has no test framework and adding one to assert two dozen cases
 * would be the larger change. It runs in `npm run verify`.
 *
 * IMPORTED FOR REAL. `src/lib/serverPhase.ts` deliberately imports nothing at
 * runtime — its only import is `import type`, which erases — so tsx loads the
 * actual shipped function and there is no second copy here to drift out of step
 * with it.
 */

import {
  RESTART_GRACE_MS,
  deployPhase,
  heartbeatIsFresh,
  updateInProgress,
} from '../src/lib/serverPhase.ts'

const NOW = 1_700_000_000_000
const SEC = 1_000

/** The process the deploy restarted, and the one that replaced it. */
const OLD = 'boot-1754784000-aaaa'
const NEW = 'boot-1754790000-bbbb'

/** [label, input, expected phase] */
const cases = [
  // ---- Nothing is known. Nothing may be claimed, in either direction. ----
  ['no window at all', { state: null, completedAt: null, lastPushAt: NOW - SEC }, 'idle'],
  ['state undefined (payload predates the field)', { state: undefined, completedAt: undefined, lastPushAt: undefined }, 'idle'],
  ['driver has never read the row', { state: null, completedAt: null, lastPushAt: null }, 'idle'],

  // ---- Server is UP and no deploy has been fired. ----
  ['scheduled', { state: 'scheduled', completedAt: null, lastPushAt: NOW - SEC }, 'idle'],
  ['draining', { state: 'draining', completedAt: null, lastPushAt: NOW - SEC }, 'idle'],
  ['cancelled', { state: 'cancelled', completedAt: null, lastPushAt: NOW - SEC }, 'idle'],
  ['complete but never actually deployed (the update-signal stub row)', { state: 'complete', completedAt: null, lastPushAt: NOW - SEC }, 'idle'],

  // ---- The deploy verb is running. ----
  ['deploying', { state: 'deploying', completedAt: null, lastPushAt: NOW - SEC }, 'deploying'],
  ['deploying, feed still alive for the moment', { state: 'deploying', completedAt: null, lastPushAt: NOW, bootEpoch: OLD }, 'deploying'],
  ['deploying outranks a recorded confirmation from the last window', { state: 'deploying', completedAt: NOW - 60 * SEC, deployConfirmedAt: NOW - 50 * SEC, lastPushAt: NOW }, 'deploying'],

  // =====================================================================
  // PROPERTY 1 — A PRE-RESTART HEARTBEAT MUST NOT SATISFY COMPLETION.
  // Every case here has a push that landed AFTER completedAt and would have
  // read as success under the old `lastPushAt > completedAt` rule alone.
  // =====================================================================
  [
    'the dying server got one more push out AFTER the deploy returned',
    { state: 'complete', completedAt: NOW - 10 * SEC, deployBootEpoch: OLD, bootEpoch: OLD, lastPushAt: NOW - SEC },
    'confirming',
  ],
  [
    'the old process is still pushing happily a minute in',
    { state: 'complete', completedAt: NOW - 60 * SEC, deployBootEpoch: OLD, bootEpoch: OLD, lastPushAt: NOW },
    'confirming',
  ],
  [
    'the old process never stopped, and the grace has now expired',
    { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + SEC), deployBootEpoch: OLD, bootEpoch: OLD, lastPushAt: NOW },
    'unconfirmed',
  ],
  [
    'a push in the same millisecond as the completion proves nothing',
    { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - 10 * SEC },
    'confirming',
  ],

  // =====================================================================
  // PROPERTY 2 — A HEARTBEAT FROM THE NEW PROCESS DOES SATISFY IT.
  // =====================================================================
  [
    'a different boot epoch — the restarted server reporting in',
    { state: 'complete', completedAt: NOW - 10 * SEC, deployBootEpoch: OLD, bootEpoch: NEW, lastPushAt: NOW - SEC },
    'idle',
  ],
  [
    'the new server came back late, past the grace — still a success',
    { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + 60 * SEC), deployBootEpoch: OLD, bootEpoch: NEW, lastPushAt: NOW - SEC },
    'idle',
  ],
  [
    'the verdict was recorded, and the live feed has since died',
    { state: 'complete', completedAt: NOW - 3 * 24 * 3600 * SEC, deployBootEpoch: OLD, deployConfirmedAt: NOW - 3 * 24 * 3600 * SEC, bootEpoch: null, lastPushAt: null },
    'idle',
  ],
  [
    'no epoch was recorded at all — falls back to the timestamp, and a later push counts',
    { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - SEC },
    'idle',
  ],
  [
    'no epoch recorded, no push since — still just waiting',
    { state: 'complete', completedAt: NOW - 10 * SEC, lastPushAt: NOW - 60 * SEC },
    'confirming',
  ],
  [
    'an empty-string epoch is not an epoch, on either side',
    { state: 'complete', completedAt: NOW - 10 * SEC, deployBootEpoch: '', bootEpoch: '', lastPushAt: NOW - SEC },
    'idle',
  ],

  // =====================================================================
  // PROPERTY 3 — THE WAIT ENDS, AND IT ENDS SOMEWHERE AN OPERATOR CAN READ.
  // =====================================================================
  ['silent, just inside the grace', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS - SEC), deployBootEpoch: OLD, bootEpoch: null, lastPushAt: null }, 'confirming'],
  ['silent, one second past the grace', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + SEC), deployBootEpoch: OLD, bootEpoch: null, lastPushAt: null }, 'unconfirmed'],
  ['silent, and it has been three days', { state: 'complete', completedAt: NOW - 3 * 24 * 3600 * SEC, deployBootEpoch: OLD, bootEpoch: null, lastPushAt: null }, 'unconfirmed'],
  ['no feed configured at all, nothing ever heard', { state: 'complete', completedAt: NOW - (RESTART_GRACE_MS + SEC), lastPushAt: null }, 'unconfirmed'],

  // ---- The host refused. A different failure, and it outranks the rest. ----
  ['the deploy verb returned an error', { state: 'complete', completedAt: NOW - 10 * SEC, deployError: 'deploy refused', lastPushAt: NOW - SEC }, 'failed'],
  [
    'a refused deploy never restarted anything, so the old server is still pushing',
    { state: 'complete', completedAt: NOW - 10 * SEC, deployError: 'the game host refused to switch to dev', deployBootEpoch: OLD, bootEpoch: OLD, lastPushAt: NOW },
    'failed',
  ],
  [
    'a refused deploy is not laundered into success by a new epoch either',
    { state: 'complete', completedAt: NOW - 10 * SEC, deployError: 'deploy refused', deployBootEpoch: OLD, bootEpoch: NEW, lastPushAt: NOW },
    'failed',
  ],
  ['an empty error string is not an error', { state: 'complete', completedAt: NOW - 10 * SEC, deployError: '', deployBootEpoch: OLD, bootEpoch: NEW, lastPushAt: NOW }, 'idle'],
]

let failed = 0

for (const [label, input, expected] of cases) {
  const got = deployPhase({ ...input, now: NOW })
  if (got !== expected) {
    failed++
    console.error(`  FAIL  ${label} -> ${got} (expected ${expected})`)
  }
}

/**
 * THE INVARIANT RESTATED AS PROPERTIES, so a future case table cannot drift
 * away from the three sentences at the top of this file.
 */

/**
 * 1. A heartbeat from the SAME process is never proof, whenever it arrived and
 *    however long ago the deploy finished. There is no push schedule that turns
 *    the old server into the new one.
 */
for (const age of [0, SEC, 10 * SEC, 60 * SEC, RESTART_GRACE_MS, 3 * 24 * 3600 * SEC]) {
  for (const push of [NOW, NOW - SEC, NOW - 30 * SEC]) {
    const fresh = heartbeatIsFresh({
      completedAt: NOW - age,
      deployBootEpoch: OLD,
      bootEpoch: OLD,
      lastPushAt: push,
    })
    if (fresh) {
      failed++
      console.error(
        `  FAIL  same-epoch push counted as fresh (completed ${age}ms ago, push at ${push})`,
      )
    }
  }
}

/**
 * 2. A heartbeat from a DIFFERENT process is always proof, whenever it arrived.
 *    Lateness is not disqualifying: a server that took ten minutes still came
 *    back, and the console must say so rather than insisting on its own
 *    deadline.
 */
for (const age of [0, SEC, RESTART_GRACE_MS, 3 * 24 * 3600 * SEC]) {
  const phase = deployPhase({
    state: 'complete',
    completedAt: NOW - age,
    deployBootEpoch: OLD,
    bootEpoch: NEW,
    lastPushAt: NOW - SEC,
    now: NOW,
  })
  if (phase !== 'idle') {
    failed++
    console.error(`  FAIL  new-epoch push did not settle the deploy (completed ${age}ms ago) -> ${phase}`)
  }
}

/**
 * 3. NO SPINNER OUTLIVES THE GRACE. Whatever the inputs, a completed deploy
 *    past `RESTART_GRACE_MS` is never still "in progress" — it has reached one
 *    of the terminal phases, all of which the UI states in words.
 */
for (const deployBootEpoch of [OLD, null, undefined]) {
  for (const bootEpoch of [OLD, null, undefined]) {
    for (const lastPushAt of [null, undefined, NOW, NOW - 10 * 60 * SEC]) {
      const input = {
        state: 'complete',
        completedAt: NOW - (RESTART_GRACE_MS + SEC),
        deployBootEpoch,
        bootEpoch,
        lastPushAt,
        now: NOW,
      }
      if (updateInProgress(input)) {
        failed++
        console.error(
          `  FAIL  still "updating" past the grace: epoch=${deployBootEpoch}/${bootEpoch} push=${lastPushAt}`,
        )
      }
      const phase = deployPhase(input)
      if (phase === 'confirming' || phase === 'deploying') {
        failed++
        console.error(
          `  FAIL  unbounded wait: epoch=${deployBootEpoch}/${bootEpoch} push=${lastPushAt} -> ${phase}`,
        )
      }
    }
  }
}

/**
 * 4. NOT KNOWING CLAIMS NOTHING. With no window information at all, the phase
 *    is `idle` whatever the feed is doing — the console must not announce a
 *    deploy, a success or a failure on the strength of never having looked.
 */
for (const state of [null, undefined]) {
  for (const lastPushAt of [null, undefined, NOW, NOW - 10 * 60 * SEC]) {
    const phase = deployPhase({
      state,
      completedAt: null,
      lastPushAt,
      bootEpoch: NEW,
      now: NOW,
    })
    if (phase !== 'idle') {
      failed++
      console.error(`  FAIL  claimed ${phase} with no window (state=${state})`)
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck:deployphase — ${failed} failure(s)`)
  process.exit(1)
}

console.log(
  `check:deployphase — ${cases.length} cases and 4 properties hold ` +
    `(grace ${RESTART_GRACE_MS / 60_000}m)`,
)
