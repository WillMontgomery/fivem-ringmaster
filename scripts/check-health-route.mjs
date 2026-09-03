/**
 * THE FIVE RULES `GET /api/health` MAY NOT BREAK.
 *
 * ═══ WHY THIS IS A GATE ═══
 *
 * The first version of this route shipped answering HTTP 200 with a literal
 * `ok: true` above three readings that could each say the console was broken.
 * Every one of the console's checks passed on it: it typechecks, it lints, it
 * has no unused import, and a screenshot of a healthy console looks identical
 * to a screenshot of a console in the middle of the outage `lib/dispatchHealth`
 * was written for. The only thing wrong with it was that it would have answered
 * an uptime checker "everything is fine" for the whole of that outage — which
 * is the one job it exists to do, and the one property nothing on disk could
 * see.
 *
 * That is this repo's signature failure and it is why every rule below is here:
 *
 *   1. THE VERDICT IS DERIVED. `ok` may not be a literal in the route, and it
 *      may not be computed there either — it comes from `lib/healthVerdict`, so
 *      that there is one place deciding what "broken" means.
 *
 *   2. THE VERDICT AGREES WITH THE FAULTS THE HOST PAGE ALREADY RAISES. Every
 *      `Dispatch` and `Reach` state that `dispatchFaults`/`faults` raise an
 *      alarm for must make the verdict false, and every state they deliberately
 *      do NOT raise for must leave it true. This is checked by ASKING those
 *      functions rather than against a list written here, so a sixth dispatch
 *      state added tomorrow is covered on the day it is added.
 *
 *   3. THE STATUS CODE CARRIES THE VERDICT. Next answers HEAD out of the GET
 *      handler with no body, so a checker can be looking at nothing but the
 *      status; a 200 with `ok:false` inside is invisible to it.
 *
 *   4. THE REFUSAL DOES NOT FLOOD THE JOURNAL. An unauthenticated caller must
 *      not be able to drive one log line per request on a route designed to be
 *      polled every thirty seconds forever — the same discipline `lib/telemetry`
 *      keeps by logging poll failures on the transition rather than the tick.
 *
 *   5. `docs/deploy.md` KNOWS THE ROUTE EXISTS. The route's own 503 body sends
 *      the operator to that document; it named four paths for this credential
 *      and this is the fifth. A pointer into a document that does not mention
 *      the thing it is pointing at is the stale-instruction failure that
 *      document warns about twice in its own text.
 *
 * A PLAIN SCRIPT, matching `check-dispatch-health.mjs` and `check-ddb-health.mjs`
 * — this repo has no test framework and adding one for this would be the larger
 * change. It runs in `npm run verify`.
 *
 * THE FUNCTIONS ARE IMPORTED FOR REAL, never re-implemented. `lib/healthVerdict`
 * and the three modules it composes have no runtime imports, so tsx loads the
 * shipped code and there is no second copy here to drift.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { faults } from '../src/lib/ddbHealth.ts'
import { dispatchFaults } from '../src/lib/dispatchHealth.ts'
import { feedNow, DEAD_MS, STALE_MS } from '../src/lib/feedHealth.ts'
import { verdictNow } from '../src/lib/healthVerdict.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

/** Every comment in this repo discusses what it forbids; only CODE may be searched. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let failed = 0
const fail = (msg) => {
  failed++
  console.error(`  FAIL  ${msg}`)
}

const ROUTE = 'src/app/api/health/route.ts'
const routeText = read(ROUTE)
const routeCode = code(routeText)

/** The seven words the payload's `dispatch` field can carry. */
const DISPATCH_STATES = [
  'ok',
  'unconfigured',
  'key-unreadable',
  'unreachable',
  'rejected',
  'verb-failed',
  'unknown',
]

/** The three words the payload's `ddb` field can carry. */
const REACH_STATES = ['connected', 'unreachable', 'unknown']

/** The four words `feedNow` resolves to. */
const FEED_STATES = ['live', 'stale', 'dead', 'offline']

/* ------------------------------------------------------------------ */
/* RULE 1 (FIRST, BECAUSE IT IS THE DEFECT) — the verdict is derived   */
/* ------------------------------------------------------------------ */

{
  if (!/verdictNow\s*\(/.test(routeCode)) {
    fail(
      `${ROUTE} does not call verdictNow(). The verdict must come from ` +
        'lib/healthVerdict, which is the one place that decides what "broken" ' +
        'means for this console — the route computing it itself is how the two ' +
        'get to disagree with the Host page.',
    )
  }

  /**
   * THE LITERAL, IN THE SHAPE IT SHIPPED IN. `ok: true` anywhere in this
   * route's code is the original defect verbatim: a route named `health`
   * asserting its own health rather than reporting it.
   */
  if (/\bok\s*:\s*(true|1)\b/.test(routeCode)) {
    fail(
      `${ROUTE} contains a hardcoded truthy \`ok\`. That is the defect this ` +
        'check exists for: the endpoint answered `ok: true` through the whole ' +
        'of an outage in which dispatch read `key-unreadable` and the game had ' +
        'not pushed for an hour.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* RULE 2 — the verdict agrees with the faults already being raised    */
/* ------------------------------------------------------------------ */

/** A reading that is well on every axis but the one under test. */
const WELL = { dispatch: 'ok', ddb: 'connected', feed: 'live' }

{
  if (!verdictNow(WELL)) {
    fail('a console that is well on all three readings is reported unwell')
  }

  /**
   * ASKED OF `dispatchFaults`, NOT OF A LIST HERE. That function is what draws
   * the red strip an admin sees, so this asserts the endpoint and the page
   * cannot disagree — including about a state that does not exist yet.
   */
  for (const state of DISPATCH_STATES) {
    const raised = dispatchFaults(state).length > 0
    const ok = verdictNow({ ...WELL, dispatch: state })
    if (raised && ok) {
      fail(
        `dispatch \`${state}\` raises a fault on the Host page and the health ` +
          'endpoint still answers ok. The endpoint would report green while a ' +
          'signed-in admin looks at a red strip about the same channel.',
      )
    }
    if (!raised && !ok) {
      fail(
        `dispatch \`${state}\` raises no fault and the health endpoint reports ` +
          'the console unwell. `unknown` and `unconfigured` are readings rather ' +
          'than alarms — a cold start and a development box must not page ' +
          'anybody, which is how an operator learns to ignore the real one.',
      )
    }
  }

  for (const state of REACH_STATES) {
    const raised = faults(state, 'unknown').length > 0
    const ok = verdictNow({ ...WELL, ddb: state })
    if (raised && ok) {
      fail(`ddb \`${state}\` raises a fault and the health endpoint answers ok`)
    }
    if (!raised && !ok) {
      fail(
        `ddb \`${state}\` raises no fault and the health endpoint reports the ` +
          'console unwell. `unknown` is never `unreachable` — lib/ddbHealth ' +
          'states that rule at all four doors it can arrive through.',
      )
    }
  }

  /**
   * THE FEED IS THE ONE AXIS WITH NO EXISTING `faults()` TO ASK, so its
   * expectations are written out — and written out in terms of what an operator
   * would be paged for rather than as a copy of `feedFailed`.
   */
  const FEED_EXPECT = { live: true, stale: true, dead: false, offline: false }
  for (const state of FEED_STATES) {
    const ok = verdictNow({ ...WELL, feed: state })
    if (ok !== FEED_EXPECT[state]) {
      fail(
        `feed \`${state}\` produced ok=${ok}, expected ${FEED_EXPECT[state]}. ` +
          '`stale` is a busy tick and clears itself; `dead` is a feed that ' +
          'stopped and `offline` is one that never started, and a console in ' +
          'either cannot answer any question anybody opens it to ask.',
      )
    }
  }

  /**
   * THE NULL AGE IS THE ONE THAT INVERTS. `liveView` hands out null for a
   * console that has never been pushed to, and any arithmetic that treated it
   * as zero would render "there has never been a feed" as "the feed is
   * perfectly fresh" — a green light on the worst reading there is.
   */
  if (feedNow(null) !== 'offline') {
    fail('feedNow(null) is not `offline` — a console never pushed to reads as fresh')
  }
  if (verdictNow({ ...WELL, feed: feedNow(null) })) {
    fail('a console the game has never pushed to is reported healthy')
  }
  if (verdictNow({ ...WELL, feed: feedNow(DEAD_MS + 1) })) {
    fail(`a feed ${DEAD_MS + 1}ms stale is reported healthy`)
  }
  if (!verdictNow({ ...WELL, feed: feedNow(STALE_MS + 1) })) {
    fail(`a feed only ${STALE_MS + 1}ms behind pages somebody — that is most nights`)
  }
}

/* ------------------------------------------------------------------ */
/* RULE 3 — the status code carries the verdict                        */
/* ------------------------------------------------------------------ */

{
  /**
   * The route must choose its status from the verdict. Matching the expression
   * rather than a number, because the failure being prevented is a constant
   * 200 and any hardcoded success status has that shape.
   */
  if (!/status:\s*ok\s*\?/.test(routeCode)) {
    fail(
      `${ROUTE} does not derive its status code from the verdict. Next answers ` +
        'HEAD out of the GET handler with NO BODY, so a HEAD probe sees the ' +
        'status and nothing else; a 200 carrying `ok:false` inside is invisible ' +
        'to it, and to every monitor configured to assert only 2xx.',
    )
  }
  if (!/\b503\b/.test(routeCode)) {
    fail(`${ROUTE} never answers 503 — an unwell console has no status to say so with`)
  }
}

/* ------------------------------------------------------------------ */
/* RULE 4 — an unauthenticated caller cannot flood the journal         */
/* ------------------------------------------------------------------ */

{
  const logs = routeCode.match(/console\.(error|warn|log)\s*\(/g) ?? []

  /**
   * EVERY LOG IN THIS FILE MUST BE BEHIND A ONCE-PER-PROCESS FLAG. The route is
   * designed to be polled every thirty seconds forever, and the branch that
   * logs fires for callers who presented no credential at all — 2,880 identical
   * error lines a day, in the journal an operator would be reading to find the
   * telemetry failure this endpoint just told them about.
   */
  if (logs.length > 0) {
    const guarded = /if\s*\(\s*!\s*warned[A-Za-z]*\s*\)\s*\{[\s\S]{0,200}?console\./.test(
      routeCode,
    )
    if (!guarded) {
      fail(
        `${ROUTE} logs without a once-per-process guard. lib/telemetry logs poll ` +
          'failures on the transition rather than on the tick so that a night of ' +
          'journal stays readable; a machine-polled route must do at least that.',
      )
    }
    if (logs.length > 1) {
      fail(
        `${ROUTE} has ${logs.length} log calls. Each one is a line an ` +
          'unauthenticated caller can ask for on a thirty-second cadence — add ' +
          'one only with its own suppression, and say why here.',
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* RULE 5 — the document the route points at describes the route       */
/* ------------------------------------------------------------------ */

{
  const deploy = read('docs/deploy.md')

  if (!deploy.includes('/api/health')) {
    fail(
      'docs/deploy.md never mentions /api/health. The route\'s own 503 body ' +
        'sends the operator there, and §6 is the operator-facing authority on ' +
        'COMMAND_SECRET — which this route is the fifth consumer of.',
    )
  }

  /**
   * THE SECTION THAT OWNS THE CREDENTIAL, and the one whose path table said
   * "one of four paths" while a fifth existed. Anchored on the heading so this
   * cannot be satisfied by a passing mention somewhere else in the file.
   */
  const six = deploy.slice(deploy.indexOf('## 6. `COMMAND_SECRET`'))
  const seven = six.slice(0, six.indexOf('\n## 7.'))
  if (!seven.includes('/api/health')) {
    fail(
      '§6 of docs/deploy.md does not mention /api/health. That section lists ' +
        'every path this credential opens and says "Nothing else"; an operator ' +
        'rotating the secret from it will not know the checker is a holder.',
    )
  }

  const checks = deploy.slice(deploy.indexOf('\n## Checks'))
  if (!/curl[^\n]*\/api\/health/.test(checks)) {
    fail(
      'the Checks section of docs/deploy.md has no curl for /api/health. It ' +
        'still sends an operator to /api/ingest for health, which answers a ' +
        'literal and cannot report anything being wrong.',
    )
  }
  if (!/x-ringmaster-service[^\n]*\/api\/health|\/api\/health[^\n]*x-ringmaster-service/.test(checks)) {
    fail(
      'the /api/health curl in docs/deploy.md sends no x-ringmaster-service ' +
        'header. Copied as written it returns 401, which is the documented ' +
        'command failing in front of the person following the document.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* THE PAYLOAD'S OWN DOCUMENTATION IS THE ONLY DOCUMENTATION IT HAS    */
/* ------------------------------------------------------------------ */

{
  /**
   * A CHECKER AUTHOR READS THIS FILE AND NOTHING ELSE, so a comment that names
   * the wrong number of `dispatch` values is a five-entry severity map with no
   * arm for the word a HEALTHY console returns. The comment said "one of five
   * words" while the union had seven; requiring every word to appear by name is
   * what makes that impossible to write again.
   */
  for (const state of DISPATCH_STATES) {
    if (!routeText.includes(`\`${state}\``)) {
      fail(
        `${ROUTE} never names the \`${state}\` dispatch state. This file is the ` +
          'only documentation the payload has, and a value a checker has no arm ' +
          'for is either a false page every poll or a fault treated as fine.',
      )
    }
  }

  /**
   * THE FLAG THAT KEEPS THE `branches` VERB HONEST. `ensurePolling` makes the
   * poller permanent for the life of the process, and lib/telemetry justifies
   * the git fetch it can trigger only by "the window in which somebody is
   * looking at the banner". A machine-polled route is not that window.
   */
  if (!/ensurePolling\(\s*\{[^}]*attended:\s*false/.test(routeCode)) {
    fail(
      `${ROUTE} calls ensurePolling() without \`attended: false\`. One health ` +
        'check would then run `git fetch --prune` on the game box every two ' +
        'minutes, all night, whenever the box is parked off main — to compute a ' +
        'banner nobody will look at until morning.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* ONE CLASSIFIER FOR THE FEED, AS FOR THE OTHER TWO CHANNELS          */
/* ------------------------------------------------------------------ */

{
  /**
   * The thresholds moved out of `components/FeedStatus.tsx` so that the header
   * chip and this endpoint could not disagree about the same fact. A second
   * copy anywhere is that disagreement waiting to happen: the chip reading
   * "Feed lost" while the endpoint an operator paged on answers green.
   */
  const feedFiles = ['src/components/FeedStatus.tsx', ROUTE]
  for (const f of feedFiles) {
    const c = code(read(f))
    if (/\b(STALE_MS|DEAD_MS)\s*=/.test(c)) {
      fail(
        `${f} declares its own feed threshold. lib/feedHealth is the one place ` +
          'that decides how old is too old; a second copy lets the header chip ' +
          'and the health endpoint contradict each other with no way to tell ' +
          'from either which is right.',
      )
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck-health-route: ${failed} problem(s)`)
  process.exit(1)
}
console.log('check-health-route: ok')
