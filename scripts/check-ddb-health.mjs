/**
 * The three rules the br_ddb indicators may not break.
 *
 * WHY THIS IS A GATE. This feature exists because the owner asked to be told
 * loudly when br_ddb has failed, and every way it can go wrong is silent:
 *
 *   1. THE TWO FACTS COLLAPSE INTO ONE. Reachability and the bundle are
 *      different questions with different transports, and the moment one of
 *      them can move the other's indicator the operator is told something is
 *      broken without being told which thing to fix. This is a two-line
 *      refactor away at all times, because both readings live on one object.
 *
 *   2. UNKNOWN RENDERS AS FAILURE. A console that has not polled, a game build
 *      with no probe, a dispatcher with no bundle block. A red alarm on any of
 *      those trains the owner to ignore the real one, which is strictly worse
 *      than having built nothing.
 *
 *   3. THE ALERT CLEARS ON DISMISSAL RATHER THAN ON RECOVERY. "These elements
 *      cannot be dismissed until the problem is fixed" is the requirement, and
 *      the usual implementation — a dismissed flag with a re-arm rule — fails
 *      in both directions: the flag outlives the fault, or the re-arm never
 *      fires and a fixed problem stays on screen forever.
 *
 * Rules 1 and 2 are checked EXHAUSTIVELY, because the input space is nine pairs
 * and there is no excuse for sampling it. Rule 3 is checked structurally: the
 * fault list is a pure function of the readings, so the property to assert is
 * that it has no other inputs to become impure through.
 *
 * A PLAIN SCRIPT, matching check-chip-suppression.mjs — this repo has no test
 * framework and adding one to assert two dozen cases would be the larger
 * change. It runs in `npm run verify`.
 *
 * IMPORTED FOR REAL, never re-implemented. `src/lib/ddbHealth.ts` deliberately
 * has no runtime imports at all, so tsx loads the shipped functions and there
 * is no second copy here to drift.
 */

import { readFileSync } from 'node:fs'

import {
  BUNDLE_LABEL,
  PROBE_MAX_AGE_MS,
  REACH_LABEL,
  bundleNow,
  faults,
  reachNow,
} from '../src/lib/ddbHealth.ts'

const NOW = 1_700_000_000_000
const REACHES = ['connected', 'unreachable', 'unknown']
const BUNDLES = ['matched', 'mismatched', 'unknown']

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL  ${msg}`)
}

/* ------------------------------------------------------------------ */
/* RULE 1 — the two facts never cross                                  */
/* ------------------------------------------------------------------ */

/**
 * Over all nine pairs: the DynamoDB fault appears exactly when reachability is
 * `unreachable`, whatever the bundle says, and the bundle fault appears exactly
 * when the bundle is `mismatched`, whatever DynamoDB says.
 *
 * THIS IS THE WHOLE ANTI-COLLAPSE PROPERTY. If somebody ever writes
 * `if (reach !== 'connected' || bundle !== 'matched') → one alarm`, every one
 * of the four mixed pairs below breaks.
 */
for (const reach of REACHES) {
  for (const bundle of BUNDLES) {
    const ids = faults(reach, bundle).map((f) => f.id)

    const wantsDdb = reach === 'unreachable'
    const wantsBundle = bundle === 'mismatched'

    if (ids.includes('ddb-unreachable') !== wantsDdb) {
      fail(`(${reach}, ${bundle}) ddb fault = ${ids.includes('ddb-unreachable')}, want ${wantsDdb}`)
    }
    if (ids.includes('bundle-mismatch') !== wantsBundle) {
      fail(`(${reach}, ${bundle}) bundle fault = ${ids.includes('bundle-mismatch')}, want ${wantsBundle}`)
    }
    if (ids.length !== (wantsDdb ? 1 : 0) + (wantsBundle ? 1 : 0)) {
      fail(`(${reach}, ${bundle}) produced ${ids.length} faults: ${ids.join(', ')}`)
    }
  }
}

/**
 * And the crossing property stated the other way round, which catches the
 * subtler version: holding one reading still, changing the OTHER must never
 * change the first one's fault.
 */
for (const reach of REACHES) {
  const ddbFaults = new Set(
    BUNDLES.map((b) => faults(reach, b).some((f) => f.id === 'ddb-unreachable')),
  )
  if (ddbFaults.size !== 1) {
    fail(`the bundle reading moved the DynamoDB fault (reach=${reach})`)
  }
}
for (const bundle of BUNDLES) {
  const bundleFaults = new Set(
    REACHES.map((r) => faults(r, bundle).some((f) => f.id === 'bundle-mismatch')),
  )
  if (bundleFaults.size !== 1) {
    fail(`the DynamoDB reading moved the bundle fault (bundle=${bundle})`)
  }
}

/** Two different faults are two entries, never merged into one summary. */
if (faults('unreachable', 'mismatched').length !== 2) {
  fail('both facts broken must produce two faults, each with its own steps')
}

/* ------------------------------------------------------------------ */
/* RULE 2 — unknown is never a failure, at every door it arrives by    */
/* ------------------------------------------------------------------ */

/** Nothing that is `unknown` may contribute a fault. */
for (const bundle of BUNDLES) {
  if (faults('unknown', bundle).some((f) => f.id === 'ddb-unreachable')) {
    fail(`unknown reachability produced a DynamoDB fault (bundle=${bundle})`)
  }
}
for (const reach of REACHES) {
  if (faults(reach, 'unknown').some((f) => f.id === 'bundle-mismatch')) {
    fail(`unknown bundle produced a bundle fault (reach=${reach})`)
  }
}
if (faults('unknown', 'unknown').length !== 0) {
  fail('a console that has been told nothing must raise nothing')
}

/**
 * EVERY WAY THE REACHABILITY FACT CAN BE ABSENT, and not one of them is
 * `unreachable`. These are the four real doors: no snapshot yet, a game build
 * that predates the block, br_ddb never started (all three arrive as a missing
 * probe), and a probe too old to be current.
 */
const reachAbsences = [
  ['no probe at all', reachNow(null, null, NOW)],
  ['probe undefined', reachNow(undefined, undefined, NOW)],
  ['probe present, undated', reachNow({ ok: false }, null, NOW)],
  ['probe present, date not a number', reachNow({ ok: false }, '17', NOW)],
  ['ok probe, aged out', reachNow({ ok: true }, NOW - PROBE_MAX_AGE_MS - 1, NOW)],
  ['failed probe, aged out', reachNow({ ok: false }, NOW - PROBE_MAX_AGE_MS - 1, NOW)],
]
for (const [label, got] of reachAbsences) {
  if (got !== 'unknown') fail(`reachNow: ${label} -> ${got} (expected unknown)`)
}

/**
 * A STALE FAILURE EXPIRES TOO, and that is the asymmetry worth pinning. A
 * verdict that could only ever be cleared by a fresh success is a flag, which is
 * the thing rule 3 exists to forbid — the reading has to be able to go quiet on
 * its own when nobody is telling us anything any more.
 */
if (reachNow({ ok: false }, NOW - PROBE_MAX_AGE_MS - 1, NOW) === 'unreachable') {
  fail('an aged-out failure is still being reported as a current one')
}

/** And the stated readings, which must survive inside the freshness window. */
if (reachNow({ ok: true }, NOW - 1_000, NOW) !== 'connected') {
  fail('a fresh successful probe must read connected')
}
if (reachNow({ ok: false }, NOW - 1_000, NOW) !== 'unreachable') {
  fail('a fresh failed probe must read unreachable')
}
if (reachNow({ ok: true }, NOW - (PROBE_MAX_AGE_MS - 1_000), NOW) !== 'connected') {
  fail('a probe just inside the freshness window must still read connected')
}

/**
 * EVERY WAY THE BUNDLE FACT CAN BE ABSENT. A dispatcher too old to send the
 * block, a game build with no `fingerprint.json`, a manifest that records only
 * `source`, and a box whose hash tool is missing are four different absences
 * and not one of them is a mismatch.
 */
const bundleAbsences = [
  ['no block at all', bundleNow(null)],
  ['block undefined', bundleNow(undefined)],
  ['no manifest (no fingerprint.json on the box)', bundleNow({ manifest: null, onDisk: 'abc' })],
  ['manifest with no bundle hash', bundleNow({ manifest: { source: 'abc' }, onDisk: 'abc' })],
  ['manifest bundle hash empty', bundleNow({ manifest: { bundle: '' }, onDisk: 'abc' })],
  ['nothing hashed on disk', bundleNow({ manifest: { bundle: 'abc' }, onDisk: null })],
  ['on-disk hash empty', bundleNow({ manifest: { bundle: 'abc' }, onDisk: '' })],
]
for (const [label, got] of bundleAbsences) {
  if (got !== 'unknown') fail(`bundleNow: ${label} -> ${got} (expected unknown)`)
}

/** The stated readings, and the case difference that must not be a mismatch. */
if (bundleNow({ manifest: { bundle: 'AB12' }, onDisk: 'ab12' }) !== 'matched') {
  fail('hex case must not be reported as a mismatch — three hash tools, three spellings')
}
if (bundleNow({ manifest: { bundle: 'abc' }, onDisk: 'abd' }) !== 'mismatched') {
  fail('two different hashes must read as a mismatch')
}

/** The quiet label for both unknowns is the same em-dash the other cards use. */
if (REACH_LABEL.unknown !== '—' || BUNDLE_LABEL.unknown !== '—') {
  fail('unknown must render as the em-dash, not as a word that reads like a verdict')
}

/* ------------------------------------------------------------------ */
/* RULE 3 — it clears on recovery, and there is nothing to dismiss     */
/* ------------------------------------------------------------------ */

/**
 * THE STRUCTURAL HALF. `faults` takes exactly the two readings. Anything else
 * in its signature — a dismissed flag, an acknowledgement timestamp, a storage
 * key — is how this requirement gets quietly reversed, and `Function.length` is
 * the one property that notices.
 */
if (faults.length !== 2) {
  fail(
    `faults() takes ${faults.length} arguments, expected exactly 2 (reach, bundle). ` +
      'A third input is how "undismissable" becomes a flag that outlives the fault.',
  )
}

/**
 * THE BEHAVIOURAL HALF. From every faulting pair, going healthy must empty the
 * list — with no acknowledgement, no reset call and no second render — and
 * regressing must bring the same fault straight back.
 */
for (const reach of REACHES) {
  for (const bundle of BUNDLES) {
    const before = faults(reach, bundle)
    if (before.length === 0) continue

    if (faults('connected', 'matched').length !== 0) {
      fail(`recovery from (${reach}, ${bundle}) did not clear the alert`)
    }
    const again = faults(reach, bundle)
    if (again.length !== before.length) {
      fail(`a regression to (${reach}, ${bundle}) did not raise the alert again`)
    }
  }
}

/**
 * AND NO DISMISSAL MACHINERY IN THE SURFACES EITHER, which is the half a pure
 * function cannot speak for. A `localStorage` key or a `dismissed` state in the
 * chip or the banner would satisfy every assertion above and still leave an
 * alarm somebody can click away.
 *
 * `onOpenChange` and the dialog's own open state are exempt BY NAME rather than
 * by pattern: closing the popup closes a popup, and the chip and banner behind
 * it are rendered from the reading. That distinction is the feature.
 */
const surface = readFileSync(new URL('../src/components/DdbHealth.tsx', import.meta.url), 'utf8')
const banned = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['a dismissed flag', /\bdismiss(ed|able)?\s*[:=]/i],
  ['a snooze', /\bsnooz/i],
  ['an acknowledgement flag', /\backnowledged\b/i],
]
for (const [what, re] of banned) {
  // Comments discuss all of these at length; only code may not contain them.
  const code = surface
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  if (re.test(code)) {
    fail(`DdbHealth.tsx contains ${what} — the alert must end when the fault does`)
  }
}

/**
 * AND THE CHIP IS NOT INSIDE THE HEADER'S PRECEDENCE RULE. `chipCluster` exists
 * to make sure only one of the deploy/feed/update/maintenance chips speaks at a
 * time; a critical database fault must not be suppressible by a deploy in
 * flight, which is exactly what importing that rule here would allow.
 */
if (/from '@\/lib\/serverPhase'/.test(surface)) {
  fail(
    'DdbHealth.tsx imports the header chip precedence rule. A deploy in flight ' +
      'must not be able to suppress a critical br_ddb fault.',
  )
}

/* ------------------------------------------------------------------ */

if (failed) {
  console.error(`\nddb health: ${failed} case(s) failed.`)
  console.error(
    'Reachability and the bundle are two facts and must never share an ' +
      'indicator; unknown must never render as a failure; and the alert must ' +
      'end when the fault does, not when somebody clicks — see src/lib/ddbHealth.ts',
  )
  process.exit(1)
}
console.log(
  `ddb health: ${REACHES.length * BUNDLES.length} reading pairs stay distinct, ` +
    `${reachAbsences.length + bundleAbsences.length} absences read as unknown, ` +
    'and the alert has nothing to dismiss',
)
