/**
 * THE COMMIT A DEPLOY IS SAID TO BE GOING TO, AND THE ONE IT WENT TO.
 *
 * WHY THIS GATE EXISTS. The owner, on the maintenance page: "`latest` is
 * confirmed deployed, but the hash on the maintenance page isn't the latest
 * hash. So it's misleading to say we're going from X to Y but we actually end up
 * on Z, which is the latest." Seen from outside it read as something else
 * entirely — "it only seems to do updates in steps, not straight to latest" —
 * because every deploy DID jump to the tip while the page kept naming an older
 * commit as the destination, which looks from the far side like creeping forward
 * one commit at a time.
 *
 * THE TWO MOMENTS THAT WERE NEVER THE SAME MOMENT:
 *
 *   1. The console resolves the destination from `refs/remotes/origin/<ref>` on
 *      the game box, through the `branches` verb, on a REF_POLL_MS throttle.
 *   2. `tools/deploy.sh` resolves it AGAIN — its own unbounded `git fetch` and
 *      `reset --hard origin/$BRANCH` — at the instant the deploy runs, which for
 *      a `when-empty` window is however long the drain took.
 *
 * Two resolutions, two commits, and only one of them was ever on the page.
 *
 * THE FOUR PROPERTIES THIS FILE HOLDS:
 *
 *   1. A DESTINATION READING NOTHING IS REFRESHING IS NOT SHOWN. `updateTargetNow`
 *      refuses one older than TARGET_MAX_AGE_MS — and the bound is derived from
 *      the poll interval, so it can neither blank the arrow on ordinary phase nor
 *      quietly stop firing if somebody re-tunes the poller.
 *
 *   2. WHAT WAS DISPLAYED AND WHAT WAS DEPLOYED ARE COMPARED, NOT CONFLATED.
 *      `deployLanded` reports the commit the box ACTUALLY came back on, and says
 *      whether it is the one the page named. A branch that moves between resolve
 *      and deploy is the case that must not read as agreement.
 *
 *   3. "WHAT IS RUNNING" IS READ LIVE, NEVER REMEMBERED. `runningShaNow` answers
 *      it off the fifteen-second `status` poll — the same field the Host page
 *      renders — and the settled card asks it that way. The recorded landing is
 *      a different question with a different answer and a different lifetime;
 *      the two are not interchangeable and this file keeps both.
 *
 *   4. THE CALL SITES DO IT. This repo has three times had a change pass every
 *      check while a component wired a correct function up wrongly — see the
 *      note in check-deploy-phase.mjs, which was written after exactly that. So
 *      the panel, the route and the driver are read as text below.
 *
 * A PLAIN SCRIPT, matching check-deploy-phase.mjs and check-chip-suppression.mjs:
 * this repo has no test framework and adding one would be the larger change. The
 * shipped functions are imported for real, so there is no second copy here to
 * drift out of step with them.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REF_POLL_MS,
  TARGET_MAX_AGE_MS,
  deployLanded,
  runningShaNow,
  updateTargetNow,
} from '../src/lib/maintenance.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL  ${msg}`)
}

const NOW = 1_700_000_000_000

/**
 * FOUR COMMITS ON `dev`, OLDEST FIRST, and the order is the point of the
 * fixture. `A` is what the box is running; `B`, `C` and `D` landed after it, so
 * `D` is the tip and `B` is the FIRST new commit. Any rule that walks this list
 * and stops early lands on `B`; the deploy lands on `D`.
 */
// Hex LETTERS, not just digits, so `toUpperCase()` on one of these is a
// different string — a fixture of `1111…` would let a dropped case fold pass.
const A = '1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a'
const B = '2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b'
const C = '3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c'
const D = '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d'

/** A destination reading as the `branches` verb hands one over. */
const reading = (over) => ({
  ref: 'dev',
  fromSha: A,
  toSha: D,
  stale: false,
  at: NOW,
  ...over,
})

// =====================================================================
// PROPERTY 1 — A READING NOTHING IS REFRESHING IS NOT A DESTINATION.
// =====================================================================

/** [label, deployedRef, reading, now, expected toSha or null] */
const targetCases = [
  // ---- The pairing rules that were already here, unchanged. ----
  ['a current reading on the ref the box is on', 'dev', reading(), NOW, D],
  ['no reading at all', 'dev', null, NOW, null],
  ['the host has not named its ref', null, reading(), NOW, null],
  ['the reading belongs to the branch we just left', 'dev', reading({ ref: 'main' }), NOW, null],
  ['an arrow pointing at itself is not an update', 'dev', reading({ toSha: A }), NOW, null],
  [
    'a STALE reading is still shown — a real tip, possibly overtaken',
    'dev',
    reading({ stale: true }),
    NOW,
    D,
  ],

  // ---- The freshness rule. ----
  [
    'one whole poll interval old — ordinary phase, must still render',
    'dev',
    reading({ at: NOW - REF_POLL_MS }),
    NOW,
    D,
  ],
  [
    'just under two intervals — the poller has missed nothing yet',
    'dev',
    reading({ at: NOW - (REF_POLL_MS * 2 - 1) }),
    NOW,
    D,
  ],
  [
    'exactly at the bound — kept, because the test is `>` and not `>=`',
    'dev',
    reading({ at: NOW - TARGET_MAX_AGE_MS }),
    NOW,
    D,
  ],
  [
    'one millisecond past the bound — withheld',
    'dev',
    reading({ at: NOW - (TARGET_MAX_AGE_MS + 1) }),
    NOW,
    null,
  ],
  [
    'an hour old — the poller has stopped answering, so the console stops naming a commit',
    'dev',
    reading({ at: NOW - 3_600_000 }),
    NOW,
    null,
  ],
  [
    'stamped in the future — a clock disagreement is not a stale reading',
    'dev',
    reading({ at: NOW + 60_000 }),
    NOW,
    D,
  ],
  [
    'a stale reading that is ALSO too old loses on age, not on staleness',
    'dev',
    reading({ stale: true, at: NOW - (TARGET_MAX_AGE_MS + 1) }),
    NOW,
    null,
  ],
]

for (const [label, ref, target, now, expected] of targetCases) {
  const got = updateTargetNow(ref, target, now)
  const gotSha = got === null ? null : got.toSha
  if (gotSha !== expected) {
    fail(
      `updateTargetNow: ${label}\n        expected ${expected ?? 'null'}, got ${gotSha ?? 'null'}`,
    )
  }
}

/**
 * AND IT HANDS BACK THE READING ITSELF, not a copy with fields dropped. The
 * panel renders `fromSha`, `ref` and `stale` off whatever this returns, and a
 * rule that rebuilt the object would be a second place for those to go wrong.
 */
{
  const r = reading({ stale: true })
  const got = updateTargetNow('dev', r, NOW)
  if (got !== r) {
    fail('updateTargetNow no longer returns the reading it was given')
  }
}

/**
 * THE DEFAULT CLOCK IS REAL TIME. Server-side callers pass no `now`, and a
 * default of 0 (or of the reading's own `at`) would disable the gate for every
 * one of them while every test above still passed.
 */
{
  if (updateTargetNow('dev', reading({ at: Date.now() })) === null) {
    fail('updateTargetNow with no `now` refuses a reading taken this instant')
  }
  if (updateTargetNow('dev', reading({ at: Date.now() - 86_400_000 })) !== null) {
    fail('updateTargetNow with no `now` accepts a day-old reading — the default is not the clock')
  }
}

// =====================================================================
// PROPERTY 1b — THE BOUND IS DERIVED FROM THE CADENCE, NOT PICKED.
// =====================================================================
//
// Both halves matter and they pull in opposite directions. Too tight and the
// arrow disappears for a slice of every ordinary poll cycle, which teaches an
// operator that the console flickers; too loose and it never fires, which is the
// bug it was added for wearing a gate as a disguise.

if (!(TARGET_MAX_AGE_MS > REF_POLL_MS)) {
  fail(
    `TARGET_MAX_AGE_MS (${TARGET_MAX_AGE_MS}) is not longer than one poll interval ` +
      `(${REF_POLL_MS}) — the arrow would blank on ordinary phase`,
  )
}
if (!(TARGET_MAX_AGE_MS >= REF_POLL_MS * 2)) {
  fail(
    `TARGET_MAX_AGE_MS (${TARGET_MAX_AGE_MS}) refuses a reading before the poller has ` +
      `missed a full turn (${REF_POLL_MS * 2})`,
  )
}
if (!(TARGET_MAX_AGE_MS < REF_POLL_MS * 10)) {
  fail(
    `TARGET_MAX_AGE_MS (${TARGET_MAX_AGE_MS}) is so far past the cadence that a poller ` +
      `which has stopped would go unnoticed for the length of a drain`,
  )
}

// =====================================================================
// PROPERTY 2 — DISPLAYED AND DEPLOYED ARE COMPARED, NEVER CONFLATED.
// =====================================================================
//
// THIS IS THE OWNER'S SENTENCE AS A TABLE. "We're going from X to Y but we
// actually end up on Z." Every row names both commits and asserts which one the
// console reports.

/** [label, shownSha, landedSha, expected sha or null, expected asShown] */
const landedCases = [
  ['nothing has landed yet — the deploy has not been confirmed', D, null, null, null],
  ['no landing recorded and nothing was claimed either', null, null, null, null],
  ['the field is absent entirely (a row that predates it)', undefined, undefined, null, null],

  ['the page named the tip and the deploy landed on it', D, D, D, true],
  [
    'THE BUG: the page named B and the deploy went to the tip, D',
    B,
    D,
    D,
    false,
  ],
  [
    'the branch moved TWICE between resolve and deploy',
    B,
    D,
    D,
    false,
  ],
  [
    'the page named a commit the deploy went PAST by one',
    C,
    D,
    D,
    false,
  ],
  [
    'no claim was made — an automatic window nobody was reading',
    null,
    D,
    D,
    true,
  ],
  ['a claim of empty string is no claim', '', D, D, true],
  ['upper case from a hand-written fixture still matches', D.toUpperCase(), D, D, true],
  [
    'an ABBREVIATION is not the commit — a prefix must never read as agreement',
    D.slice(0, 8),
    D,
    D,
    false,
  ],
]

for (const [label, shownSha, landedSha, expectedSha, expectedAsShown] of landedCases) {
  const got = deployLanded({ shownSha, landedSha })
  if (expectedSha === null) {
    if (got !== null) {
      fail(`deployLanded: ${label}\n        expected null, got ${JSON.stringify(got)}`)
    }
    continue
  }
  if (got === null) {
    fail(`deployLanded: ${label}\n        expected ${expectedSha}, got null`)
    continue
  }
  if (got.sha !== expectedSha) {
    fail(
      `deployLanded: ${label}\n        expected the LANDED commit ${expectedSha}, got ${got.sha}`,
    )
  }
  if (got.asShown !== expectedAsShown) {
    fail(
      `deployLanded: ${label}\n        expected asShown=${expectedAsShown}, got ${got.asShown}`,
    )
  }
}

/**
 * THE COMMIT REPORTED IS THE ONE THE BOX WENT TO, NEVER THE ONE THE PAGE SAID.
 *
 * STATED SEPARATELY FROM THE TABLE because it is the mutation the table alone
 * would let through in exactly one direction: a function returning `shownSha`
 * still satisfies every row where the two agree, and the rows where they differ
 * are the ones anybody adding a case is least likely to write. This is the
 * "which end of the list" property the owner's first reading of the bug was
 * about, in the form it actually takes here.
 */
for (const shown of [A, B, C, null, undefined, '']) {
  const got = deployLanded({ shownSha: shown, landedSha: D })
  if (got === null || got.sha !== D) {
    fail(
      `deployLanded reports ${got === null ? 'nothing' : got.sha} when the box landed on ${D} ` +
        `and the page had said ${shown ?? 'nothing'}`,
    )
  }
}

// =====================================================================
// PROPERTY 3 — "WHAT IS RUNNING" IS READ LIVE, NEVER REMEMBERED.
// =====================================================================
//
// THE REGRESSION THIS EXISTS FOR, IN THE OWNER'S SCREENSHOT. The maintenance
// page carried three commit hashes for one question. The branch picker said
// `60d07c46` and the Host page said `60d07c4`, both live and both right; the
// green-tick card said `bff66a07`, six commits behind, and it was the only one
// a reader looking at "the server is running the latest code" would see.
//
// IT WAS NOT A WRONG-ROW BUG. The maintenance table is a singleton — `current()`
// is one `ddb.get` on a fixed key — so there was only ever one row to read. The
// card was rendering `deployLandedSha`, and that field is a RECORD of one past
// deploy: written once at confirmation, cleared only by `schedule()` and
// `markDeploying()`, and therefore describing a server that has since moved
// whenever anything moves the box outside a console-scheduled window.
//
// SO THE TWO ARE NOT INTERCHANGEABLE, and PROPERTY 2 above stays exactly as it
// was to say so. `deployLanded` still has to answer "where did that deploy go"
// correctly for the audit trail. What must never happen again is that answer
// being rendered where the reader is asking "what is running now".

/** [label, status, expected] */
const runningCases = [
  ['the host reported a full 40-hex sha', { sha: D }, D],
  ['no host reading at all — the poller has not answered', null, null],
  ['the field is absent (an older dispatcher)', {}, null],
  ['undefined is not a commit', { sha: undefined }, null],
  ['null is not a commit', { sha: null }, null],
  ['no status object at all', undefined, null],
  /**
   * THE ABBREVIATION IS THE ROW THAT MATTERS. `status.commit` sits beside
   * `status.sha` on the same payload and is what an eye reaches for; it is a
   * PREFIX, and lib/github documents `shortSha` as never being for comparison.
   * A caller that grabbed the wrong field must get silence, not a short link.
   */
  ['an abbreviated display sha is refused', { sha: D.slice(0, 8) }, null],
  ['one hex short of a commit', { sha: D.slice(0, 39) }, null],
  ['one hex long', { sha: `${D}a` }, null],
  ['not hex at all', { sha: 'z'.repeat(40) }, null],
  /**
   * REFUSED THROUGH `isFullSha`, THE SAME PREDICATE THE PIN GATE USES, so there
   * is one definition of "a commit this console will act on" rather than a
   * display-only second opinion. The game box answers `rev-parse` in lower case;
   * anything else did not come from there and reads as "not told".
   */
  ['upper case is not the shape the box produces', { sha: D.toUpperCase() }, null],
  ['not a string', { sha: 12345 }, null],
]

for (const [label, status, expected] of runningCases) {
  const got = runningShaNow(status)
  if (got !== expected) {
    fail(
      `runningShaNow: ${label}\n        expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(got)}`,
    )
  }
}

// =====================================================================
// PROPERTY 4 — THE CALL SITES ACTUALLY DO IT.
// =====================================================================

{
  const panel = read('src/components/MaintenancePanel.tsx')
  const route = read('src/app/api/maintenance/route.ts')
  const driver = read('src/lib/maintenanceDriver.ts')
  const tel = read('src/lib/telemetry.ts')
  const maintenance = read('src/lib/maintenance.ts')

  /**
   * THE PANEL MEASURES AGE AGAINST THE SERVER'S CLOCK.
   *
   * `at` is stamped on the server when the `branches` answer arrives; the panel
   * is a client component whose own `now` is `Date.now()` in a browser. Passing
   * the browser clock would let a laptop running a few minutes fast blank the
   * arrow on a console that is working perfectly — a freshness gate inventing a
   * staleness of its own. `phaseNow` is the live poll's `now`, which is the same
   * clock that stamped `at`.
   */
  if (!panel.includes('updateTargetNow(deployedRef, updateTarget, phaseNow)')) {
    fail(
      'MaintenancePanel does not pass the SERVER clock (`phaseNow`) to updateTargetNow — ' +
        'a client clock would blank the arrow on a skewed machine',
    )
  }

  /**
   * AND THE ARROW NO LONGER PROMISES A DESTINATION. The right-hand commit is the
   * newest one the box knows about; `deploy.sh` picks the tip at deploy time and
   * this console does not get a vote. The live-window card on the same page has
   * always worded it correctly ("to its newest commit when the deploy runs") —
   * this is the copy that disagreed with it.
   */
  if (panel.includes('label="Deploying to"')) {
    fail(
      'MaintenancePanel still labels the target commit "Deploying to" — a destination ' +
        'the deploy does not promise to keep',
    )
  }
  if (!panel.includes('label="Newest commit"')) {
    fail('MaintenancePanel no longer names the target commit as a reading')
  }

  /**
   * AND THE SETTLED CARD NAMES A COMMIT AT ALL. "The server is running the
   * latest code" with nothing beside it is unfalsifiable, which is the owner's
   * report read from the other end. The card owes the reader one commit.
   */
  if (!panel.includes('sha={runningSha}')) {
    fail(
      'MaintenancePanel no longer names the running commit on the settled card — the ' +
        'card claims the server is current with nothing to check it against',
    )
  }

  /**
   * AND THAT COMMIT IS THE LIVE READING, REFRESHED BY THE POLL THAT REFRESHES
   * EVERYTHING ELSE ON THE CARD. This is the assertion that used to pin the
   * bug: it read `panel.includes('deployLanded(')`, i.e. it REQUIRED the card to
   * render the recorded landing. `deployLandedSha` is written once at
   * confirmation and never touched again until the next window, so the card it
   * pinned went stale the moment anything moved the box — and the owner's page
   * ended up showing a commit six behind the one the branch picker and the Host
   * page were showing on the same screen.
   *
   * BOTH HALVES ARE ASSERTED BECAUSE EITHER ALONE PASSES THE BUG. A panel that
   * sets state from a stale prop and never polls satisfies the render check; a
   * panel that polls into a value nothing renders satisfies the poll check.
   */
  if (!panel.includes('setRunningSha(runningShaNow(hv.status))')) {
    fail(
      'MaintenancePanel does not refresh the running commit from the /api/host poll — ' +
        'a commit read once and never again goes stale in place, which is the bug',
    )
  }

  /**
   * AND THE RECORDED LANDING IS NOT RENDERED AS A CURRENT FACT.
   *
   * READ AS CODE, NOT AS TEXT, and that is forced rather than fussy: the panel's
   * own comment explains at length why it stopped rendering `deployLandedSha`,
   * so an `includes` on the field name would match the explanation and fail on a
   * correct file. These two match the expressions that actually read the row.
   *
   * `deployLanded` ITSELF IS NOT THE PROBLEM AND IS NOT BANNED — see PROPERTY 2,
   * which still holds it to its own semantics. What is banned is this surface
   * answering "what is running" with it.
   */
  if (/^\s*deployLanded,$/m.test(panel)) {
    fail(
      'MaintenancePanel imports deployLanded again — the recorded landing is a note ' +
        'about one past deploy, not an answer about the running server',
    )
  }
  if (/w\?\.deployLandedSha/.test(panel)) {
    fail(
      'MaintenancePanel reads deployLandedSha off the window row — that field is ' +
        'written once and never refreshed, so the card it feeds goes stale in place',
    )
  }

  /**
   * THE ROUTE RE-RESOLVES BEFORE IT READS ANYTHING.
   *
   * A button press is the instant the destination stops being decoration and
   * becomes a claim somebody is acting on, so it is the instant to spend a
   * `branches` call on. Ordering is the whole assertion: a refresh AFTER
   * `hostView()` would gate and record against the same stale snapshot it was
   * added to replace, and would still contain both strings.
   */
  const refreshAt = route.indexOf('await refreshDeployedRef()')
  const viewAt = route.indexOf('hostView()')
  if (refreshAt < 0) {
    fail('api/maintenance schedules a deploy without re-resolving the destination first')
  } else if (viewAt >= 0 && refreshAt > viewAt) {
    fail(
      'api/maintenance re-resolves the destination AFTER reading the snapshot — ' +
        'it gates and records against the stale reading it meant to replace',
    )
  }

  /** And it writes down the claim it made, so it can be compared afterwards. */
  if (!/shownSha,/.test(route) || !route.includes('maint.updateTargetNow(')) {
    fail(
      'api/maintenance does not record the destination the page named through ' +
        'updateTargetNow — the row cannot answer what was promised',
    )
  }

  /**
   * THE DRIVER RE-RESOLVES IMMEDIATELY BEFORE IT FIRES, AND RECORDS WHERE IT
   * WENT. This is the gap that made the owner's report unbounded rather than
   * merely two minutes wide: a `when-empty` window sits through the whole drain,
   * and nothing was hurrying the reading in between.
   */
  const driverRefresh = driver.indexOf('await refreshDeployedRef()')
  const driverFire = driver.indexOf('await runDeploy(w)')
  if (driverRefresh < 0) {
    fail('the driver fires a deploy without re-resolving the destination first')
  } else if (driverFire >= 0 && driverRefresh > driverFire) {
    fail('the driver re-resolves the destination AFTER the deploy has already gone')
  }
  if (!/markDeployConfirmed\(\s*[^)]*,/.test(driver)) {
    fail(
      'the driver confirms a deploy without recording the commit it landed on — ' +
        'the page is left claiming the server is current with nothing to check',
    )
  }

  /**
   * ONE CADENCE, ONE CONSTANT. The freshness bound is a multiple of the poll
   * interval, so a second definition of that interval is how somebody re-tunes
   * the poller and leaves the gate calibrated for a cadence that no longer
   * exists — a gate that then either never fires or fires constantly.
   */
  if (!/import \{ REF_POLL_MS \} from '\.\/maintenance'/.test(tel)) {
    fail('lib/telemetry no longer imports REF_POLL_MS from lib/maintenance')
  }
  if (/^const REF_POLL_MS = /m.test(tel)) {
    fail('lib/telemetry has re-declared REF_POLL_MS — the bound and the cadence can now drift')
  }

  /**
   * FORCING SKIPS THE INTERVAL, NOT THE ONE-AT-A-TIME RULE. `branches` runs a
   * real `git fetch --prune` on the game box inside a four-second budget, and
   * two of them racing is what that budget cannot absorb.
   */
  const busy = tel.indexOf('if (state.refBusy) return')
  const skipsInterval = tel.indexOf('if (!force &&')
  if (busy < 0) {
    fail('lib/telemetry no longer guards pollDeployedRef with `refBusy`')
  } else if (skipsInterval < 0) {
    fail('lib/telemetry no longer has a forced path that skips the poll interval')
  } else if (busy > skipsInterval) {
    fail(
      'lib/telemetry checks `refBusy` only after the forced path has skipped the interval — ' +
        'a button press could race the timer into two `git fetch`es on the game box',
    )
  }

  /**
   * THE LANDING IS CLEARED WHEN A WINDOW IS WRITTEN AND WHEN A DEPLOY STARTS.
   * `schedule` is a full `put`, so a field not repeated is destroyed — but a
   * field CARRIED is worse: "where the last deploy landed" sitting on a window
   * that has not deployed anything is the exact shape of the mistake this whole
   * gate is about.
   */
  //
  // ANCHORED, SO A COMMENTED-OUT LINE IS NOT A PASS. `includes` on either of
  // these strings matches the prose above them and matches them commented out,
  // which is the one edit somebody makes while debugging and forgets.
  if (!/^\s*deployLandedSha: null,$/m.test(maintenance)) {
    fail('schedule() does not clear deployLandedSha — a new window inherits the last landing')
  }
  if (!/^\s*'deployLandedSha = :null',$/m.test(maintenance)) {
    fail('markDeploying() does not clear deployLandedSha — the previous landing survives the deploy')
  }
}

if (failed > 0) {
  console.error(`\ncheck:deploytarget — ${failed} failure(s)`)
  process.exit(1)
}

console.log(
  `check:deploytarget — ${targetCases.length} freshness/pairing cases, ` +
    `${landedCases.length} displayed-vs-deployed cases, ` +
    `${runningCases.length} running-commit cases and 4 properties, ` +
    `and 14 call sites hold ` +
    `(poll ${REF_POLL_MS / 1000}s, bound ${TARGET_MAX_AGE_MS / 1000}s)`,
)
