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
  /** THE DEPLOY IS RUNNING. A stated fact, and the only unconditional one. */
  if (input.state === 'deploying') return 'deploying'

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
 * IS THE SERVER MID-UPDATE — and therefore, is its silence explained?
 *
 * The header's "Updating" chip, in one expression. Kept as its own function
 * rather than inlined at the call site because `scripts/check-deploy-phase.mjs`
 * asserts against it directly and because two of the five phases mean "in
 * flight" while three do not — a distinction worth naming once.
 *
 * NOTE WHAT IS NOT IN IT: `unconfirmed`. A deploy past its grace is not still
 * updating, and treating it as such is how a console ends up showing a calm
 * amber spinner over a server that is genuinely dead.
 */
export function updateInProgress(input: {
  state: MaintenanceState | null | undefined
  completedAt: number | null | undefined
  deployError?: string | null
  deployBootEpoch?: string | null
  deployConfirmedAt?: number | null
  bootEpoch?: string | null
  lastPushAt: number | null | undefined
  now: number
}): boolean {
  const phase = deployPhase(input)
  return phase === 'deploying' || phase === 'confirming'
}
