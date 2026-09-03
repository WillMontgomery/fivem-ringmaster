/**
 * THE SEVEN RULES `GET /api/health` MAY NOT BREAK.
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
 *      state added tomorrow is covered on the day it is added. AND THE DEPLOY
 *      PHASE WITH THEM, asked of `silenceIsExplained` — the same function rung 1
 *      of the header's chip cluster consults. A deploy this console ordered
 *      restarts the game server, so the feed goes quiet on purpose, and the
 *      endpoint answered 503 through every planned deploy while the header
 *      showed one calm `Updating` chip about the same silence.
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
 *   6. THE STATUS CODES ARE A CLOSED SET, AND THE TWO `503`s ARE TOLD APART BY
 *      `error`. The route answers 200, 401 and 503 and nothing else; the
 *      not-configured 503 carries `error: 'not-configured'` and no readings,
 *      and an unhealthy 503 carries the FULL payload and no `error` at all.
 *
 *   7. THE FIELD NAMES AND THEIR TYPES DO NOT MOVE. `ok` boolean, `ingestAgeMs`
 *      milliseconds-or-null, `dispatch` the whole `Dispatch` union, `ddb` the
 *      whole `Reach` union and never a boolean, `deploy` the whole `DeployPhase`
 *      union and the SAME reading the verdict was handed, and `feedDeadMs` the
 *      `DEAD_MS` binding itself rather than a number typed out again.
 *
 * TWO ASSERTIONS BELOW REACH OUTSIDE THIS ROUTE'S OWN SUBJECT, on purpose,
 * because both things they guard have a second copy nobody in this repo can see.
 * The feed threshold used to be one of them — a hardcoded thirty seconds in the
 * external consumer, which is why its VALUE was once pinned here — and the fix
 * was to stop having two copies rather than to police them: the route publishes
 * `feedDeadMs`, and what is asserted now is that the number it publishes is the
 * number it judged with. And the `attended` gate this route introduced into
 * `lib/telemetry` has an else-branch whose job is to leave no reading standing
 * unrefreshed — a property no other check in the repo covers, on a code path no
 * other caller can reach. Both sit beside the rule that made them this route's
 * business.
 *
 * ═══ WHY 6 AND 7 ARE WORTH A GATE RATHER THAN A CODE REVIEW ═══
 *
 * BECAUSE THE CONSUMER IS NOT IN THIS REPOSITORY AND IS NOT RECOMPILED WITH IT.
 * An external checker parses this payload BY FIELD NAME and branches on the
 * status BY NUMBER, so `typecheck` has nothing to say about it: rename
 * `ingestAgeMs`, hand the millisecond age out in seconds, collapse `ddb` to a
 * boolean or add a fourth status code, and every check in this repo still
 * passes while the thing watching at four in the morning reads a field that is
 * no longer there. That is this route's original defect in a second costume —
 * a green light nothing on disk can see through.
 *
 * IT HAS ALREADY COST SOMEBODY AN OUTAGE'S WORTH OF DATA ONCE. A consumer
 * treating every 503 alike discarded the body of the unhealthy 503 — which is
 * the full payload, and the only thing that says which of three machines to go
 * and open — and reported the endpoint itself as down. Rule 6 is why that
 * distinction can no longer be softened by accident on this side.
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

import { faults, REACH_LABEL } from '../src/lib/ddbHealth.ts'
import { dispatchFaults, DISPATCH_LABEL } from '../src/lib/dispatchHealth.ts'
import { feedNow, DEAD_MS, STALE_MS } from '../src/lib/feedHealth.ts'
import { verdictNow } from '../src/lib/healthVerdict.ts'
import { silenceIsExplained } from '../src/lib/serverPhase.ts'

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

/** The five words the payload's `deploy` field can carry — `DeployPhase`. */
const DEPLOY_PHASES = ['idle', 'deploying', 'confirming', 'failed', 'unconfirmed']

/**
 * The six keys of the payload a healthy — or an unwell — console answers with,
 * in the order the route writes them.
 *
 * WRITTEN OUT RATHER THAN READ OFF THE ROUTE, because a list derived from the
 * thing it is checking agrees with it by construction. This is the external
 * consumer's copy: the names it has compiled into itself, kept here so that
 * changing one of them has to be done twice and deliberately.
 *
 * ═══ THE BUILD FAILING ON A NEW KEY IS THE FEATURE, NOT AN OBSTACLE ═══
 *
 * Worth saying plainly, because two more fields are already spoken for and
 * whoever adds one meets this line first and can reasonably read it as "the
 * payload is closed, do not do this". It is not closed. `ingestSenders` and
 * `doorShutSeconds` are both planned, the external collector already parses
 * both names and drops them while they are absent, and adding either is a
 * perfectly good change — it just has to be made HERE too, in the same commit,
 * so the consumer's copy of the names and the route's copy cannot drift apart
 * quietly. `deploy` and `feedDeadMs` were both added in exactly that way.
 *
 * A NEW KEY IS THE SAFE KIND OF CHANGE AND A RENAMED ONE IS NOT, which is why
 * this list is compared in order and by length: a by-name parser that has never
 * heard of a field simply does not read it, while one whose field was renamed
 * under it goes on reporting confidently about a value that is no longer there.
 */
const PAYLOAD_FIELDS = ['ok', 'ingestAgeMs', 'dispatch', 'ddb', 'deploy', 'feedDeadMs']

/**
 * The `error` value that distinguishes the two 503s, verbatim as the consumer
 * matches it.
 */
const NOT_CONFIGURED = 'not-configured'

/** The whole set of status codes this route is allowed to answer with. */
const STATUS_CODES = ['200', '401', '503']

/**
 * THE SENTENCE EVERY RULE 6 AND 7 FAILURE ENDS WITH. It is the reason none of
 * these is a matter of taste: the reader of this payload is not in this
 * repository, was not rebuilt when the change was made, and will go on parsing
 * the old names until somebody notices it has been wrong for a week.
 */
const BY_NAME =
  'An external consumer parses these by name — the field names, their types ' +
  'and the status codes are its interface, it is not recompiled with this ' +
  'repo, and it fails silently rather than loudly when one of them moves.'

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

  /**
   * ═══ A DEPLOY THIS CONSOLE ORDERED EXPLAINS THE SILENCE IT CAUSES ═══
   *
   * THIS IS THE CASE THAT SHIPPED WRONG AND NOTHING COULD SEE IT.
   * `royale-deploy` restarts FXServer; `lib/maintenanceDriver` says outright
   * that this "is exactly the window in which the feed goes quiet";
   * `RESTART_GRACE_MS` allows five minutes of it. Thirty seconds in, `feedNow`
   * said `dead` and the endpoint answered `503 {"ok":false}` for the rest of the
   * restart — to a monitor `docs/deploy.md` tells the operator to wire up —
   * while an admin looking at the header saw one calm `Updating` chip, because
   * `chipCluster` rung 1 hides the feed chip during a deploy for precisely this
   * reason. The endpoint and the page contradicted each other about the same
   * fact, which is the failure both modules say they exist to prevent.
   *
   * ASKED OF `silenceIsExplained`, NOT OF A LIST WRITTEN HERE, for the reason
   * rule 2 asks `dispatchFaults`: that function is what rung 1 of the header's
   * chip cluster consults, so this asserts the endpoint and the page cannot
   * disagree — including about a sixth phase added tomorrow.
   */
  for (const phase of DEPLOY_PHASES) {
    const excused = silenceIsExplained(phase)

    for (const feed of FEED_STATES) {
      const ok = verdictNow({ ...WELL, feed, deploy: phase })
      const expected = excused ? true : FEED_EXPECT[feed]
      if (ok !== expected) {
        fail(
          `feed \`${feed}\` during deploy phase \`${phase}\` produced ok=${ok}, ` +
            `expected ${expected}. A restart this console ordered is why the ` +
            'game is quiet, and paging on it pages the operator on every planned ' +
            'deploy — which is how they learn to silence the check that matters. ' +
            'Equally, a phase that is NOT in flight must not buy a dead feed a ' +
            'green light: `unconfirmed` is a server that never came back.',
        )
      }
    }

    /**
     * THE EXCUSE IS THE FEED AXIS AND NOTHING ELSE. An SSH key that stopped
     * loading is a fault whenever it happens, and a deploy is not a reason to
     * stop reporting it — suppressing the whole verdict would turn a five-minute
     * window into a five-minute blind spot on the two channels a restart of the
     * game server has no bearing on.
     */
    for (const state of DISPATCH_STATES) {
      if (dispatchFaults(state).length === 0) continue
      if (verdictNow({ ...WELL, dispatch: state, deploy: phase })) {
        fail(
          `dispatch \`${state}\` raises a fault and the verdict is still ok ` +
            `during deploy phase \`${phase}\`. Only the FEED axis is excused by ` +
            'a deploy.',
        )
      }
    }
    for (const state of REACH_STATES) {
      if (faults(state, 'unknown').length === 0) continue
      if (verdictNow({ ...WELL, ddb: state, deploy: phase })) {
        fail(
          `ddb \`${state}\` raises a fault and the verdict is still ok during ` +
            `deploy phase \`${phase}\`. Only the FEED axis is excused by a deploy.`,
        )
      }
    }
  }

  /**
   * NOT PASSING A PHASE MUST BEHAVE AS `idle`, EXCUSING NOTHING. A caller that
   * has not looked at the maintenance window must not be handed a quieter
   * verdict for not asking, which is the direction a default of "in flight"
   * would have taken it.
   */
  for (const feed of FEED_STATES) {
    if (
      verdictNow({ ...WELL, feed }) !== verdictNow({ ...WELL, feed, deploy: 'idle' })
    ) {
      fail(
        `omitting \`deploy\` does not behave as \`idle\` for feed \`${feed}\`. An ` +
          'absent reading must never excuse anything — see lib/healthVerdict.',
      )
    }
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

  /**
   * ═══ AND THE OTHER HALF OF THAT FLAG: NOT POLLING MUST READ AS AN ABSENCE ═══
   *
   * WHAT THE `attended` GATE DID BY ACCIDENT. Before it existed, a box PARKED
   * off main always took the polling branch, so `refUpdate` was refreshed every
   * two minutes for the life of the process and could not go stale. The gate
   * gave `poll` a path where it neither refreshes that reading nor clears it —
   * and the only other thing that clears it is `if (!parked)`, which by
   * definition does not fire on a parked box. The value therefore FREEZES at
   * whatever the last attended tick saw, all night.
   *
   * WHY THAT IS WORSE THAN NULL, AND IT IS NOT SYMMETRIC. `refBehindNow` and
   * `refBlockedNow` apply NO age bound of their own — only `updateTargetNow`
   * does, through `TARGET_MAX_AGE_MS` — because both were written when this
   * reading could not be more than two minutes old. A frozen `behind: 0` tells
   * an operator with a commit in hand that there is nothing to ship; a frozen
   * `eligible: false` greys the Schedule button on a branch that was fixed at
   * midnight, against `lib/maintenance`'s stated reasoning that honouring a
   * stale refusal "costs at most one refresh". Null claims nothing and refuses
   * nothing, which is the polarity every reader of it already assumes.
   *
   * IT IS CHECKED HERE BECAUSE `/api/health` IS WHY THE GATE EXISTS. Nothing
   * else in this repo passes `attended: false`, so this endpoint is the only
   * caller that can put the poller into the state above.
   */
  const telCode = code(read('src/lib/telemetry.ts'))
  const gateAt = telCode.indexOf('const attended =')
  const elseAt = gateAt === -1 ? -1 : telCode.indexOf('else', gateAt)
  const branch =
    elseAt === -1 ? null : callArgs(telCode, telCode.indexOf('{', elseAt))

  if (branch === null) {
    fail(
      'check-health-route could not find the `attended` gate in lib/telemetry ' +
        "poll(). The gate is what keeps `git fetch --prune` off an unattended " +
        'box, and its else-branch is what stops the readings it skips from ' +
        'freezing. If the shape changed, this check has to change with it — do ' +
        'not delete it.',
    )
  } else {
    for (const field of ['refUpdate', 'updateTarget', 'refKey', 'refPolledAt']) {
      if (!new RegExp(`state\\.${field}\\s*=`).test(branch)) {
        fail(
          'the unattended branch of lib/telemetry poll() does not clear ' +
            `\`state.${field}\`. A reading this branch stops refreshing and does ` +
            'not clear is a claim that stands all night with nothing correcting ' +
            'it — and `refBehindNow`/`refBlockedNow` apply no age bound, so a ' +
            'frozen zero reads as "nothing to ship" and a frozen refusal greys a ' +
            'button on a branch that has since been fixed.',
        )
      }
    }
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

  /**
   * ═══ AND THE THRESHOLD LEAVES THIS REPOSITORY WITH THE READING IT JUDGES ═══
   *
   * THIS RULE REPLACED A PIN ON THE VALUE, AND THE SWAP IS THE WHOLE POINT.
   * What stood here was `if (DEAD_MS !== 30_000) fail(…)`, because the external
   * consumer's own threshold was a hardcoded thirty seconds in another
   * repository that derived nothing from here: move this constant alone and the
   * two surfaces disagreed about the word "dead", silently, in whichever
   * direction was worse. Pinning the value made that loud — at the price of
   * making a legitimate change to a constant fail a build for a reason that was
   * not in this repository at all, which is a check somebody eventually deletes
   * with a shrug.
   *
   * THE PAYLOAD NOW CARRIES THE NUMBER, so the consumer holds no copy to drift
   * and the value is free to move again. What has to be true instead is that the
   * PUBLISHED number is the JUDGED number: `feedDeadMs: DEAD_MS`, the same
   * binding `feedNow` resolved the feed with, and never a literal. A literal
   * here would be the identical duplication moved twelve lines up the file,
   * where it would look like documentation.
   *
   * Every other assertion about `DEAD_MS` in this file is relative —
   * `feedNow(DEAD_MS + 1)` — so all of them hold whatever the constant becomes.
   * That is now true of the consumer as well.
   */
  const routeImports = /import\s*\{[^}]*\bDEAD_MS\b[^}]*\}\s*from\s*'@\/lib\/feedHealth'/.test(
    routeCode,
  )
  if (!routeImports) {
    fail(
      `${ROUTE} does not import DEAD_MS from lib/feedHealth. The payload has to ` +
        'carry the threshold this console judged the feed against, and it has to ' +
        'be that module\'s constant rather than a number typed into the route — ' +
        'a second copy here is the same two-places-one-fact the module exists to ' +
        'close, at a distance where nobody can see both halves.',
    )
  }
}

/* ------------------------------------------------------------------ */
/* READING THE ROUTE'S OWN RESPONSES, RATHER THAN GREPPING FOR WORDS   */
/* ------------------------------------------------------------------ */

/**
 * A SMALL SCANNER, AND IT EARNS ITS KEEP OVER A REGEX. Rules 6 and 7 are about
 * the WHOLE set of responses — that there are exactly three of them, that each
 * carries exactly these keys and no others, and that no fourth status code has
 * appeared. A regex can say "503 is present somewhere"; it cannot say "and
 * nothing else is", which is the half of the assertion that catches an added
 * status code or a quietly appended field.
 *
 * It walks the comment-stripped source, so no prose in this repo — including
 * the paragraph in the route that documents these very codes — can satisfy it.
 */

/** Skip to the character after a string literal opened at `i`. */
function endOfString(text, i) {
  const quote = text[i]
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++
    else if (text[j] === quote) return j
  }
  return text.length
}

/** The text between `(` at `from` and its matching `)`. */
function callArgs(text, from) {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = endOfString(text, i)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(from + 1, i)
    }
  }
  return null
}

/** Split on commas at nesting depth zero, so `ok ? 200 : 503` stays one piece. */
function topLevelParts(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = endOfString(text, i)
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

/** An object literal's own keys, mapped to the expression each is given. */
function fieldsOf(literal) {
  const inner = literal.trim().replace(/^\{/, '').replace(/\}$/, '')
  const fields = new Map()
  for (const entry of topLevelParts(inner)) {
    const pair = /^([A-Za-z_$][\w$]*)\s*:([\s\S]*)$/.exec(entry)
    if (pair) fields.set(pair[1], pair[2].trim())
    // `ok,` — shorthand, whose value is the identifier itself.
    else if (/^[A-Za-z_$][\w$]*$/.test(entry)) fields.set(entry, entry)
  }
  return fields
}

/** Every `Response.json(body, init)` the route makes. */
function responsesIn(text) {
  const found = []
  const NEEDLE = 'Response.json('
  for (let at = text.indexOf(NEEDLE); at !== -1; at = text.indexOf(NEEDLE, at + 1)) {
    const args = callArgs(text, at + NEEDLE.length - 1)
    if (args === null) continue
    const [body = '', init = ''] = topLevelParts(args)
    const status = fieldsOf(init).get('status') ?? ''
    found.push({
      fields: fieldsOf(body),
      status,
      codes: status.match(/\b\d{3}\b/g) ?? [],
    })
  }
  return found
}

const named = (fields) => [...fields.keys()]
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/* ------------------------------------------------------------------ */
/* RULE 6 — the status codes are closed, and the two 503s differ       */
/* ------------------------------------------------------------------ */

const answers = responsesIn(routeCode)

/**
 * THE THREE ARMS, CLASSIFIED BY WHAT THEY CARRY RATHER THAN BY WHERE THEY SIT.
 * Identifying them by position would make this check fail on a reordering that
 * changes nothing a consumer can see, and pass on the one thing it must catch:
 * an `error` field appearing in — or vanishing from — a body it does not belong
 * in.
 */
const armOf = (r) =>
  r.fields.has('error') ? 'refused' : r.fields.has('dispatch') ? 'verdict' : 'auth'

const arms = new Map()
for (const r of answers) {
  const arm = armOf(r)
  if (arms.has(arm)) {
    fail(
      `${ROUTE} has two responses of the same kind (\`${arm}\`). Each of the ` +
        `three answers this route can give must be written once, or a consumer ` +
        `hits whichever one it happens to reach. ${BY_NAME}`,
    )
  }
  arms.set(arm, r)
}

{
  if (answers.length !== 3) {
    fail(
      `${ROUTE} makes ${answers.length} responses; the contract has exactly ` +
        `three — 200 with the readings, 401 without a credential, and the two ` +
        `503s. Adding a fourth is a new case for something outside this repo ` +
        `to handle, and it will not handle it. ${BY_NAME}`,
    )
  }

  const codes = [...new Set(answers.flatMap((r) => r.codes))].sort()
  if (!same(codes, STATUS_CODES)) {
    fail(
      `${ROUTE} answers with status codes [${codes.join(', ')}]; the pinned set ` +
        `is [${STATUS_CODES.join(', ')}]. A status nobody was told about is a ` +
        `branch the checker does not have. ${BY_NAME}`,
    )
  }

  /**
   * THE NOT-CONFIGURED 503, WHICH IS THE ONE THAT CARRIES NO READINGS. Its
   * `error` string is the ONLY thing separating "this console declines to
   * answer" from "this console answered, and the answer is bad".
   */
  const refused = arms.get('refused')
  if (!refused) {
    fail(
      `${ROUTE} has no response carrying an \`error\` field. The unset-secret ` +
        `503 must be distinguishable from an unhealthy 503, and \`error\` is ` +
        `the field that does it. ${BY_NAME}`,
    )
  } else {
    if (!same(refused.codes, ['503'])) {
      fail(
        `the \`error\` response in ${ROUTE} answers [${refused.codes.join(', ')}] ` +
          `rather than 503. ${BY_NAME}`,
      )
    }
    if (!new RegExp(`^['"\`]${NOT_CONFIGURED}['"\`]$`).test(refused.fields.get('error') ?? '')) {
      fail(
        `the not-configured 503 in ${ROUTE} no longer carries the literal ` +
          `\`error: '${NOT_CONFIGURED}'\`. That exact string is what a consumer ` +
          `compares against to tell this 503 from the one that carries a full ` +
          `payload. ${BY_NAME}`,
      )
    }
    if (!same(named(refused.fields).sort(), ['error', 'ok'])) {
      fail(
        `the not-configured 503 in ${ROUTE} carries ` +
          `[${named(refused.fields).join(', ')}]; it must carry \`ok\` and ` +
          `\`error\` and nothing else. A reading in this body would be a reading ` +
          `from a console that did not look. ${BY_NAME}`,
      )
    }
  }

  /**
   * THE UNHEALTHY 503, WHICH IS A FULL ANSWER AND NOT A FAILURE TO ANSWER. It
   * must come out of the SAME `Response.json` as the 200 — that is what makes
   * "503 carries the whole payload" true by construction rather than by two
   * bodies that have to be kept in step.
   */
  const verdict = arms.get('verdict')
  if (!verdict) {
    fail(
      `${ROUTE} has no response carrying the readings. ${BY_NAME}`,
    )
  } else {
    if (verdict.fields.has('error')) {
      fail(
        `the payload response in ${ROUTE} carries an \`error\` field. \`error\` ` +
          `is what marks the OTHER 503 — the one with no readings in it — and a ` +
          `consumer that finds it here will discard a body that answered its ` +
          `question in full. ${BY_NAME}`,
      )
    }
    if (!same([...verdict.codes].sort(), ['200', '503'])) {
      fail(
        `the payload response in ${ROUTE} answers ` +
          `[${verdict.codes.join(', ')}]; the same body must be able to come ` +
          `back 200 or 503, because an unhealthy console answers 503 WITH every ` +
          `reading populated. ${BY_NAME}`,
      )
    }
  }

  /**
   * THE 401 SAYS NOTHING ELSE. It is the one answer a caller with no credential
   * can provoke, so anything in it is a fact handed to the unauthenticated.
   */
  const auth = arms.get('auth')
  if (auth && !same(named(auth.fields), ['ok'])) {
    fail(
      `the 401 in ${ROUTE} carries [${named(auth.fields).join(', ')}]; it must ` +
        `carry \`ok\` alone. Anything else is a reading given to a caller who ` +
        `presented nothing. ${BY_NAME}`,
    )
  }
}

/* ------------------------------------------------------------------ */
/* RULE 7 — the field names, and what each one carries                 */
/* ------------------------------------------------------------------ */

{
  const verdict = arms.get('verdict')
  const keys = verdict ? named(verdict.fields) : []

  if (verdict && !same(keys, PAYLOAD_FIELDS)) {
    fail(
      `${ROUTE} answers with [${keys.join(', ')}]; the contract is ` +
        `[${PAYLOAD_FIELDS.join(', ')}]. ${BY_NAME}`,
    )
  }

  /**
   * `ok` IS A BOOLEAN AND IS THE VERDICT'S OWN RETURN VALUE. A consumer's
   * commonest assertion after the status code is `.ok == true`; a truthy string
   * or a number would satisfy it in every state including the broken ones.
   */
  if (typeof verdictNow(WELL) !== 'boolean') {
    fail(`verdictNow does not return a boolean, so \`ok\` is not one. ${BY_NAME}`)
  }

  /**
   * `ingestAgeMs` IS MILLISECONDS AND IS NULLABLE, and both halves of that
   * sentence are load-bearing in opposite directions. Divide it to seconds
   * without renaming and every threshold downstream is a thousand times too
   * large; coalesce the null to a zero and a console the game has NEVER pushed
   * to reports the freshest possible feed.
   */
  if (verdict && verdict.fields.get('ingestAgeMs') !== 'live.ageMs') {
    fail(
      `${ROUTE} no longer hands out \`liveView().ageMs\` verbatim as ` +
        `\`ingestAgeMs\` — it carries \`${verdict.fields.get('ingestAgeMs')}\`. ` +
        `The field is milliseconds, it is null when the game has never pushed, ` +
        `and both facts are in the name and the value rather than anywhere a ` +
        `consumer could look them up. ${BY_NAME}`,
    )
  }
  if (/ageMs\s*(\?\?|\|\||\/)/.test(routeCode)) {
    fail(
      `${ROUTE} coalesces or divides \`ageMs\`. A \`?? 0\` renders "there has ` +
        `never been a feed" as "the feed is perfectly fresh"; a division makes ` +
        `the field seconds while its name still says milliseconds. ${BY_NAME}`,
    )
  }
  if (feedNow(null) !== 'offline') {
    fail(`feedNow(null) is not \`offline\`, so a null age is no longer a fault. ${BY_NAME}`)
  }

  /**
   * `ddb` IS THREE WORDS AND NEVER A BOOLEAN. `unknown` is not `unreachable`,
   * and a boolean has nowhere to put the difference — `false` would mean both
   * "the game says it cannot reach its store" and "nobody has told this console
   * anything", which are a page and a shrug respectively.
   */
  const reachStates = Object.keys(REACH_LABEL).sort()
  if (!same(reachStates, [...REACH_STATES].sort())) {
    fail(
      `the \`Reach\` union is now [${reachStates.join(', ')}] and this check ` +
        `pins [${REACH_STATES.join(', ')}]. \`ddb\` carries these words ` +
        `verbatim. ${BY_NAME}`,
    )
  }
  if (reachStates.some((s) => typeof s !== 'string' || s === 'true' || s === 'false')) {
    fail(`\`ddb\` is not a three-state string. ${BY_NAME}`)
  }
  if (verdict && verdict.fields.get('ddb') !== 'host.ddb.reach') {
    fail(
      `${ROUTE} carries \`ddb: ${verdict.fields.get('ddb')}\` rather than the ` +
        `resolved \`host.ddb.reach\`. Anything that reduces it — a comparison, a ` +
        `\`Boolean()\`, a truthiness test — throws away the distinction between ` +
        `\`unreachable\` and \`unknown\`. ${BY_NAME}`,
    )
  }

  /**
   * `dispatch` IS THE WHOLE UNION, ASKED OF THE LABEL MAP RATHER THAN COUNTED
   * BY HAND. `DISPATCH_LABEL` is a `Record<Dispatch, string>`, so TypeScript
   * makes it exhaustive and an eighth state cannot be added without appearing
   * here — which is what turns "the route's comment said five when there were
   * seven" into a build failure rather than a checker with two missing arms.
   */
  const dispatchStates = Object.keys(DISPATCH_LABEL).sort()
  if (!same(dispatchStates, [...DISPATCH_STATES].sort())) {
    fail(
      `the \`Dispatch\` union is now [${dispatchStates.join(', ')}] and this ` +
        `check pins [${DISPATCH_STATES.join(', ')}]. Add the new word here and ` +
        `name it in the route, then tell whoever runs the check: an unhandled ` +
        `\`dispatch\` value is either a false page every poll or a fault read as ` +
        `fine. ${BY_NAME}`,
    )
  }
  if (verdict && verdict.fields.get('dispatch') !== 'host.dispatch') {
    fail(
      `${ROUTE} carries \`dispatch: ${verdict.fields.get('dispatch')}\` rather ` +
        `than the resolved \`host.dispatch\`. The word is the whole value of the ` +
        `field: it is what says which of three machines to go and open. ` +
        `${BY_NAME}`,
    )
  }

  /**
   * `deploy` IS THE PHASE `verdictNow` WAS HANDED, AND THE SAME ONE. The rule it
   * serves is `lib/healthVerdict`'s: every reason the verdict moves must be a
   * field in the body the checker just received. A `deploy` computed separately
   * from the one passed to the verdict — a second `deployPhase` call, a second
   * `maintenanceView()` read — would sample the window twice and could report a
   * phase that did not produce the `ok` beside it, which is worse than omitting
   * the field: it would look like an explanation and be a coincidence.
   */
  if (verdict && verdict.fields.get('deploy') !== 'deploy') {
    fail(
      `${ROUTE} carries \`deploy: ${verdict.fields.get('deploy')}\` rather than ` +
        `the same \`deploy\` binding handed to verdictNow. It is the field that ` +
        `explains why a large \`ingestAgeMs\` is answering 200, and an ` +
        `explanation resolved separately from the thing it explains is not one. ` +
        `${BY_NAME}`,
    )
  }
  if (!/verdictNow\s*\(\s*\{[^}]*\bdeploy\b/.test(routeCode)) {
    fail(
      `${ROUTE} does not pass \`deploy\` to verdictNow. Without it the endpoint ` +
        `answers 503 for up to five minutes through every deploy this console ` +
        `itself scheduled, while the header shows a calm \`Updating\` chip about ` +
        `the same silence. See lib/healthVerdict.`,
    )
  }

  /**
   * `feedDeadMs` IS THE CONSTANT ITSELF — `DEAD_MS`, not `30_000`, not
   * `DEAD_MS / 1000`, not a second reading of anything.
   *
   * THE FIELD EXISTS SO THAT NOBODY DOWNSTREAM HOLDS A COPY OF THIS NUMBER, and
   * a literal written here would recreate the copy inside the very payload that
   * was supposed to retire it — with the added cruelty that it would then be
   * WRONG rather than merely duplicated the day `lib/feedHealth` moved and this
   * line did not. Pinning the expression is what makes "the published threshold
   * is the judged threshold" true by construction.
   *
   * MILLISECONDS, LIKE `ingestAgeMs` BESIDE IT. The two are compared directly by
   * whatever is reading them, so a division here would be a unit mismatch a
   * thousand-fold wide, in a comparison nothing in this repository ever runs.
   */
  if (verdict && verdict.fields.get('feedDeadMs') !== 'DEAD_MS') {
    fail(
      `${ROUTE} carries \`feedDeadMs: ${verdict.fields.get('feedDeadMs')}\` rather ` +
        `than lib/feedHealth's \`DEAD_MS\` itself. The field is the threshold this ` +
        `console judged \`ingestAgeMs\` with; anything but the binding is a second ` +
        `copy of the number, and a consumer comparing an age against a stale copy ` +
        `of the threshold reports on a rule this console is no longer using. ` +
        `${BY_NAME}`,
    )
  }

  /**
   * EVERY PHASE NAMED IN THE ROUTE, for the reason every `dispatch` word is:
   * this file is the only documentation the payload has, and a checker author
   * with no arm for `unconfirmed` has no arm for the one state that means the
   * game server was restarted and did not come back.
   */
  for (const phase of DEPLOY_PHASES) {
    if (!routeText.includes(`\`${phase}\``)) {
      fail(`${ROUTE} never names the \`${phase}\` deploy phase. ${BY_NAME}`)
    }
  }
}

if (failed > 0) {
  console.error(`\ncheck-health-route: ${failed} problem(s)`)
  process.exit(1)
}
console.log('check-health-route: ok')
