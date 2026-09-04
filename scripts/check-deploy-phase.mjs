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
 *
 * ------------------------------------------------------------------------
 * IT NOW ALSO HOLDS THE RULE THAT DECIDES WHEN A DEPLOY MAY BE ASKED FOR,
 * ------------------------------------------------------------------------
 * which is the other end of the same life: this file already owned "when is a
 * deploy finished", and the second half is "may it start at all". They are one
 * subject and two gates would have to be kept in step by hand.
 *
 * WHAT THAT SECOND HALF IS. The game box refuses to deploy a ref that changes
 * `tools/dispatch.sh` and says so, per branch, in a sentence written for a
 * human. The branch picker has consumed that since it was built. "Schedule
 * update" — the OTHER path, which deploys new commits on the branch the box is
 * already on — never did, because no branch is being picked there and nothing
 * consulted eligibility. A branch can be ahead AND refused at the same time,
 * and when it was, the console scheduled the deploy and the refusal turned up
 * on the box, from a systemd unit, in a log.
 *
 * AND IT ASSERTS THE CALL SITES, NOT ONLY THE PREDICATE. This repo has twice
 * had a change pass every check while the component wired a correct function
 * up wrongly — which is precisely what this bug WAS: `refUpdateFrom` held
 * `eligible` and `blockedBy` in a local and dropped them one line before
 * anything needed them, and every pure function in the console stayed correct
 * throughout. So the source of the update control and of the route that accepts
 * its request are read as text below, and a button that stops reading the flag
 * fails here rather than in a playtest.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { refBehindNow, refBlockedNow, nothingToDeploy } from '../src/lib/maintenance.ts'
import {
  RESTART_GRACE_MS,
  deployPhase,
  heartbeatIsFresh,
  updateInProgress,
} from '../src/lib/serverPhase.ts'
import { refUpdateFrom } from '../src/lib/ssh.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

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
  ['deploying', { state: 'deploying', deployStartedAt: NOW - 10 * SEC, completedAt: null, lastPushAt: NOW - SEC }, 'deploying'],
  ['deploying, feed still alive for the moment', { state: 'deploying', deployStartedAt: NOW - 10 * SEC, completedAt: null, lastPushAt: NOW, bootEpoch: OLD }, 'deploying'],
  ['deploying outranks a recorded confirmation from the last window', { state: 'deploying', deployStartedAt: NOW - 10 * SEC, completedAt: NOW - 60 * SEC, deployConfirmedAt: NOW - 50 * SEC, lastPushAt: NOW }, 'deploying'],
  ['deploying, just inside the grace', { state: 'deploying', deployStartedAt: NOW - (RESTART_GRACE_MS - SEC), completedAt: null, lastPushAt: null }, 'deploying'],

  // =====================================================================
  // THE HANG — `deploying` WAS THE ONE PHASE WITH NO CLOCK ON IT.
  //
  // The driver writes `markDeploying`, runs the deploy, and only then writes
  // `markComplete`, with an audit write and an SSH round trip in between.
  // Anything that stopped it reaching that last write — a throttled audit
  // table, an OOM, `systemctl restart ringmaster` landing mid-deploy, or the
  // completion write itself being refused — left the row in `deploying`, and
  // nothing else could ever move it: the tick returned early on every state
  // that is not `draining`, and `expiresAt` was written on host-patch rows
  // alone.
  //
  // WHAT THAT BOUGHT IS THE POINT. `silenceIsExplained` says yes to
  // `deploying`, so `/api/health` skipped the feed axis and answered 200 over
  // a feed that had been dead for hours; the collector reads that phase off
  // the payload and withheld its own feed-dead datum to match; and
  // `isDraining` returns true for `deploying`, so the game refused every
  // player for the whole of it. Every case here carries a start time, because
  // `markDeploying` has always written one.
  // =====================================================================
  ['THE HANG: one second past the grace is a stated failure, not a spinner', { state: 'deploying', deployStartedAt: NOW - (RESTART_GRACE_MS + SEC), completedAt: null, lastPushAt: null }, 'unconfirmed'],
  ['a deploy stuck since the day before yesterday', { state: 'deploying', deployStartedAt: NOW - 2 * 24 * 3600 * SEC, completedAt: null, lastPushAt: null }, 'unconfirmed'],
  [
    'stuck deploying while the game pushes happily — the row is wrong, not the server',
    { state: 'deploying', deployStartedAt: NOW - (RESTART_GRACE_MS + SEC), completedAt: null, bootEpoch: NEW, lastPushAt: NOW },
    'unconfirmed',
  ],

  /**
   * AND NOT KNOWING WHEN IT STARTED STILL SHOWS LESS, which is this file's
   * standing polarity. A `/api/state` payload older than the field carries no
   * start time — a browser tab left open across a console deploy — and the
   * console must not announce a failure on the strength of never having been
   * told. Both surfaces where the bound is load-bearing, `/api/health` and
   * `AppShell`, read the DynamoDB row itself and always have it.
   */
  ['a deploying row with no start time is not known to be stuck', { state: 'deploying', deployStartedAt: null, completedAt: null, lastPushAt: NOW - SEC }, 'deploying'],
  ['start time absent entirely, as an older payload sends it', { state: 'deploying', completedAt: null, lastPushAt: NOW - SEC }, 'deploying'],

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 4b. NO PHASE THAT EXCUSES SILENCE IS A FIXED POINT.
 *
 * THE PROPERTY THAT WOULD HAVE CAUGHT THE HANG, AND IT IS A DIFFERENT SHAPE
 * FROM PROPERTY 3. Property 3 sweeps the inputs at ONE instant past the grace
 * and only over `complete` rows — every one of its loops varies age through
 * `completedAt`, which is the clock the `deploying` branch never read. So it
 * proved the bound on the half that had one and said nothing about the half
 * that did not.
 *
 * THIS SWEEPS TIME INSTEAD. For every state a row can be stuck in, an
 * ADVANCING `now` over a row that is not changing must eventually stop
 * excusing the silence — because `silenceIsExplained` is what `/api/health`
 * consults, what the collector reads off the payload, and what `chipCluster`
 * rung 1 hides the feed chip on. A phase that never leaves the excusing set is
 * a permanent, estate-wide mute with no alarm anywhere behind it.
 *
 * IT IS WRITTEN OVER `MaintenanceState` RATHER THAN OVER `DeployPhase` on
 * purpose: the fixed point that shipped was a STATE nothing advanced, and a
 * sweep over phases would have re-derived the same answer from the same
 * function. A sixth state added tomorrow is covered by this loop the day it
 * exists.
 * ═══════════════════════════════════════════════════════════════════════════
 */
{
  const STATES = ['scheduled', 'draining', 'deploying', 'complete', 'cancelled']
  /** A row frozen at NOW, read again a long time later. Nothing about it moves. */
  const LATER = NOW + 30 * 24 * 3600 * SEC

  for (const state of STATES) {
    for (const deployError of [null, 'deploy refused']) {
      for (const bootEpoch of [OLD, null]) {
        const input = {
          state,
          deployStartedAt: NOW,
          completedAt: state === 'complete' ? NOW : null,
          deployError,
          deployBootEpoch: OLD,
          bootEpoch,
          lastPushAt: bootEpoch === null ? null : NOW,
          now: LATER,
        }
        const phase = deployPhase(input)
        if (updateInProgress(input)) {
          failed++
          console.error(
            `  FAIL  state \`${state}\` still excuses the silence a month later ` +
              `(phase ${phase}, error=${deployError}, epoch=${bootEpoch}) — a loading ` +
              'state with no exit is a hang, and this one mutes every alarm in the estate',
          )
        }
      }
    }
  }

  /**
   * AND THE EXIT IS AT THE GRACE, NOT MERELY SOMEWHERE. A sweep across the
   * boundary, one row, one advancing clock: excused up to it, never after it.
   */
  const started = NOW - RESTART_GRACE_MS
  for (const offset of [-2 * SEC, -SEC, 0, SEC, 2 * SEC, 60 * SEC]) {
    const now = NOW + offset
    const excused = updateInProgress({
      state: 'deploying',
      deployStartedAt: started,
      completedAt: null,
      lastPushAt: null,
      now,
    })
    const shouldExcuse = now - started < RESTART_GRACE_MS
    if (excused !== shouldExcuse) {
      failed++
      console.error(
        `  FAIL  a deploying row ${now - started}ms old reads excused=${excused}, ` +
          `expected ${shouldExcuse} (grace ${RESTART_GRACE_MS}ms)`,
      )
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 4c. THE CLOCK IS WRITTEN, AND IT REACHES THE READERS THAT NEED IT.
 *
 * THE BOUND ABOVE IS ONLY AS REAL AS THE FIELD IT READS. `deployStartedAt` is
 * optional in `DeployPhaseInput` — it has to be, so an older `/api/state`
 * payload reads as "not known" rather than as a failure — which means a call
 * site that simply stopped passing it would silently restore the unbounded
 * `deploying` this whole section exists to close, and every case table above
 * would still pass. So the writer and the three readers that hold the row are
 * read as text, the way this file already reads the deploy button.
 * ═══════════════════════════════════════════════════════════════════════════
 */
{
  if (!/'deployStartedAt = :t'/.test(read('src/lib/maintenance.ts'))) {
    failed++
    console.error(
      '  FAIL  markDeploying no longer writes deployStartedAt — the deploying phase ' +
        'has no clock on the row, so nothing can ever bound it',
    )
  }

  /**
   * `/api/health` FIRST, BECAUSE IT IS THE ONE THAT PAGES NOBODY. Its `deploy`
   * field is what the external collector suppresses its feed-dead datum on, so
   * a route that stops passing the clock mutes two repositories at once.
   */
  for (const [path, what] of [
    ['src/app/api/health/route.ts', 'the external health payload'],
    ['src/components/AppShell.tsx', "the header's server-rendered phase"],
    ['src/lib/livePoll.ts', 'the browser poll'],
    ['src/app/api/state/route.ts', 'the payload the browser poll reads'],
  ]) {
    if (!/deployStartedAt/.test(read(path))) {
      failed++
      console.error(
        `  FAIL  ${path} does not carry deployStartedAt, so ${what} cannot bound ` +
          '`deploying` and will excuse a dead feed for ever',
      )
    }
  }

  /**
   * AND THE ROW ITSELF IS SETTLED, NOT ONLY REPORTED ON. The phase bound fixes
   * what every surface SAYS; `isDraining` reads the stored STATE, so only a
   * write reopens the door the stuck row is holding shut.
   */
  const driver = read('src/lib/maintenanceDriver.ts')
  if (!/w\.state === 'deploying'[\s\S]{0,200}RESTART_GRACE_MS/.test(driver)) {
    failed++
    console.error(
      '  FAIL  maintenanceDriver has no recovery arm for a deploying row past its grace — ' +
        'isDraining returns true for `deploying`, so the game refuses every player ' +
        'until somebody edits DynamoDB by hand',
    )
  }
  if (/markComplete\([^)]*\)\.catch\(\(\) => \{\}\)/.test(driver)) {
    failed++
    console.error(
      '  FAIL  the driver swallows markComplete\'s failure again. It is the only write ' +
        'that ends a deploy; refused silently, the row stays `deploying` for ever',
    )
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OTHER GATE: MAY A DEPLOY START AT ALL?
 *
 * `refBlockedNow` answers with the sentence the game box would refuse with, or
 * null for "go ahead". The two spellings that matter are asserted below rather
 * than described:
 *
 *   `=== false`, NEVER `!eligible` — a dispatcher too old to answer sends no
 *   field, and folding its silence in with a stated refusal would grey out the
 *   console's only ordinary deploy button against every game host predating the
 *   feature. That is #146's shape.
 *
 *   STALENESS IS NOT CONSULTED, which is the opposite of `refBehindNow`. A
 *   stale zero is an absence and must not refuse; a refusal is a presence the
 *   box wrote about code it has read, and `deploy.sh` will repeat it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The sentence the game box actually printed, the night this was found. */
const BLOCKED =
  "it changes tools/dispatch.sh. Deploying it would replace the console's " +
  'only channel to this box with code that has not been through PR review.'

/** A parked-branch reading, as the telemetry poller holds one. */
const reading = (over = {}) => ({
  ref: 'dev',
  behind: 3,
  tipSha: 'b'.repeat(40),
  deployedSha: 'a'.repeat(40),
  eligible: true,
  blockedBy: '',
  stale: false,
  at: NOW,
  ...over,
})

/** [label, deployedRef, reading, expected] — expected null = the deploy may go. */
const blockCases = [
  // ---- Nothing is known. Nothing may be refused on the strength of it. ----
  ['no reading at all', 'dev', null, null],
  ['reading undefined', 'dev', undefined, null],
  ['the host has not named its ref', null, reading(), null],
  ['no ref named, and the reading in hand is a refusal', null, reading({ eligible: false, blockedBy: BLOCKED }), null],
  ['ref named as undefined', undefined, reading({ eligible: false, blockedBy: BLOCKED }), null],
  /**
   * NEITHER SIDE NAMES A REF, AND THE PAIRING TEST ALONE WOULD PASS IT. Two
   * absent names compare equal, so a reading with no ref on it would be treated
   * as belonging to a host that has not named one — and a refusal would apply to
   * a branch nobody has identified. `typeof deployedRef !== 'string'` is what
   * stops that, and this is the only case that can tell it apart from the
   * pairing test sitting under it.
   */
  ['neither side names a ref at all', null, { ref: null, behind: 3, stale: false, eligible: false, blockedBy: BLOCKED }, null],

  // ---- Main is not covered, and does not need to be: the rule is measured
  //      against main, so main cannot be blocked against itself. ----
  ['on main', 'main', reading({ ref: 'main' }), null],
  ['on main, with a refusal somehow attached to it', 'main', reading({ ref: 'main', eligible: false, blockedBy: BLOCKED }), null],

  // ---- The ordinary parked cases. ----
  ['parked and behind, and the box will take it', 'dev', reading(), null],
  ['parked and level, and the box will take it', 'dev', reading({ behind: 0 }), null],

  // ---- THE BUG. Ahead AND refused, which is one state, not two. ----
  ['THE BUG: three commits waiting on a branch the box refuses', 'dev', reading({ eligible: false, blockedBy: BLOCKED }), BLOCKED],
  ['refused and level with its branch', 'dev', reading({ behind: 0, eligible: false, blockedBy: BLOCKED }), BLOCKED],

  // ---- Staleness does not soften a stated refusal. ----
  ['refused, from refs the box admits are stale', 'dev', reading({ stale: true, eligible: false, blockedBy: BLOCKED }), BLOCKED],
  ['refused, stale, and level — every softener at once', 'dev', reading({ stale: true, behind: 0, eligible: false, blockedBy: BLOCKED }), BLOCKED],

  // ---- The pairing rule: a reading taken for another branch is not one. ----
  ['the refusal belongs to the branch we just switched off', 'dev', reading({ ref: 'feature/loot-v2', eligible: false, blockedBy: BLOCKED }), null],
  ['and an eligible reading for another branch clears nothing either', 'feature/loot-v2', reading({ ref: 'dev' }), null],

  // ---- ONLY A STATED REFUSAL. An unanswered question is not one. ----
  ['a dispatcher too old to answer sends neither field', 'dev', { ref: 'dev', behind: 3, stale: false }, null],
  ['eligible arrived as JSON null', 'dev', reading({ eligible: null, blockedBy: BLOCKED }), null],
  ['a leftover sentence on an eligible branch is not a refusal', 'dev', reading({ blockedBy: BLOCKED }), null],

  // ---- An empty string is still a refusal. null is the only "go ahead". ----
  ['refused with no sentence at all', 'dev', reading({ eligible: false, blockedBy: '' }), ''],
  ['refused with no field for a sentence', 'dev', { ref: 'dev', behind: 3, stale: false, eligible: false }, ''],
]

for (const [label, ref, ru, expected] of blockCases) {
  const got = refBlockedNow(ref, ru)
  if (got !== expected) {
    failed++
    console.error(
      `  FAIL  ${label} -> ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`,
    )
  }
}

/**
 * 5. ONLY A STATED REFUSAL REFUSES. Every other value `eligible` can arrive as
 *    — including the two an older dispatcher produces — leaves the deploy
 *    available. `!eligible` passes the table above on its own; it dies here.
 */
for (const eligible of [true, undefined, null, 0, 1, '', 'false', 'no']) {
  const got = refBlockedNow('dev', reading({ eligible, blockedBy: BLOCKED }))
  if (got !== null) {
    failed++
    console.error(
      `  FAIL  eligible=${JSON.stringify(eligible)} refused a deploy — only \`false\` may`,
    )
  }
}

/**
 * 6. AND A STATED REFUSAL IS NEVER SOFTENED. Whatever the count, however stale
 *    the read, `eligible: false` is the box telling us it will not take this —
 *    and it is the same sentence back, unedited, every time.
 */
for (const behind of [0, 1, 3, 17]) {
  for (const stale of [true, false]) {
    const got = refBlockedNow('dev', reading({ behind, stale, eligible: false, blockedBy: BLOCKED }))
    if (got !== BLOCKED) {
      failed++
      console.error(
        `  FAIL  a refusal was softened (behind=${behind}, stale=${stale}) -> ${JSON.stringify(got)}`,
      )
    }
  }
}

/**
 * 7. THE VERDICT IS NEVER TAKEN FROM ANOTHER BRANCH'S READING. Between a switch
 *    landing and the next two-minute `branches` answer, `deployedRef` names the
 *    new branch while the reading still describes the old one — and refusing the
 *    new branch on the old one's verdict is the same mislabelling every reading
 *    on this page is guarded against, in a more expensive place.
 */
for (const deployedRef of ['dev', 'main', 'feature/loot-v2', 'release/1.4.0']) {
  for (const ref of ['dev', 'main', 'feature/loot-v2', 'release/1.4.0']) {
    if (ref === deployedRef) continue
    const got = refBlockedNow(deployedRef, reading({ ref, eligible: false, blockedBy: BLOCKED }))
    if (got !== null) {
      failed++
      console.error(
        `  FAIL  a refusal for ${ref} was applied to ${deployedRef} -> ${JSON.stringify(got)}`,
      )
    }
  }
}

/**
 * 8. "AHEAD" AND "DEPLOYABLE" ARE TWO QUESTIONS, AND THE CARD ANSWERS ONE WHILE
 *    THE BUTTON ANSWERS THE OTHER.
 *
 *    THIS IS THE WHOLE BUG AS A PROPERTY. On the exact reading that produced it
 *    — three commits waiting on a branch the box refuses — `refBehindNow` must
 *    still say 3 and `nothingToDeploy` must still return null, because the card
 *    has to RENDER: it is the only place the reason can be read. If a future
 *    change folds eligibility into `nothingToDeploy`, the card vanishes and the
 *    operator is left with the same silence they started with, minus a control.
 */
{
  const bug = reading({ eligible: false, blockedBy: BLOCKED })
  if (refBehindNow('dev', bug) !== 3) {
    failed++
    console.error('  FAIL  a refused branch stopped reporting how far behind it is')
  }
  if (nothingToDeploy({ behindMain: null, deployedRef: 'dev', refUpdate: bug, changingRef: false }) !== null) {
    failed++
    console.error('  FAIL  a refused branch took the scheduling card off the page — the reason has nowhere left to live')
  }
  if (refBlockedNow('dev', bug) !== BLOCKED) {
    failed++
    console.error('  FAIL  the refusal did not survive alongside the count')
  }
}

/**
 * 9. THE FIELDS SURVIVE THE TRIP OUT OF THE `branches` ANSWER.
 *
 *    THE DEFECT ITSELF, ASSERTED AT ITS ORIGIN. `refUpdateFrom` finds the
 *    `HostBranch` row for the deployed ref and builds a `RefUpdate` from it. It
 *    used to take `ahead` and `sha` off that row and drop `eligible`/`blockedBy`
 *    on the floor one line before anything needed them — so the console held the
 *    refusal on the wire, in memory, and threw it away in the one function every
 *    consumer of it reads through. Every pure function stayed correct.
 */
{
  const answer = {
    ok: true,
    stale: false,
    deployedSha: 'a'.repeat(40),
    deployedRef: 'dev',
    branches: [
      { name: 'main', sha: 'c'.repeat(40), ahead: 9, behind: 0, tipAt: NOW, tipAuthor: 'w', subject: 's', eligible: true, blockedBy: '' },
      { name: 'dev', sha: 'b'.repeat(40), ahead: 3, behind: 0, tipAt: NOW, tipAuthor: 'w', subject: 's', eligible: false, blockedBy: BLOCKED },
    ],
  }
  const ru = refUpdateFrom(answer, NOW)
  if (!ru || ru.eligible !== false || ru.blockedBy !== BLOCKED) {
    failed++
    console.error(
      '  FAIL  refUpdateFrom dropped the eligibility the branch row carried — ' +
        `got ${JSON.stringify(ru && { eligible: ru.eligible, blockedBy: ru.blockedBy })}`,
    )
  }
  if (refBlockedNow('dev', ru) !== BLOCKED) {
    failed++
    console.error('  FAIL  the refusal did not survive branches -> refUpdateFrom -> refBlockedNow')
  }

  /** And an eligible branch comes through the same path saying nothing. */
  const fine = refUpdateFrom({ ...answer, deployedRef: 'main' }, NOW)
  if (fine !== null) {
    failed++
    console.error('  FAIL  refUpdateFrom answered for main, which it must never do')
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 10. THE CALL SITES, READ AS TEXT.
 *
 * A CORRECT PREDICATE NOBODY CALLS IS THE FAILURE MODE THIS REPO HAS ALREADY
 * HAD TWICE, and it is exactly what this bug was: the data was on the wire, the
 * branch picker rendered it, and the update control never looked. Everything
 * above would pass with the button hard-wired live.
 * ═══════════════════════════════════════════════════════════════════════════
 */
{
  const panel = read('src/components/MaintenancePanel.tsx')
  const route = read('src/app/api/maintenance/route.ts')

  /** The one gate that matters: the button an operator presses. */
  const label = /Schedule update\s*\n\s*<\/Button>/.exec(panel)
  if (!label) {
    failed++
    console.error('  FAIL  the "Schedule update" button is no longer findable in MaintenancePanel')
  } else {
    const open = panel.lastIndexOf('<Button', label.index)
    const tag = panel.slice(open, label.index)
    if (!/disabled=\{[^}]*refBlocked/.test(tag)) {
      failed++
      console.error(
        '  FAIL  "Schedule update" does not read the eligibility flag in its `disabled` — ' +
          'the card rendering is not the same fact as the deploy being allowed',
      )
    } else if (!/disabled=\{[^}]*refBlocked !== null/.test(tag)) {
      /**
       * AND IT READS IT THE WAY THE FUNCTION SAYS TO. `refBlockedNow` returns a
       * SENTENCE, and null is the only "go ahead" — so a truthiness test lets a
       * stated refusal that arrived without wording through as deployable,
       * which is the one shape of this bug the box would still refuse. The
       * function's own comment states the contract; this is where a caller is
       * held to it.
       */
      failed++
      console.error(
        '  FAIL  "Schedule update" reads the eligibility flag as truthiness — ' +
          'a refusal carrying no sentence would leave the button live; ' +
          'null is the only go-ahead (see refBlockedNow)',
      )
    }
  }

  /**
   * AND THE REASON IS RENDERED, BESIDE THE CONTROL AND VERBATIM. A disabled
   * button eats pointer events (`docs/hover-text.md`), so a tooltip here would
   * delete the explanation in exactly the state that needs one; a greyed button
   * with nothing next to it is a mystery rather than a rule.
   */
  if (!panel.includes('Cannot be deployed — {refBlocked}')) {
    failed++
    console.error(
      '  FAIL  the game box\'s own sentence is not rendered beside the disabled button',
    )
  }
  if (!panel.includes('refBlockedNow(')) {
    failed++
    console.error('  FAIL  MaintenancePanel no longer derives the flag through lib/maintenance')
  }

  /**
   * THE ROUTE REFUSES WHAT THE PAGE WOULD NOT OFFER. A disabled control beside
   * a route that still accepts is the same disagreement `nothingToDeploy` is
   * written once to prevent — and it is the path a stale page, or a window
   * scheduled to fire later with nobody watching, actually travels.
   */
  const call = route.indexOf('maint.refBlockedNow(')
  if (call < 0) {
    failed++
    console.error('  FAIL  api/maintenance accepts a schedule without asking whether the box would take it')
  } else {
    /**
     * AND ONLY FOR AN UNPINNED UPDATE. `refUpdate` describes the ref the box is
     * ON; a request carrying `targetRef` is a SWITCH, already gated on that
     * branch's own `eligible` in the picker and checked again by `switchref`.
     * Gating it here on the current branch's verdict would refuse the one action
     * that gets an operator off a branch the box will not deploy — "Revert to
     * main" included. A blocked branch must never be one nobody can leave.
     */
    if (!/if \(!input\.targetRef\)/.test(route.slice(Math.max(0, call - 800), call))) {
      failed++
      console.error(
        '  FAIL  the eligibility refusal in api/maintenance is not scoped to unpinned updates — ' +
          'it would refuse the branch switch that escapes a blocked branch',
      )
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck:deployphase — ${failed} failure(s)`)
  process.exit(1)
}

console.log(
  `check:deployphase — ${cases.length} completion cases and 6 properties, ` +
    `${blockCases.length} eligibility cases and 6 properties, and 4 call sites hold ` +
    `(grace ${RESTART_GRACE_MS / 60_000}m)`,
)
