import type { MaintenanceState } from './maintenance'

/**
 * IS THE GAME SERVER MID-UPDATE — and therefore, is its silence explained?
 *
 * WHAT THIS IS FOR. The header carries chips that answer "is the live data
 * healthy": Live, Falling behind, Feed lost. During a deploy every one of them
 * is technically correct and completely useless — the feed IS lost, because the
 * server was deliberately restarted, and three chips arguing about a box that is
 * down on purpose is noise dressed as information. The owner: "let's not show
 * the live/falling behind/etc chips while the server is updating — only show the
 * Updating chip."
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT, and it is the same one
 * `refUpdateFrom` draws by returning `null` and never `0`:
 *
 *   SUPPRESSING A CHIP BECAUSE WE KNOW WHY THE FEED IS QUIET is honest. A
 *   `deploying` window is a stated fact, written by the driver that fired the
 *   deploy, and "Updating" is a better answer than "Feed lost" because it is
 *   the same observation with its cause attached.
 *
 *   SUPPRESSING A CHIP BECAUSE WE HAVE NOT LOOKED WOULD BE THE BUG. A console
 *   that has not yet read the maintenance row knows nothing about a deploy, and
 *   must therefore show the ordinary health chips — which will say "No data" or
 *   "Feed lost", and those are TRUE: we have no data. Every early return below
 *   is on a POSITIVE reading of the window. Absence of a window, a null state,
 *   an unread row — all fall through to `false`, which means "show the ordinary
 *   chips", never "hide everything".
 *
 * So the failure direction is: not knowing shows MORE, never less. The only
 * thing that hides a health chip is a window that says, in so many words, that
 * a deploy is happening.
 *
 * ---
 *
 * THE SECOND HALF: "DEPLOYED" IS NOT "BACK". The driver marks the window
 * `complete` when the `deploy` verb returns, and that verb returns once
 * `royale-deploy` has kicked the restart off — not once FXServer is accepting
 * players and pushing state again. Those are tens of seconds apart, and in that
 * gap the old behaviour was a green success toast and a red "Feed lost" chip,
 * simultaneously, both about the same server. The owner: "don't notify that an
 * update is complete until it's polling again. Once that's true the 'live' chip
 * should come back."
 *
 * SO THE PROOF OF LIFE IS A PUSH, NOT A ROW. `lastPushAt > completedAt` is the
 * game server itself talking after the restart finished — the only evidence
 * that cannot be produced by anything except the thing we are asking about. One
 * fact, one transition; the chip flips and the toast fires off the same
 * comparison, which is what stops the two surfaces disagreeing.
 */

/**
 * How long a restart is allowed to explain the silence.
 *
 * WITHOUT A BOUND THIS STATE IS A TRAP. "Updating until the feed comes back"
 * never ends if the feed never comes back — a deploy that broke the server, or
 * a console whose game box has no ingest configured at all — and the console
 * would sit showing a calm amber "Updating" over a server that is genuinely
 * dead, having suppressed the very chip that would have said so. That is the
 * failure this whole file is supposed to prevent, arrived at from the other
 * side.
 *
 * FIVE MINUTES IS DELIBERATELY GENEROUS AGAINST THE REAL NUMBER. `royale-deploy`
 * syncs resources and restarts FXServer, which is tens of seconds; the game
 * pushes every two. Anything past five minutes is not a slow restart, it is a
 * problem — and at that point the honest thing is to stop offering an excuse and
 * let `Feed lost` say what is true. Note the console does NOT then claim the
 * deploy succeeded: see the note on the completion toast in lib/livePoll.
 */
export const RESTART_GRACE_MS = 5 * 60_000

export function updateInProgress(input: {
  /** The stored window's state, or null when no window has been read. */
  state: MaintenanceState | null | undefined
  /** When the deploy step finished, epoch ms. Null while it has not. */
  completedAt: number | null | undefined
  /** When the console last received a push from the game, epoch ms, or null. */
  lastPushAt: number | null | undefined
  now: number
}): boolean {
  /**
   * THE DEPLOY IS RUNNING. A stated fact, and the only unconditional yes.
   */
  if (input.state === 'deploying') return true

  /**
   * THE DEPLOY FINISHED — but "finished" is the verb returning, not the server
   * answering. Anything other than a completed window falls through: scheduled
   * and draining are states where the server is UP and its health chips are
   * exactly what an operator wants (draining with players still on is the case
   * where "Live" genuinely matters), and null is the unread row that must never
   * hide anything.
   */
  if (input.state !== 'complete') return false
  if (typeof input.completedAt !== 'number') return false

  /**
   * IT IS BACK. A push that landed AFTER the deploy finished can only have come
   * from the restarted server. Note `>` and not `>=`: they are both console-side
   * `Date.now()` readings, so a tie is a push that raced the completion write
   * within the same millisecond and proves nothing about the new process.
   */
  if (typeof input.lastPushAt === 'number' && input.lastPushAt > input.completedAt) {
    return false
  }

  /**
   * Still silent. That is only an update in progress for as long as a restart
   * plausibly accounts for it — and this is also what stops a `complete` window
   * sitting on the row for three days from claiming the server is mid-update
   * forever, which it otherwise would on any console with no live feed at all.
   */
  return input.now - input.completedAt < RESTART_GRACE_MS
}
