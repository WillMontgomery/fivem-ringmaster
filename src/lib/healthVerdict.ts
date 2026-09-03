import { dispatchFaults, type Dispatch } from './dispatchHealth'
import { faults, type Reach } from './ddbHealth'
import { feedFailed, type Feed } from './feedHealth'

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
 * FAULT ANY SIGNED-IN ADMIN WOULD SEE. Nothing new is judged here.
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
 * `ddb` and `ingestAgeMs`; it does not report the bundle hash, so it does not
 * get a vote. If the bundle ever belongs in this verdict it belongs in the
 * payload first, in that order.
 *
 * NO RUNTIME IMPORTS, like the three modules it composes — all three are pure
 * and client-safe, and keeping this one that way means `check-health-route.mjs`
 * can load the shipped function rather than re-implementing it.
 */
export function verdictNow(reading: {
  dispatch: Dispatch
  ddb: Reach
  feed: Feed
}): boolean {
  if (feedFailed(reading.feed)) return false
  if (dispatchFaults(reading.dispatch).length > 0) return false
  if (faults(reading.ddb, 'unknown').length > 0) return false
  return true
}
