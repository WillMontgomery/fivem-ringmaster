import { createHash, timingSafeEqual } from 'node:crypto'

import { env } from '@/lib/env'
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
 *   dispatch      the SSH channel, as one of five words (`dispatchNow`)
 *   ddb           the game's own reachability probe (`reachNow`)
 *
 * ═══ THE FIVE-STATE `dispatch` IS THE POINT, NOT A BOOLEAN ═══
 *
 * `lib/dispatchHealth` says at length why the channel resolves to five words
 * rather than to up/down: what an operator does next is entirely decided by
 * WHERE the call stopped, and the five places live on three different machines.
 * A checker that flattened this to "unhealthy" would throw away the only part
 * of the answer that says which box to go and look at.
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
 * ═══ THE UNSET SECRET IS 503, NOT 401 ═══
 *
 * `COMMAND_SECRET` is optional in `lib/env.ts` and unset is a supported state
 * that closes this door entirely. `serviceGate` distinguishes that case from a
 * wrong secret in the response as well as in the log, and the same argument
 * holds here with more force: the whole readership of this route is an operator
 * wiring up a check, and "nobody ever set the variable" versus "your secret is
 * stale" is otherwise a long evening. 503 because it is this console that is
 * not ready, not the caller that is wrong.
 */
export async function GET(req: Request): Promise<Response> {
  const configured = env().COMMAND_SECRET
  if (!configured) {
    console.error(
      '[health] REFUSED a health check: COMMAND_SECRET is not set on this ' +
        'console, so this route is closed. See docs/deploy.md.',
    )
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
   * `ensurePolling` IS IDEMPOTENT, so this costs nothing on a console somebody
   * is already using, and it does NOT make the request wait on SSH — the timer
   * collects in the background and every read below is a property access. The
   * first health check after a restart therefore still answers `unknown` for
   * one round, which is correct: it starts the timer and reports what is known
   * at that instant, which is nothing yet.
   *
   * IT IS A SIDE EFFECT ON A GET, AND THAT IS DELIBERATE. It changes no state
   * this endpoint reports on and nothing durable anywhere — it starts a timer
   * this process would have started on the next Host page load — so the route
   * stays a read for every purpose that word is used for here, including
   * `check:origin`'s coverage walk.
   */
  ensurePolling()

  const now = Date.now()
  const live = liveView(now)
  const host = hostView()

  return Response.json({
    ok: true,

    /**
     * NULL MEANS THE GAME HAS NEVER PUSHED TO THIS PROCESS, and a checker must
     * not read it as zero. `liveView` returns null for a console that has not
     * been pushed to since it booted; "the feed is perfectly fresh" and "there
     * has never been a feed" are opposite facts and a `0` would render the
     * second as the first.
     */
    ingestAgeMs: live.ageMs,

    /**
     * TAKEN OFF `hostView()` RATHER THAN CLASSIFIED AGAIN HERE. `dispatchNow`
     * needs three module-private facts from `lib/telemetry` — whether SSH is
     * configured, the last poll's error, and whether the timer has ever landed
     * a reading — and `hostView` is where they are put to it. Asking the same
     * question a second time in this file would need those three facts
     * exported, and would create a second place that could disagree with the
     * Host page about which of the five states the channel is in. The comment
     * on `hostView` makes that argument for the chip, the strip and the popup;
     * an external check is a fourth reader of the same one answer.
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
  })
}
