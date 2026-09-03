import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@/lib/env'
import { feedNow } from '@/lib/feedHealth'
import { verdictNow } from '@/lib/healthVerdict'
import { COMMAND_SECRET_HEADER } from '@/lib/service'
import { liveView } from '@/lib/state'
import { ensurePolling, hostView } from '@/lib/telemetry'

/**
 * An operator health endpoint, for something outside a browser to ask this
 * console how it is doing.
 *
 * ═══ WHY `GET /api/ingest` WAS NOT ALREADY THIS ═══
 *
 * That route answers `{ ok: true }` and the value is a literal. It proves Next
 * is serving and it proves nothing else — a console whose game feed died an
 * hour ago and whose SSH key stopped loading answers it exactly as cheerfully
 * as a healthy one. It is deliberately that thin, because its audience is a
 * human with curl on the game box asking "is anything listening", and it must
 * stay thin: it is unauthenticated.
 *
 * ═══ THE TWO FACTS AN OPERATOR ACTUALLY WANTS ═══
 *
 * How stale the game feed is, and whether the channel to the game box works.
 * Both already exist, resolved and in memory, and both were reachable only
 * through session-gated pages — so the only way to learn either was to open a
 * browser and sign in, which is precisely what an external check cannot do.
 * Nothing below computes anything new; it reads three readings the console
 * already keeps and puts them where something without a cookie can see them.
 *
 *   ingestAgeMs   how long since the game last pushed (`liveView`)
 *   dispatch      the SSH channel, as one word (`dispatchNow`)
 *   ddb           the game's own reachability probe (`reachNow`)
 *
 * ═══ THE MULTI-STATE `dispatch` IS THE POINT, NOT A BOOLEAN ═══
 *
 * `dispatch` is one of the SEVEN words in the `Dispatch` union: `ok` when the
 * channel works, `unknown` before this process has landed a poll, and five
 * failure states — `unconfigured`, `key-unreadable`, `unreachable`, `rejected`,
 * `verb-failed` — that each name WHERE the call stopped.
 *
 * IT IS WORTH BEING PRECISE ABOUT THAT COUNT, because this comment used to say
 * "one of five words" and a checker author reading it would have built a
 * five-entry map with no arm for the value a HEALTHY console returns, nor for
 * the one it returns on the first check after a restart. `lib/dispatchHealth`'s
 * "THE STATES ARE FIVE" is about the five failure LOCATIONS, which sit on three
 * different machines; it is not the size of the value domain. That module says
 * at length why those five must not collapse to "unhealthy": what an operator
 * does next is decided entirely by which one it is, and a checker that
 * flattened them would throw away the only part of the answer that says which
 * box to go and look at.
 *
 * ═══ `ok` IS A VERDICT, NOT A LIVENESS FLAG ═══
 *
 * The first version of this route answered `ok: true` as a literal, above three
 * readings that could all say the console was broken — which made the field a
 * statement that the request had been authorised, wearing the name of a
 * statement about the console. On a route called `health` those are not the
 * same word, and the gap between them is the outage this endpoint exists to
 * catch. `lib/healthVerdict` now decides it: the verdict is false exactly when
 * this console is raising a fault a signed-in admin would see on the Host page,
 * and every reason it can be false is one of the three fields in the same body.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Constant-time comparison of the command credential.
 *
 * LIFTED, UNCHANGED IN SHAPE, FROM `/api/ingest` — which is also where
 * `lib/service.ts` got its copy. Hashed first so both sides are always 32
 * bytes, because `timingSafeEqual` throws on a length mismatch and catching
 * that throw would itself leak the length of the real secret through timing.
 */
function secretMatches(presented: string | null, configured: string): boolean {
  if (!presented) return false

  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(configured).digest()

  return timingSafeEqual(a, b)
}

/**
 * ONCE PER PROCESS, NOT ONCE PER REQUEST.
 *
 * The unset-secret refusal below logs, and the first version of it logged on
 * every call. That is the same journal-flooding the 401 arm a few lines further
 * down explicitly refuses to do, and it was worse here: this arm fires for
 * callers who presented nothing at all, so an operator who points a
 * thirty-second checker at this route before pasting the secret in gets 2,880
 * identical error lines a day — in the very journal they would be reading to
 * find the telemetry failure. `lib/telemetry` goes out of its way to log poll
 * failures on the transition rather than on the tick for exactly that reason.
 * This is the same discipline in the cheapest form the case needs, because
 * "COMMAND_SECRET is unset" cannot change without a restart.
 */
let warnedUnconfigured = false

/**
 * Health, for an external check holding `COMMAND_SECRET`.
 *
 * ═══ WHY THIS IS GUARDED AT ALL, GIVEN IT ONLY REPORTS ON OURSELVES ═══
 *
 * Because the reverse proxy in front of this box sends everything on the public
 * hostname to the local Next server, so "a route with no gate" and "a route the
 * whole internet can read" are the same sentence here. What it would hand out
 * is a running commentary on how healthy the operator's infrastructure is and
 * exactly when it is not — which is a reconnaissance feed, told at whatever
 * cadence the reader likes. The facts are individually mild and the stream of
 * them is not.
 *
 * ═══ WHOEVER RUNS THE CHECK BECOMES A HOLDER OF THE COMMAND CREDENTIAL ═══
 *
 * THIS IS THE SENTENCE TO READ BEFORE WIRING ANYTHING UP, because the issue's
 * choice of credential makes it the default way this endpoint gets used.
 * `COMMAND_SECRET` opens `POST /api/kick`, `/api/bans`, `/api/maintenance` and
 * `/api/maintenance/cancel`; `docs/deploy.md` §6 puts the blast radius as
 * "whoever holds this string can ban players and restart the game server".
 * Pasting it into a hosted uptime monitor's custom-header box makes that vendor
 * a third holder of it, beside this console and `/opt/blitz-bot/.env` — and the
 * rotation procedure in that section knows about those two files and not about
 * the monitor, so a rotation silently leaves the checker on a stale secret.
 *
 * That is a real cost, it is stated in §6 alongside the two files, and it is a
 * reason to prefer a checker you run yourself — and the argument for a separate
 * read-only secret if this endpoint ever grows a second consumer. It is not a
 * reason to leave the route open, for the paragraph above.
 *
 * ═══ DELIBERATELY NOT THROUGH `serviceGate()`, AND THIS IS THE PARAGRAPH THE
 *     NEXT READER IS LOOKING FOR ═══
 *
 * The obvious tidy-up here is "there is already a gate for this credential, use
 * it". It is the wrong move, for two reasons that both come from that gate's
 * own purpose.
 *
 * FIRST, `serviceGate` DEMANDS AN `x-ringmaster-actor` DISCORD ID and refuses
 * 400 `actor` without one. That is not an incidental requirement — it exists so
 * that a WRITE relayed by a machine still names the human it is attributed to,
 * because an unattributable ban is the thing the audit table exists to prevent.
 * There is no human behind a health check. Satisfying that gate would mean
 * inventing a Discord id for a caller that has none, which is exactly the kind
 * of decorative identity `lib/service.ts` refuses to accept anywhere else.
 *
 * SECOND, `SERVICE_ROUTES` IS A WRITE ALLOWLIST AND SAYS SO IN ITS OWN COMMENT:
 * "READS ARE NOT ON THIS LIST EITHER, and they are excluded structurally rather
 * than by policy". Adding a read to it would make that sentence false, and
 * `check:service` section E would fail on the addition — it walks the routes on
 * disk and requires every allowlisted path to call `authorizeWrite()`, which
 * this route must never do. The check is not in the way; it is holding the line
 * that the credential's scope is a decision somebody makes on purpose.
 *
 * So the credential is compared here, locally, in the same shape `/api/ingest`
 * compares its own. One header, one string, no identity, no audit row —
 * because nothing here is an action anybody could be attributed for.
 *
 * ═══ THE UNSET SECRET IS 503, AND SO IS AN UNWELL CONSOLE ═══
 *
 * `COMMAND_SECRET` is optional in `lib/env.ts` and unset is a supported state
 * that closes this door entirely. `serviceGate` distinguishes that case from a
 * wrong secret in the response as well as in the log, and the same argument
 * holds here with more force: the whole readership of this route is an operator
 * wiring up a check, and "nobody ever set the variable" versus "your secret is
 * stale" is otherwise a long evening. 503 because it is this console that is
 * not ready, not the caller that is wrong.
 *
 * AN UNHEALTHY CONSOLE ANSWERS 503 TOO, AND THE OVERLAP IS DELIBERATE RATHER
 * THAN SLOPPY. The two are told apart in the body — `error: 'not-configured'`
 * against the three readings — and to the person being paged they mean the same
 * thing: this console cannot answer for the estate, go and look at it.
 *
 * THE STATUS CODE HAS TO CARRY THE VERDICT, because for a HEAD probe it is the
 * ONLY thing that can. Next answers HEAD out of this GET handler with no body
 * at all, so a 200 carrying `ok:false` inside would be invisible to exactly the
 * simplest kind of checker somebody points at a route called `health` — and a
 * monitor asserting nothing but `2xx` is the commonest configuration there is.
 */
export async function GET(req: Request): Promise<Response> {
  const configured = env().COMMAND_SECRET
  if (!configured) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      console.error(
        '[health] REFUSING health checks: COMMAND_SECRET is not set on this ' +
          'console, so this route is closed. Logged once per process. ' +
          'See docs/deploy.md §6.',
      )
    }
    return Response.json({ ok: false, error: 'not-configured' }, { status: 503 })
  }

  if (!secretMatches(req.headers.get(COMMAND_SECRET_HEADER), configured)) {
    // No detail, and no log line either. Unlike the command routes, a wrong
    // secret here cannot ban anybody or restart anything, and an endpoint an
    // operator points a checker at is one a misconfigured checker will hit
    // every thirty seconds forever — a refusal worth a page of journal on
    // `/api/kick` is just noise burying that journal here.
    return Response.json({ ok: false }, { status: 401 })
  }

  /**
   * ═══ THIS CALL IS THE WHOLE REASON THE ROUTE IS NOT THREE LINES ═══
   *
   * The SSH poll timer starts LAZILY, from `/api/host`, so that the box does
   * not hold a connection to the game host open for nobody. That is the right
   * default and it is also a trap for exactly this endpoint: with nobody
   * signed in, the timer has never run, `statusAt` is 0, and `dispatchNow`
   * answers `unknown` — honestly, because it genuinely has not been told
   * anything.
   *
   * AND `unknown` IS THE WORST POSSIBLE ANSWER FOR A CHECK TO GET, because it
   * arrives at precisely the moment the check matters most. Nobody has the
   * console open at four in the morning; that is when an external check is the
   * only thing looking, and a route that reports the channel as `unknown`
   * whenever nobody is watching reports it as `unknown` exactly when it may in
   * fact be broken. It would not be a weak signal, it would be an inverted one.
   *
   * `ensurePolling` IS IDEMPOTENT, so this adds nothing on a console somebody
   * is already using, and it does NOT make the request wait on SSH — the timer
   * collects in the background and every read below is a property access. The
   * first health check after a restart therefore still answers `unknown` for
   * one round, which is correct: it starts the timer and reports what is known
   * at that instant, which is nothing yet.
   *
   * ═══ WHAT IT COSTS ON A CONSOLE NOBODY IS USING, PLAINLY ═══
   *
   * Not nothing, and the honest number belongs here rather than in a reviewer's
   * head. Nothing ever calls `clearInterval`, so the first health check makes
   * the poller permanent for the life of the process: two ssh logins to the
   * game box every fifteen seconds, roughly eleven and a half thousand a day,
   * with nobody signed in. That is what `dispatch` meaning anything at 4am
   * costs, and it is the cost the issue asked for on purpose.
   *
   * `attended: false` IS WHAT HOLDS IT TO THAT. Without the flag, a box parked
   * off main — its normal state while a branch is being tested — would ALSO run
   * `git fetch --prune` against GitHub every two minutes all night, because
   * `poll`'s `branches` gate was written on the assumption that the only thing
   * able to start this timer was somebody looking at the banner it feeds. The
   * flag says a machine started it, which keeps that assumption true.
   *
   * IT IS A SIDE EFFECT ON A GET, AND THAT IS DELIBERATE. It changes no DURABLE
   * state anywhere and starts no work the next Host page load would not have
   * started, which is the sense in which this route stays a read — including
   * for `check:origin`'s coverage walk. It emphatically DOES change what
   * `dispatch` reports, and that is the entire reason the call is here: the next
   * maintainer who reads this paragraph as saying the call is inert, hoists it
   * out or puts an `export const revalidate` in front of it, puts the endpoint
   * back to answering `unknown` on every unattended console.
   */
  ensurePolling({ attended: false })

  const now = Date.now()
  const live = liveView(now)
  const host = hostView()

  const ok = verdictNow({
    dispatch: host.dispatch,
    ddb: host.ddb.reach,
    feed: feedNow(live.ageMs),
  })

  return Response.json(
    {
      /**
       * THE VERDICT, DERIVED — see `lib/healthVerdict` for what it consults
       * and, more importantly, for what it deliberately does NOT treat as a
       * fault: `unknown` on either channel, `unconfigured` SSH and a merely
       * `stale` feed are readings rather than alarms, and every one of them
       * would otherwise be a false page on an ordinary night.
       *
       * A CHECKER SHOULD STILL KEY ON THE THREE FIELDS BELOW, not on this
       * boolean alone. `ok: false` says something is wrong; only `dispatch`
       * says which of three machines to go and open, which is the reason that
       * field is a word rather than a flag.
       */
      ok,

      /**
       * NULL MEANS THE GAME HAS NEVER PUSHED TO THIS PROCESS, and a checker must
       * not read it as zero. `liveView` returns null for a console that has not
       * been pushed to since it booted; "the feed is perfectly fresh" and "there
       * has never been a feed" are opposite facts and a `0` would render the
       * second as the first. A collector that cannot express "no reading"
       * should publish no datum rather than a number.
       *
       * MILLISECONDS, AND THE NAME SAYS SO. It is the unit `liveView` keeps and
       * the unit the header chip is drawn from. A consumer that wants seconds
       * divides; one that renamed the field without dividing would be comparing
       * milliseconds against a threshold in seconds and alarming for ever.
       */
      ingestAgeMs: live.ageMs,

      /**
       * TAKEN OFF `hostView()` RATHER THAN CLASSIFIED AGAIN HERE. `dispatchNow`
       * needs three module-private facts from `lib/telemetry` — whether SSH is
       * configured, the last poll's error, and whether the timer has ever landed
       * a reading — and `hostView` is where they are put to it. Asking the same
       * question a second time in this file would need those three facts
       * exported, and would create a second place that could disagree with the
       * Host page about which of the states the channel is in. The comment on
       * `hostView` makes that argument for the chip, the strip and the popup;
       * an external check is a fourth reader of the same one answer.
       *
       * THAT RULE BINDS ANYTHING DOWNSTREAM TOO. A collector that opened its own
       * `ssh … true` from some other box to decide the same fact would be a
       * fifth classifier, with a different user, a different key and a different
       * `known_hosts`, free to report a working channel while this console
       * reports `key-unreadable`. This field is what such a collector reads.
       */
      dispatch: host.dispatch,

      /**
       * THE GAME'S OWN REACHABILITY PROBE, RESOLVED BY `reachNow` — `connected`,
       * `unreachable` or `unknown`, and never a boolean, because only something
       * inside FXServer can ask whether its reads actually work and every way of
       * not having been told is `unknown` rather than a fault.
       *
       * THE ISSUE ASKED WHETHER THIS BELONGS HERE AT ALL, on the grounds that it
       * is one more fact for a credentialed-but-machine surface to carry. It is
       * included, and the reason is that it is the one reading here that is NOT
       * about this console: `ingestAgeMs` and `dispatch` both go quiet together
       * when the link between the two boxes goes, and this is what separates "we
       * cannot hear the game" from "the game cannot reach its own store". Those
       * are different nights. Dropping it would leave a check able to say
       * something is wrong and never which half.
       *
       * THE `probe` OBJECT BESIDE IT IS DELIBERATELY NOT FORWARDED. It carries
       * the game's verbatim error text and the names of what it was talking to,
       * which is material for the fix popup an admin reads while signed in — not
       * for a payload whose whole job is to be polled by a machine.
       */
      ddb: host.ddb.reach,
    },
    { status: ok ? 200 : 503 },
  )
}
