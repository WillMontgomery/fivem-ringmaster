import type { MaintenanceState } from './maintenance'

/**
 * WHERE A DEPLOY HAS ACTUALLY GOT TO — the one reading every surface uses.
 *
 * WHAT THIS FILE IS FOR. "The deploy finished" and "the game server is back"
 * are different facts, tens of seconds apart, and the console used to conflate
 * them: the driver marks the window `complete` when the `deploy` VERB returns,
 * and that verb returns once `royale-deploy` has kicked the restart off — not
 * once FXServer has booted the new code and started pushing again. In that gap
 * the Maintenance page jumped straight from "draining" to a green tick, and a
 * success toast landed over a server that was still down. The owner: "don't
 * show that the update is complete until we receive the first heartbeat from
 * br_ringmaster. That tells us that the server process has executed properly
 * and successfully."
 *
 * SO COMPLETION IS GATED ON THE GAME SPEAKING, and specifically on the game
 * speaking AS A NEW PROCESS. See `heartbeatIsFresh` for why the timestamp
 * comparison this used to make is not enough on its own.
 *
 * ONE FUNCTION, THREE READERS, WHICH IS THE POINT. The header chip, the
 * Maintenance page's loading state and the completion toast are the same fact
 * seen three times, and the way that fact goes wrong is subtle enough that it
 * must not be spelled out in three places. `deployPhase` is called by all of
 * them, and by the driver that records the verdict durably.
 *
 * NOT KNOWING SHOWS LESS, NEVER MORE — the same polarity this file has always
 * had. Every claim below rests on a POSITIVE reading of the maintenance window:
 * an unread row, a null state, a payload that predates a field, all fall
 * through to `idle`, which asserts nothing. A console that has not looked must
 * not announce a deploy, must not claim one succeeded, and must not claim one
 * failed.
 */

/**
 * How long a restart is allowed to explain the silence.
 *
 * WITHOUT A BOUND THIS STATE IS A TRAP. "Waiting for the server" never ends if
 * the server never comes back — a deploy that broke it, or a console whose game
 * box has no ingest configured at all — and the Maintenance page would sit on a
 * spinner forever over a box that is genuinely dead. A loading state with no
 * exit is not a loading state, it is a hang.
 *
 * FIVE MINUTES IS DELIBERATELY GENEROUS AGAINST THE REAL NUMBER. `royale-deploy`
 * syncs resources and restarts FXServer, which is tens of seconds; the game
 * pushes every two. Anything past five minutes is not a slow restart, it is a
 * problem — and at that point the honest thing is to stop offering an excuse and
 * say the update did not confirm. It is ONE number rather than two because the
 * moment the excuse expires and the moment the failure is declared are the same
 * moment; giving them separate constants would let them drift into a gap where
 * the console says neither.
 */
export const RESTART_GRACE_MS = 5 * 60_000

/**
 * Where a deploy is, as far as this console can honestly tell.
 *
 *   idle         Nothing to say. No window, or one whose deploy is settled.
 *   deploying    The deploy verb is running. The server is going down.
 *   confirming   The verb returned; waiting for br_ringmaster's first heartbeat.
 *   failed       The deploy verb itself returned an error. The code did not ship.
 *   unconfirmed  The grace expired with no heartbeat from a new process.
 *
 * `failed` AND `unconfirmed` ARE BOTH TERMINAL AND THEY ARE NOT THE SAME
 * FAILURE. `failed` is the game host refusing or erroring — an SSH channel that
 * is not configured, a pin the box would not take, a deploy script that exited
 * non-zero — and the server is still running the OLD code, untouched. That is
 * the safer of the two. `unconfirmed` is the deploy reporting success and the
 * server then never coming back, which is the one that needs somebody on the
 * box: the restart was fired and something after it did not survive.
 */
export type DeployPhase =
  | 'idle'
  | 'deploying'
  | 'confirming'
  | 'failed'
  | 'unconfirmed'

export interface DeployPhaseInput {
  /** The stored window's state, or null when no window has been read. */
  state: MaintenanceState | null | undefined
  /**
   * When the deploy step STARTED, epoch ms — written by `markDeploying` in the
   * same conditional write that moves the row into `deploying`.
   *
   * IT IS THE CLOCK ON THE `deploying` PHASE, AND UNTIL IT WAS PASSED IN THAT
   * PHASE HAD NONE. `confirming` has been bounded by `RESTART_GRACE_MS` since
   * it was written; `deploying` was returned unconditionally — and the bound
   * `confirming` runs against, `completedAt`, is written only by
   * `markComplete`, which is the one call in the driver's tick that a failure
   * anywhere above it stops the run from reaching. A row that never left
   * `deploying` was therefore excused for ever by `silenceIsExplained`,
   * `/api/health` answered 200 over a feed that had been dead for hours, and
   * `isDraining` turned away every player for the whole of it.
   *
   * ABSENT MEANS NOT KNOWN AND STILL READS AS `deploying`, which is this
   * file's standing polarity rather than an oversight. Every row
   * `markDeploying` writes carries it; what does not is a `/api/state` payload
   * from before this field rode it — a browser tab left open across a console
   * deploy — and flipping that tab to `unconfirmed` would be the console
   * announcing a failure on the strength of never having been told. The two
   * surfaces where the bound is load-bearing, `/api/health` and `AppShell`,
   * read the DynamoDB row itself and always have it.
   */
  deployStartedAt?: number | null
  /** When the deploy step finished, epoch ms. Null while it has not. */
  completedAt: number | null | undefined
  /** What the deploy verb returned, when it returned a refusal. */
  deployError?: string | null
  /**
   * The game's boot epoch as the console last knew it when the deploy fired.
   *
   * Absent on a row written before this field existed, and null when the
   * console had never received a push at all — both fall back to the timestamp
   * comparison in `heartbeatIsFresh`.
   */
  deployBootEpoch?: string | null
  /** When the driver recorded the first heartbeat from a new process. */
  deployConfirmedAt?: number | null
  /** The boot epoch of the process the console is hearing from RIGHT NOW. */
  bootEpoch?: string | null
  /** When the console last received a push from the game, epoch ms, or null. */
  lastPushAt: number | null | undefined
  now: number
}

/**
 * HAS THE GAME SPOKEN SINCE THE RESTART — as a DIFFERENT PROCESS?
 *
 * THE TIMESTAMP COMPARISON ALONE IS NOT PROOF, and that is the bug this
 * function exists to close. `lastPushAt > completedAt` was the whole test, and
 * it can be satisfied by the OLD server: the deploy verb returns once
 * `royale-deploy` has kicked the restart off, and FXServer takes a moment to
 * actually stop, so a push that was already in flight — or one the dying
 * process managed on its two-second cadence — lands a few hundred milliseconds
 * after `completedAt` and looks exactly like proof of life. It is proof of the
 * thing we just killed still being alive.
 *
 * `bootEpoch` IS THE FIELD THAT TELLS THEM APART, and the game already sends
 * it. `docs/ingest-envelope.md` in the game repo: it is unique per RESOURCE
 * START, and the game host restarts resources on every deploy — which is why
 * `lib/state` already dedupes events on `(bootEpoch, seq)` rather than on `seq`
 * alone. A heartbeat whose epoch differs from the one we were hearing before
 * the deploy cannot have come from the process we restarted. Nothing new is
 * asked of the game: this reads a field that has been on the wire since the
 * pipeline was built, and the game is not told to behave differently for the
 * console's benefit.
 *
 * THE FALLBACK IS THE OLD TEST, AND IT IS THE WEAKER ONE ON PURPOSE. When the
 * console had no push at all before the deploy — an ingest that has never been
 * configured, a console restarted mid-window, a row written before this field
 * existed — there is no epoch to compare against, and the only evidence
 * available is a push landing after the deploy finished. Weaker evidence is
 * still better than none, and the alternative is a console that can never
 * confirm anything on a box it has not been listening to.
 */
export function heartbeatIsFresh(input: {
  completedAt: number | null | undefined
  deployBootEpoch?: string | null
  deployConfirmedAt?: number | null
  bootEpoch?: string | null
  lastPushAt: number | null | undefined
}): boolean {
  /**
   * ALREADY RECORDED. The driver writes this the first time it observes the new
   * process, and once written it is the answer forever — which is what stops a
   * console that boots days later, on a game box that happens to be down for
   * an unrelated reason, from blaming a deploy that demonstrably landed.
   */
  if (typeof input.deployConfirmedAt === 'number') return true

  if (typeof input.completedAt !== 'number') return false

  if (typeof input.deployBootEpoch === 'string' && input.deployBootEpoch !== '') {
    // A push from the SAME process proves nothing, whenever it arrived.
    return (
      typeof input.bootEpoch === 'string' &&
      input.bootEpoch !== '' &&
      input.bootEpoch !== input.deployBootEpoch
    )
  }

  /**
   * No epoch to compare. Note `>` and not `>=`: both are console-side
   * `Date.now()` readings, so a tie is a push that raced the completion write
   * within the same millisecond and says nothing about which process sent it.
   */
  return (
    typeof input.lastPushAt === 'number' &&
    typeof input.completedAt === 'number' &&
    input.lastPushAt > input.completedAt
  )
}

export function deployPhase(input: DeployPhaseInput): DeployPhase {
  /**
   * THE DEPLOY IS RUNNING — FOR AS LONG AS A RUNNING DEPLOY PLAUSIBLY TAKES.
   *
   * THIS RETURN USED TO BE UNCONDITIONAL, AND IT WAS THE ONE PHASE IN THE FILE
   * WITH NO CLOCK ON IT. `RESTART_GRACE_MS` above makes the argument in its own
   * words — "a loading state with no exit is not a loading state, it is a hang"
   * — and it was applied to the wrong half: to `confirming`, which the driver
   * reaches only after `markComplete` has written `completedAt`, and not to
   * `deploying`, which is where the row sits WHILE the driver is doing the work
   * that can fail. A tick that threw between `markDeploying` and `markComplete`
   * — an audit-table throttle, an OOM, the console restarted mid-deploy, or
   * `markComplete`'s own write refused — left the row in `deploying` with
   * nothing anywhere able to move it: the tick's own recovery arm returns early
   * on any state that is not `draining`, and `expiresAt` is written on
   * host-patch rows only.
   *
   * WHAT THAT COST IS THE WHOLE POINT OF THE PHASE. `silenceIsExplained` says
   * yes to `deploying`, so `/api/health` skipped the feed axis and answered
   * `200 {"ok":true}` over an `ingestAgeMs` of hours; the collector reads that
   * phase off the payload and withholds `IngestFeedDead` for it, so the estate
   * went quiet on both sides of the same contract. And `isDraining` returns
   * true for `deploying`, so the game refused every player for the whole time.
   * One number ends all of it.
   *
   * IT IS THE SAME NUMBER AND THE SAME SENTENCE AS THE `confirming` BOUND
   * BELOW, deliberately: the moment the excuse expires and the moment the
   * failure is declared are the same moment. `unconfirmed` is already the
   * terminal phase for "the restart fired and nothing came back", is already
   * not in `silenceIsExplained`, and is already published by everything
   * downstream — so the fix adds a comparison rather than a state.
   */
  if (input.state === 'deploying') {
    return typeof input.deployStartedAt === 'number' &&
      input.now - input.deployStartedAt >= RESTART_GRACE_MS
      ? 'unconfirmed'
      : 'deploying'
  }

  /**
   * ANYTHING ELSE THAT IS NOT A FINISHED DEPLOY SAYS NOTHING. `scheduled` and
   * `draining` are states where the server is UP and no deploy has been fired;
   * `cancelled` is one that never will be; null is the unread row, which must
   * never produce a claim in either direction.
   */
  if (input.state !== 'complete') return 'idle'
  if (typeof input.completedAt !== 'number') return 'idle'

  /**
   * THE HOST REFUSED, AND THAT OUTRANKS EVERYTHING BELOW. A stated error from
   * the command channel is the most specific thing anybody knows about this
   * deploy, and it means the code did not ship — so no amount of heartbeat
   * traffic from a server that never restarted may turn it into a success.
   *
   * It is also why the driver does not record a confirmation over an error: the
   * game pushing happily is the expected state after a refused deploy.
   */
  if (typeof input.deployError === 'string' && input.deployError !== '') {
    return 'failed'
  }

  /** IT IS BACK, and a new process said so. */
  if (heartbeatIsFresh(input)) return 'idle'

  /**
   * Still silent. That is a restart in progress for exactly as long as a
   * restart plausibly accounts for it, and a stated failure afterwards — never
   * a spinner that outlives the thing it is waiting for.
   */
  return input.now - input.completedAt < RESTART_GRACE_MS
    ? 'confirming'
    : 'unconfirmed'
}

/**
 * DOES A DEPLOY ACCOUNT FOR THE SERVER BEING QUIET RIGHT NOW?
 *
 * ═══ THE SENTENCE THREE SURFACES HAVE TO SAY THE SAME WAY ═══
 *
 * `royale-deploy` restarts FXServer, so the game stops pushing — for tens of
 * seconds, and `RESTART_GRACE_MS` above allows five minutes of it. That silence
 * is not a fault; it is the intended consequence of an act this console ordered.
 * THREE THINGS NOW HAVE TO KNOW THAT, and they must not each decide it:
 *
 *   `chipCluster` rung 1   the header shows one chip, `Updating`, and hides the
 *                          feed chip — "three chips raising three alarms about
 *                          one intended act" is the failure it was built for
 *   `updateInProgress`     the same two phases, read off a raw window
 *   `lib/healthVerdict`    `GET /api/health` must not answer 503 through a
 *                          deploy this console scheduled and is executing
 *
 * THE THIRD READER IS WHY THIS IS A FUNCTION RATHER THAN AN INLINE COMPARISON.
 * The endpoint and the page were free to disagree about the same fact, and they
 * did: the header showed a calm `Updating` chip while `/api/health` answered
 * `503 {"ok":false,"ingestAgeMs":47000}` to whatever monitor an operator had
 * wired to it, for the whole of every planned deploy. A checker that pages on
 * every intended restart is a checker somebody silences — which is how they
 * come to miss the one that matters, the same argument `lib/feedHealth` makes
 * about not paging on `stale`.
 *
 * NOTE WHAT IS NOT IN IT: `unconfirmed`. A deploy past its grace is not still
 * updating, and treating it as such is how a console ends up showing a calm
 * amber spinner — or answering 200 — over a server that is genuinely dead.
 * `failed` is out for the opposite reason: the deploy verb refused, so the
 * restart never fired and nothing about the feed was ever expected to change.
 *
 * IT TAKES A PHASE AND NOT A WINDOW, because two of its three readers already
 * hold a resolved phase and only one holds the inputs. `updateInProgress` below
 * is that one, and it is now this function with `deployPhase` in front of it.
 */
export function silenceIsExplained(phase: DeployPhase): boolean {
  return phase === 'deploying' || phase === 'confirming'
}

/**
 * IS THE SERVER MID-UPDATE — and therefore, is its silence explained?
 *
 * The header's "Updating" chip, in one expression. Kept as its own function
 * rather than inlined at the call site because `scripts/check-deploy-phase.mjs`
 * asserts against it directly and because two of the five phases mean "in
 * flight" while three do not — a distinction worth naming once.
 *
 * IT IS `silenceIsExplained` WITH `deployPhase` IN FRONT OF IT, and it keeps its
 * own name because its callers hold a window rather than a phase.
 */
export function updateInProgress(input: {
  state: MaintenanceState | null | undefined
  deployStartedAt?: number | null
  completedAt: number | null | undefined
  deployError?: string | null
  deployBootEpoch?: string | null
  deployConfirmedAt?: number | null
  bootEpoch?: string | null
  lastPushAt: number | null | undefined
  now: number
}): boolean {
  return silenceIsExplained(deployPhase(input))
}

/**
 * WHICH CHIPS THE HEADER SHOWS — the whole cluster, decided in one place.
 *
 * WHY IT IS HERE AND NOT IN THE COMPONENT. `ServerChips` expressed this as a
 * chain of early returns in its own JSX, which is one representation and was
 * therefore fine as far as it went — but nothing could assert it. The rule that
 * matters most about this cluster is which chips may NOT appear together, and a
 * rule with no gate behind it is the rule this repo keeps re-breaking. As a pure
 * function over `(phase, badge)` it is the same single expression AND it is a
 * case table in `scripts/check-chip-suppression.mjs`. The component paints the
 * answer; it does not re-decide any part of it.
 *
 * ═══ THE LADDER, MOST SPECIFIC FIRST ═══
 *
 * 1. A DEPLOY IS RUNNING — one chip, alone. The server is deliberately down, and
 *    this is the case the whole suppression rule was built for: three chips
 *    raising three alarms about one intended act. See `updateInProgress`, which
 *    is the same two phases and is what used to hide the feed chips.
 *
 * 2. A DEPLOY ENDED BADLY — one chip, alone. `Update failed` and `Server not
 *    back` exist BECAUSE the feed chips were removed; they are the feed-lost
 *    report with the cause attached. Now that `Feed lost` is back, showing both
 *    would be the raw reading beside the attributed one, and the attributed one
 *    is strictly more useful.
 *
 * 3. THE WINDOW SAYS SOMETHING IS HAPPENING RIGHT NOW — `draining` or
 *    `updating` — and there is no `UpdateBadge`. THIS IS THE OWNER'S RULE:
 *    "'update available' should be superseded by 'draining' chips - they should
 *    never be displayed together". Draining means the server is refusing players
 *    RIGHT NOW; an available update is background information that will still be
 *    true in an hour. The urgent, specific, happening-now state supersedes the
 *    ambient one, and an update that is RUNNING is the same sentence with a
 *    stronger subject. `scheduled` stays out of this rung on the owner's ruling.
 *    The FEED chip stays, because "is my data current" is a different question
 *    and a drain is exactly when it is worth answering — the same call
 *    `check-chip-suppression.mjs` has always made for this state ("draining and
 *    the feed has died — must NOT be hidden").
 *
 * 4. ORDINARY. Feed, deploy state, and a scheduled window if there is one.
 *
 * ═══ AND ALL OF IT OFF ONE READING ═══
 *
 * `phase` AND `badge` ARE TWO VIEWS OF ONE WINDOW, and the rungs above are only
 * as honest as the pair they are handed. Mixed across snapshots they contradict
 * each other, and the contradiction lands on rung 4 — which is exactly where the
 * owner's complaint reappeared after `draining` was fixed. So this function
 * takes two whole readings and chooses ONE, rather than taking two loose fields
 * that a caller may have assembled from anywhere.
 *
 * FEED STATUS IS ORTHOGONAL TO DEPLOY STATE, WITH ONE EXCEPTION, and the
 * exception is the point of rungs 1 and 2: a feed that is dead BECAUSE OF a
 * deploy is already being reported by the deploy chip, in words that say why.
 * Everywhere else the two answer different questions and both appear.
 */
export interface ChipCluster {
  /** The feed-freshness chip — Live, Falling behind, Feed lost, No data. */
  feed: boolean
  /** The deploy-state chip — Update available, Up to date. */
  update: boolean
  /**
   * The exclusive phase chip: the Updating spinner, or a terminal failure.
   * Never set at the same time as `window`.
   */
  phase: 'updating' | 'failed' | 'unconfirmed' | null
  /** The maintenance-window badge, which is a different chip from `phase`. */
  window: 'scheduled' | 'draining' | 'updating' | null
}

/**
 * ONE READING OF THE SERVER — the phase and the window badge, together.
 *
 * THEY ARE A PAIR AND MUST TRAVEL AS ONE. Both are derived from a single
 * maintenance window; split across two snapshots they can describe two
 * different instants, and the cluster then paints a contradiction. That is not
 * hypothetical — it is how "update available" got back beside "updating" after
 * the draining rung closed the first door. See `chipCluster`.
 */
export interface ClusterReading {
  phase: DeployPhase
  badge: 'scheduled' | 'draining' | 'updating' | null
}

export function chipCluster(
  /**
   * What the last poll said, or null before the first one lands.
   *
   * WHEN THIS IS PRESENT IT IS THE WHOLE ANSWER. The seed below is not
   * consulted for so much as one field — see the no-mixing property in
   * `check-chip-suppression.mjs`, which sweeps every pair of readings and
   * asserts the seed cannot influence the result once a poll exists.
   */
  polled: ClusterReading | null,
  /**
   * The SERVER render's reading, which covers the two seconds before the first
   * poll answers and nothing after it.
   *
   * IT IS DELIBERATE AND IT IS LOAD-BEARING. Without it a maintenance window in
   * progress is invisible for two seconds after every page load, and
   * `confirming` — a phase no badge can express — flickers through a clean
   * header on every navigation during a deploy. It is NOT a fallback for fields
   * a poll happened not to carry: a poll that cannot describe the window is
   * still a poll, and "not known" must show less rather than leave a stale
   * claim standing.
   */
  seed: ClusterReading,
): ChipCluster {
  /**
   * BOTH FIELDS FROM ONE SNAPSHOT, OR NEITHER. The single line this function
   * exists to make unmissable, and the one a gate can hold.
   */
  const { phase, badge } = polled ?? seed

  /**
   * 1. The deploy is running, or we are waiting for the server to come back.
   *
   * THROUGH `silenceIsExplained`, WHICH IS ALSO WHAT `/api/health` ASKS. This
   * rung and the endpoint's verdict are the same judgement about the same
   * silence, and spelling the two phases out in both places is how the header
   * came to show `Updating` while the endpoint answered 503 about the feed this
   * rung was deliberately not mentioning.
   */
  if (silenceIsExplained(phase)) {
    return { feed: false, update: false, phase: 'updating', window: null }
  }

  /** 2. It ended badly, and that chip is the one thing worth saying. */
  if (phase === 'failed' || phase === 'unconfirmed') {
    return { feed: false, update: false, phase, window: null }
  }

  /**
   * 3. THE WINDOW SAYS SOMETHING IS HAPPENING RIGHT NOW. No `UpdateBadge`.
   *
   * THE OWNER'S RULE, AND ITS SECOND HALF. `draining` was the case they
   * reported: "'update available' should be superseded by 'draining' chips -
   * they should never be displayed together". `updating` is the same sentence
   * with a stronger subject — an update that is RUNNING supersedes one that is
   * merely available — and it reaches this rung only when the badge and the
   * phase came from readings that disagree, which the console can still do.
   *
   * `scheduled` IS NOT HERE, ON THE OWNER'S RULING ("first one is fine to
   * leave"). It describes something LATER, not something now, and it does not
   * imply an update exists: a window can be scheduled with `updateAvailable: 0`
   * for a restart or a config change. Suppressing on it would also hide `Up to
   * date` — the resting state — for the hours a window can be scheduled.
   *
   * WHY THIS RUNG IS NOT DEAD CODE, now that one reading can no longer produce
   * the pair: the SEED is still assembled from two reads. `AppShell` takes the
   * badge from whatever the page passed — and `app/maintenance/page.tsx` passes
   * `badgeState(await current(), now)`, a fresh DynamoDB read — while
   * `initialPhase` comes from the driver's cached window. Two reads, on the one
   * route where deploys are fired. Unifying them would mean changing the
   * `badges` API and desyncing the header from the sidebar, so the mixing stays
   * and the cluster refuses to paint its contradiction instead.
   */
  if (badge === 'draining' || badge === 'updating') {
    return { feed: true, update: false, phase: null, window: badge }
  }

  /** 4. Nothing is happening to the server that changes what else may be said. */
  return { feed: true, update: true, phase: null, window: badge }
}
