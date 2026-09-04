import { dispatchFaults, type Dispatch } from './dispatchHealth'
import { faults, type Reach } from './ddbHealth'
import { feedFailed, type Feed } from './feedHealth'
import { silenceIsExplained, type DeployPhase } from './serverPhase'

/**
 * IS THIS CONSOLE WELL — the one boolean `GET /api/health` answers with, and
 * the one thing a machine reads when it reads nothing else.
 *
 * ═══ THIS EXISTS BECAUSE THE FIRST VERSION OF THE ROUTE ANSWERED `ok: true` ═══
 *
 * It was a literal, on a route called `health`, sitting above three readings
 * that could all say the console was broken. The failure that produces is not
 * subtle and it is silent: an uptime checker's default assertion is `HTTP 2xx`
 * or `.ok == true`, both of which passed while `dispatch` read
 * `key-unreadable` and the game had not pushed for an hour. Worse for a HEAD
 * probe — Next answers HEAD out of the GET handler with no body at all, so the
 * status code is the ONLY thing such a checker can see, and the status code
 * was 200 whatever the readings said.
 *
 * That is the same outage `lib/dispatchHealth` was written for, wearing a
 * green light. `GET /api/ingest` already answers a hardcoded `{ ok: true }`
 * and is honest about it, because its whole claim is "something is listening".
 * A route that reads three health facts and then ignores them is making a
 * claim it has the evidence to contradict.
 *
 * ═══ IT DECIDES NOTHING ITSELF. IT ASKS THE THREE EXISTING CLASSIFIERS ═══
 *
 * There is no list of bad words in this file, and there must never be one.
 * `dispatchFaults` already knows which of the seven `Dispatch` states raise an
 * alarm — it is what draws the red strip on the Host page — and `faults`
 * already knows the same for `Reach`. Writing `dispatch === 'key-unreadable'
 * || …` here would create a second place that decides what "broken" means, and
 * the two would drift the first time a state was added: the Host page would go
 * red and the endpoint would stay green, which is worse than either alone
 * because it makes the endpoint look like a second opinion.
 *
 * So the rule is exactly: THE VERDICT IS FALSE WHEN THIS CONSOLE IS RAISING A
 * FAULT ANY SIGNED-IN ADMIN WOULD SEE. Nothing new is judged here — the deploy
 * phase below included, which is `lib/serverPhase`'s judgement and is asked of
 * it rather than re-derived.
 *
 * ═══ A DEPLOY THIS CONSOLE ORDERED EXPLAINS THE SILENCE THAT FOLLOWS ═══
 *
 * THIS IS THE ONE THAT SHIPPED WRONG, and it broke the rule above in the most
 * visible way there is. `royale-deploy` restarts FXServer, so the game stops
 * pushing; `lib/maintenanceDriver` says outright that this "is exactly the
 * window in which the feed goes quiet", and `RESTART_GRACE_MS` allows five
 * minutes of it. Thirty seconds in, `feedNow` said `dead`, `feedFailed` said
 * yes, and this function answered false — so `/api/health` returned
 * `503 {"ok":false,"ingestAgeMs":47000,"dispatch":"ok","ddb":"connected"}` for
 * the rest of the restart, on a window the console itself had scheduled and was
 * executing.
 *
 * AT THAT SAME INSTANT AN ADMIN WITH THE HEADER OPEN SAW ONE CHIP: `Updating`.
 * `chipCluster` rung 1 suppresses the feed chip during a deploy precisely so
 * that "three chips raising three alarms about one intended act" cannot happen,
 * which means the endpoint and the page were reporting opposite things about
 * the same silence — the disagreement `lib/feedHealth` was extracted to make
 * impossible, reappearing one layer up. And every planned deploy paged whoever
 * had wired a monitor to the endpoint `docs/deploy.md` tells them to wire one
 * to, which is how an operator learns to silence the check that matters.
 *
 * SO THE FEED AXIS — AND ONLY THE FEED AXIS — IS SUPPRESSED while
 * `silenceIsExplained` holds. `dispatch` and `ddb` still page during a deploy:
 * an SSH channel that has stopped loading its key is a fault whenever it
 * happens, and a deploy is not an excuse for it. `unconfirmed` is deliberately
 * NOT suppressed either — a deploy past its grace is a server that did not come
 * back, and that is the night somebody has to be woken for.
 *
 * `idle` IS THE ANSWER WHEN NOTHING IS KNOWN, and it suppresses nothing. A
 * console whose driver has never ticked, or one restarted mid-window, reports a
 * dead feed as a fault — which is the right direction for this endpoint
 * specifically: not knowing why the game is quiet is a reason to page, not a
 * reason to stay green.
 *
 * ═══ WHY THE FEED IS JUDGED HERE AT ALL, WHICH IS A FAIR QUESTION ═══
 *
 * IT HAS BEEN PROPOSED, TWICE, THAT THIS FUNCTION SHOULD STOP LOOKING AT THE
 * FEED — on the reasoning that the age is already a field in the same body, so
 * whatever consumes the payload can judge it, and dropping it here would remove
 * the one axis a deploy ever falsely fired on. The first half is true. The
 * conclusion is wrong, and the reason is `offline`.
 *
 * A CONSOLE THE GAME HAS NEVER PUSHED TO REPORTS `ingestAgeMs: null`, `ddb:
 * unknown`, and a `dispatch` that is frequently fine. Every one of those is a
 * non-reading: there is no age to compare, `unknown` is not a fault on either
 * channel, and a working SSH channel is a fact about this box rather than about
 * the game. A consumer doing its own judging therefore has NOTHING to judge —
 * three correct non-readings and no fourth field — and `ok` is the only value in
 * the payload that is false. That is not a corner: it is a console restarted
 * while the game box is down, which is to say a console in the middle of the
 * incident this endpoint exists for.
 *
 * SO THE FEED STAYS, AND WITH IT THE FILE'S STATED RULE RATHER THAN AGAINST IT.
 * `Feed lost` and `No data` are chips a signed-in admin sees on rung 4 of
 * `chipCluster`; a verdict that ignored them would be green while the header
 * beside it was not, which is the disagreement this whole module exists to make
 * impossible. The deploy case is not an argument for removing the axis, it is
 * the argument for the suppression above — the header suppresses exactly the
 * same chip, through exactly the same function, at exactly the same moment.
 *
 * ═══ WHAT IS DELIBERATELY NOT A FAULT, AND WHY EACH ONE IS NOT ═══
 *
 * `unknown`, on either channel, is not a failure and both modules say so at
 * length: it is what a console that has not been told anything answers, and
 * `dispatchHealth` records the consequence of getting this wrong — "a false
 * alarm on every cold start, which is how an operator learns to ignore the
 * true one".
 *
 * `unconfigured` is not a failure either, and this is the call
 * `check-dispatch-health.mjs` already pins: `GAME_HOST` unset is the normal
 * state of a development box, and `dispatchFaults('unconfigured')` returns an
 * empty list on purpose. A console deployed without the SSH channel would
 * otherwise answer 503 forever, which is a checker somebody turns off.
 *
 * `stale` feed is not a failure — see `feedFailed`. `offline` IS one, and the
 * asymmetry with `unconfigured` is worth stating because it looks like an
 * inconsistency: there is an environment variable that means "this console was
 * never pointed at a game box over SSH", and there is no environment variable
 * that means "this console is deliberately never pushed to". A console with no
 * feed at all cannot answer any question anybody opens it to ask, so it is not
 * well, and on a freshly restarted box it says so for the two seconds until
 * the game's next push.
 *
 * ═══ BUNDLE IS NOT AN INPUT, ON PURPOSE ═══
 *
 * `faults(reach, bundle)` also raises `bundle-mismatch`, and this function
 * passes `'unknown'` for that argument rather than the real reading. The rule
 * it is keeping is that EVERY REASON THE VERDICT IS FALSE MUST BE A FIELD IN
 * THE BODY THE CHECKER JUST RECEIVED — otherwise the alert says "unhealthy"
 * and the payload beside it says nothing is wrong, and the operator's next
 * hour is spent doubting the endpoint. `/api/health` reports `dispatch`,
 * `ddb`, `ingestAgeMs` and `deploy`; it does not report the bundle hash, so it
 * does not get a vote. If the bundle ever belongs in this verdict it belongs in
 * the payload first, in that order.
 *
 * THE DEPLOY PHASE EARNED ITS FIELD UNDER THAT SAME RULE, read in the direction
 * it is usually read backwards from: it moves the verdict, so `deploy` is in the
 * body. Without it an operator reads a 200 beside a 47-second `ingestAgeMs`,
 * which looks like the endpoint contradicting itself, with no field anywhere
 * saying why it is not.
 *
 * ═══ NO IMPORT THAT REACHES A SERVER MODULE ═══
 *
 * The four value imports below are pure and client-safe: `dispatchHealth`,
 * `ddbHealth` and `feedHealth` have no runtime imports at all, and
 * `serverPhase` has only a `type` from `lib/maintenance`, erased at compile —
 * which is why three `'use client'` components already import it. THAT is the
 * property, and it is not the sentence this comment used to carry. "No runtime
 * imports" was false the day it was written: there are four of them six lines
 * above, and a maintainer who reads a stated invariant as already broken treats
 * it as dead prose and steps over it.
 *
 * IT IS LOAD-BEARING TWICE. `scripts/check-health-route.mjs` loads the SHIPPED
 * function under tsx rather than re-implementing it, which works only while
 * nothing here pulls in `node:child_process` by way of `lib/ssh`; and the
 * `feedFailed` chain reaches `components/FeedStatus`, which is a client
 * component. The obvious way to break both at once is to reach for `hostView()`
 * to get the deploy phase — which is exactly why the phase arrives as an
 * ARGUMENT, resolved by the route that already holds a server context.
 */
export function verdictNow(reading: {
  dispatch: Dispatch
  ddb: Reach
  feed: Feed
  /**
   * Where the last deploy has got to, from `lib/serverPhase`.
   *
   * OPTIONAL, AND ITS ABSENCE IS `idle`, WHICH EXCUSES NOTHING. A caller that
   * has not looked at the maintenance window must not thereby claim there is no
   * deploy running — but it must not be handed a quieter verdict for not asking
   * either. Absent behaves exactly as a console with no window does.
   */
  deploy?: DeployPhase
}): boolean {
  /**
   * THE FEED AXIS IS THE ONLY ONE A DEPLOY EXCUSES, and the excuse sits here,
   * above the three faults, rather than inside one of them. The restart is why
   * the game is quiet, this console ordered it, and the header chip is already
   * saying so in words to anybody signed in.
   */
  if (!silenceIsExplained(reading.deploy ?? 'idle') && feedFailed(reading.feed)) {
    return false
  }
  if (dispatchFaults(reading.dispatch).length > 0) return false
  if (faults(reading.ddb, 'unknown').length > 0) return false
  return true
}
