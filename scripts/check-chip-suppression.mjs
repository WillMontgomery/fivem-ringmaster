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

import {
  RESTART_GRACE_MS,
  chipCluster,
  updateInProgress,
} from '../src/lib/serverPhase.ts'

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OTHER HALF: WHICH CHIPS MAY APPEAR TOGETHER.
 *
 * The table above asserts a boolean — may the header claim a deploy is running.
 * That was the whole of this contract while the cluster was two chips. It is
 * now four, and the rule the owner actually stated is about CO-OCCURRENCE:
 *
 *   "'update available' should be superseded by 'draining' chips - they should
 *    never be displayed together"
 *
 * That rule lived in `ServerChips`' JSX as a chain of early returns, where
 * nothing could reach it, and `draining` fell past every rung into the branch
 * that renders the update badge and the window badge side by side — which is
 * exactly what the owner was looking at. `chipCluster` is the same ladder as a
 * pure function so that this file can hold it to the rule.
 *
 * `feed` HERE IS THE FEED CHIP RETURNING. Live / Falling behind / Feed lost
 * were removed at the owner's request and restored at it, and the question
 * "does a deploy suppress them" already had an answer in this file: the table
 * above is the same suppression rule, and the same two phases hide them.
 * Draining does NOT, which the case labelled "draining and the feed has died —
 * must NOT be hidden" has asserted since before those chips were deleted.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** [label, phase, badge, expected cluster] */
const clusterCases = [
  /**
   * ---- THE OWNER'S RULE. Draining and "update available", never together. ----
   *
   * THIS IS THE CASE THAT WOULD HAVE CAUGHT THE BUG had this contract covered
   * the cluster at the time. Before this change `draining` fell past both of
   * `ServerChips`' early returns into the branch that renders `UpdateBadge` and
   * the window badge side by side. `update: false` is the whole fix.
   *
   * `feed: true` IS THE OTHER HALF and it is not incidental: a drain is when
   * staleness matters MOST — players are still on the server — which is the
   * same call the suppression table above has always made for this state.
   */
  ['draining — the rule the owner stated', 'idle', 'draining', { feed: true, update: false, phase: null, window: 'draining' }],

  // ---- A deploy in flight: one chip, and the feed's silence is explained. ----
  ['deploying', 'deploying', 'updating', { feed: false, update: false, phase: 'updating', window: null }],
  ['confirming — waiting for br_ringmaster', 'confirming', null, { feed: false, update: false, phase: 'updating', window: null }],
  ['confirming, with a stale seeded badge still in hand', 'confirming', 'updating', { feed: false, update: false, phase: 'updating', window: null }],

  // ---- Terminal failures: the attributed report outranks the raw one. ----
  ['failed — the host refused', 'failed', null, { feed: false, update: false, phase: 'failed', window: null }],
  ['unconfirmed — the server never came back', 'unconfirmed', null, { feed: false, update: false, phase: 'unconfirmed', window: null }],
  ['a failure outranks a draining badge left over from the window', 'failed', 'draining', { feed: false, update: false, phase: 'failed', window: null }],
  ['unconfirmed outranks draining too', 'unconfirmed', 'draining', { feed: false, update: false, phase: 'unconfirmed', window: null }],

  // ---- Ordinary. The resting state the header must never lose again. ----
  ['idle with nothing scheduled — feed and update, both stated', 'idle', null, { feed: true, update: true, phase: null, window: null }],
  ['scheduled — still shows the update badge, UNCHANGED by this work', 'idle', 'scheduled', { feed: true, update: true, phase: null, window: 'scheduled' }],

  /**
   * `updating` REACHING THE ORDINARY RUNG IS A MIXED-PAYLOAD CASE, not a normal
   * one. `badgeState` returns 'updating' only for `state === 'deploying'`, which
   * `deployPhase` reads as `deploying` — so the two normally arrive together and
   * land on the first rung. They can separate for one poll: a payload predating
   * the maintenance field leaves `phaseOf` at `idle` while the SERVER-rendered
   * seed badge still says 'updating'. Asserted as it BEHAVES rather than as it
   * ought to, because this is the state the owner has not been asked about.
   */
  ['updating badge with an idle phase — the mixed-payload second', 'idle', 'updating', { feed: true, update: true, phase: null, window: 'updating' }],
]

for (const [label, phase, badge, expected] of clusterCases) {
  const got = chipCluster(phase, badge)
  for (const k of ['feed', 'update', 'phase', 'window']) {
    if (got[k] !== expected[k]) {
      failed++
      console.error(
        `  FAIL  ${label}: ${k} -> ${JSON.stringify(got[k])} (expected ${JSON.stringify(expected[k])})`,
      )
    }
  }
}

const PHASES = ['idle', 'deploying', 'confirming', 'failed', 'unconfirmed']
const BADGES = ['scheduled', 'draining', 'updating', null]

/**
 * THE OWNER'S RULE AS A PROPERTY, over every combination that exists, so no
 * future rung can reintroduce the pair by covering a case the table missed.
 */
for (const phase of PHASES) {
  const c = chipCluster(phase, 'draining')
  if (c.update) {
    failed++
    console.error(
      `  FAIL  draining rendered the update badge (phase=${phase}) — the owner's rule`,
    )
  }
}

/**
 * ONE EXCLUSIVE CHIP AT MOST. `phase` and `window` are different chips and the
 * ladder must never set both: an "Updating" spinner beside a window badge that
 * also says "updating" is the cluster arguing with itself, which is what
 * building this as one component was for.
 */
for (const phase of PHASES) {
  for (const badge of BADGES) {
    const c = chipCluster(phase, badge)
    if (c.phase !== null && c.window !== null) {
      failed++
      console.error(
        `  FAIL  two exclusive chips at once (phase=${phase}, badge=${badge})`,
      )
    }

    /**
     * THE FEED CHIP IS SUPPRESSED BY EXACTLY THE DEPLOY STATES AND NO OTHERS.
     * Tied to `updateInProgress`'s own two phases plus the two terminal ones,
     * which are the cases where a deploy chip already reports the dead feed and
     * says why. Anything else — including a drain — leaves it alone.
     */
    const deployOwnsTheSilence =
      phase === 'deploying' ||
      phase === 'confirming' ||
      phase === 'failed' ||
      phase === 'unconfirmed'
    if (c.feed === deployOwnsTheSilence) {
      failed++
      console.error(
        `  FAIL  feed chip visibility wrong (phase=${phase}, badge=${badge}) -> ${c.feed}`,
      )
    }

    /** And the cluster is NEVER empty. That silence is what `Up to date` closed. */
    if (!c.feed && !c.update && c.phase === null && c.window === null) {
      failed++
      console.error(`  FAIL  empty cluster (phase=${phase}, badge=${badge})`)
    }
  }
}

if (failed) {
  console.error(`\nchip suppression: ${failed} case(s) failed.`)
  console.error(
    'Only a stated deploy may put "Updating" in the header, and "update ' +
      'available" never appears beside "draining" — see src/lib/serverPhase.ts',
  )
  process.exit(1)
}
console.log(
  `chip suppression: ${cases.length} suppression cases and ` +
    `${clusterCases.length} cluster cases match the contract`,
)
