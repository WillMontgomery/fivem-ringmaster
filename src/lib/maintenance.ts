import { ddb, tables } from './dynamo'
// TYPE-ONLY, AND IT HAS TO STAY THAT WAY. `lib/ssh` imports `node:child_process`
// at module scope, and the two rules below are read by MaintenancePanel, which
// is a client component. `import type` is erased outright, so nothing from the
// SSH channel reaches a browser bundle.
import type { RefUpdate, UpdateTarget } from './ssh'

/**
 * Scheduled maintenance.
 *
 * WHAT "MAINTENANCE" MEANS HERE, precisely, because the word usually implies
 * more: it is running `royale-deploy` — pull main, sync resources, restart
 * FXServer. Nothing reboots, no machine goes down, and the box is up the whole
 * time. The expensive part is not the deploy (seconds) but the restart, which
 * ends every match in progress. So the entire design exists to make sure that
 * restart lands when nobody is mid-drop rather than at a convenient moment for
 * the person clicking.
 *
 * THE SHAPE OF A WINDOW:
 *
 *   scheduled ──(drainStartsAt)──► draining ──(server empties)──► deploying
 *       │                              │                              │
 *       └──────── cancelled ───────────┘                        complete
 *
 * While DRAINING the game refuses new connections and starts no new matches,
 * so the population can only fall. When it reaches zero the deploy fires on its
 * own — that automatic step is the point of scheduling at all, since the whole
 * purpose is not having to sit and watch for the server to empty.
 *
 * A SPECIFIC DEPLOY TIME IS OPTIONAL AND NOT THE DEFAULT. Waiting for empty is
 * kinder and almost always works; a fixed time is for the case where you need
 * the change out by a deadline and are willing to end a match to get it. That
 * mode can still find people online when it fires, which is why forcing is an
 * explicit action with its own confirmation rather than something that quietly
 * happens.
 *
 * ONE WINDOW AT A TIME, stored under a fixed key. Two overlapping windows have
 * no sensible meaning — they would both drain and both deploy — and the history
 * lives in the audit log, which is append-only and already records who did
 * what. There is deliberately no "extend": cancel and schedule again, which is
 * one fewer state transition to get wrong and reads identically in the log.
 */

/** The single active window's partition key. */
const CURRENT = 'current'

export type MaintenanceState =
  | 'scheduled'
  | 'draining'
  | 'deploying'
  | 'complete'
  | 'cancelled'

/** How the deploy is triggered once draining starts. */
export type DeployMode = 'when-empty' | 'at-time'

export interface MaintenanceWindow {
  id: string
  state: MaintenanceState

  /** Who scheduled it, for the log and the UI. */
  createdAt: number
  createdBy: string | null
  createdByName: string

  /**
   * Shown to players refused at the door while draining, so "server won't let
   * me in" has an answer that is not a support ticket.
   */
  note: string

  /** When refusing new connections begins. */
  drainStartsAt: number

  deployMode: DeployMode
  /** Only for `at-time`. Absolute, so nothing has to re-derive it. */
  deployAt: number | null

  drainStartedAt?: number | null
  deployStartedAt?: number | null
  completedAt?: number | null

  cancelledAt?: number | null
  cancelledBy?: string | null
  cancelledByName?: string | null

  /**
   * Set when an admin deployed while players were still connected. Recorded
   * because it is the one path that ends matches on purpose, and "who decided
   * that" is the first question afterwards.
   */
  forcedAt?: number | null
  forcedBy?: string | null
  forcedByName?: string | null
  /** How many were online at the moment it was forced. */
  forcedWithPlayers?: number | null

  /**
   * Commits the running server is behind main, kept fresh by the driver.
   *
   * LIVES ON THIS ROW so the game can read one document and learn everything it
   * needs: whether to drain, and whether to nudge admins that an update is
   * waiting. A second row would mean a second GetItem on every game-side poll
   * for a number that changes on the same cadence.
   */
  updateAvailable?: number | null
  /**
   * When the current update was FIRST seen. The 72-hour clock runs from here,
   * not from the last poll — otherwise the deadline would reset every fifteen
   * seconds and never arrive.
   */
  updateFirstSeenAt?: number | null

  /**
   * The branch this window will put on the box, and the exact commit it was
   * chosen at. Null on an ordinary window, which deploys the current tip of
   * whatever ref the host is already on.
   *
   * BOTH, OR NEITHER, AND THE SHA IS THE LOAD-BEARING HALF. Hours pass between
   * an admin picking a branch and the last match ending, and anyone with push
   * access can force-push in the gap. The name alone would deploy whatever the
   * tip happens to be by then; the sha makes it refuse instead. The game box
   * re-checks it twice — `switchref` before it writes the pin, `deploy.sh`
   * before it touches the working tree — so this value is a record of what was
   * agreed, never the thing that enforces it.
   *
   * OPTIONAL BECAUSE ROWS PREDATE IT. Every read must treat absence as "no ref
   * change", which is what an ordinary maintenance window has always been.
   */
  targetRef?: string | null
  targetSha?: string | null

  /**
   * What the deploy verb returned, when it returned a refusal.
   *
   * WRITTEN SINCE `markComplete` WAS WRITTEN AND READ BY NOTHING until the
   * completion gate needed it. It is the difference between the two failures a
   * deploy has — the host refused (code never shipped, server untouched) and
   * the host accepted but the server never came back — and a console that
   * cannot tell them apart sends somebody to the wrong box.
   */
  deployError?: string | null

  /**
   * The game's boot epoch as the console last knew it when the deploy fired.
   *
   * THE THING THAT MAKES "THE SERVER IS BACK" PROVABLE. `bootEpoch` is unique
   * per resource start and the game host restarts resources on every deploy, so
   * a heartbeat carrying a DIFFERENT epoch cannot have come from the process
   * this window restarted. Recorded at `markDeploying`, which is the last
   * moment the old process is still the one we are hearing from.
   *
   * Null when the console had never received a push — an ingest that is not
   * configured, or a console restarted mid-window. `heartbeatIsFresh` falls
   * back to the timestamp comparison there.
   */
  deployBootEpoch?: string | null

  /**
   * When a heartbeat from a NEW process first arrived after the deploy.
   *
   * DURABLE ON PURPOSE, rather than re-derived from the live feed every time
   * somebody loads a page. The live feed is in-memory and dies with the console
   * — so without this, a console that restarts a week later sees a `complete`
   * window, no `bootEpoch` to compare against, and would report that a deploy
   * which demonstrably landed had never confirmed. Once written the verdict is
   * settled, and nothing un-settles it except the next window replacing this
   * row wholesale.
   */
  deployConfirmedAt?: number | null
}

/**
 * A branch name we are willing to send to the game host.
 *
 * SHAPE, NOT POLICY, and deliberately the same shape `valid_ref` enforces in
 * both shell scripts on the box. Which branches are worth deploying is a
 * judgement for the person clicking; what this refuses is the handful of
 * strings that stop being a branch name once git reads them — a leading `-`
 * (an option, and `--upload-pack=` on a fetch is code execution on that box),
 * `..`, `//`, a trailing `/`.
 *
 * THIS IS NOT THE BOUNDARY. The box validates every one of these again, from
 * scratch, on arrival and again when it reads the pin file. This copy exists so
 * a typo is refused with a sentence an admin can act on instead of travelling
 * to the game host to be refused there.
 */
export function isUsableRef(ref: string): boolean {
  if (!ref || ref.length > 120) return false
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) return false
  if (ref.includes('..') || ref.includes('//') || ref.endsWith('/')) return false
  return true
}

/** A full commit id, which is the only form the box will accept as a pin. */
export function isFullSha(sha: string): boolean {
  return /^[0-9a-f]{40}$/.test(sha)
}

/**
 * How long an available update may sit before maintenance schedules itself.
 *
 * WHY AUTOMATE THIS AT ALL. An update nobody schedules is the normal outcome of
 * a busy week, and the cost is silent: the server drifts further from main, the
 * eventual deploy carries more change, and the first thing anybody notices is a
 * bigger, riskier restart. Three days is long enough that no reasonable
 * intention gets overridden and short enough that drift stays small.
 */
export const AUTO_AFTER_MS = 72 * 60 * 60 * 1000

/**
 * The moment maintenance will schedule itself, given when the update appeared.
 *
 * Used by the UI to bound the date picker: there is no point letting somebody
 * choose a deploy time after the automation would already have run, because the
 * automation would win and their choice would silently never happen.
 */
export function autoDeadline(updateFirstSeenAt: number | null | undefined):
  | number
  | null {
  if (!updateFirstSeenAt) return null
  return updateFirstSeenAt + AUTO_AFTER_MS
}

/**
 * HOW FAR BEHIND ITS OWN BRANCH THE BOX IS, OR NULL FOR "WE DO NOT KNOW".
 *
 * ONE DERIVATION, READ BY THE WORDS AND BY THE RULE. The card's sentences and
 * the gate on its button are the same fact seen twice, and the way that fact
 * goes wrong is subtle enough that it must not be spelled out in two places:
 * see `refUpdateFrom` in lib/ssh for why a count paired with the wrong ref, or
 * a confident zero, is worse than silence.
 *
 * A READING TAKEN FOR ANOTHER BRANCH IS NOT A READING. The poller re-reads this
 * on its own two-minute cadence, so between a switch landing and the next
 * answer `deployedRef` already names the new branch while `refUpdate` still
 * describes the old one. Pairing them would print the previous branch's count
 * beside the current branch's name.
 *
 * AND A STALE ZERO IS NOT A ZERO. `stale` means the box could not finish its
 * `git fetch` inside the SSH budget and answered from the refs already on disk,
 * so `behind` MAY UNDERCOUNT — which makes a stale zero exactly the shape of
 * "we have not looked yet", not "we looked and there is nothing". Anything that
 * refuses an action on the strength of a zero has to refuse this one too, or
 * WillMontgomery/fivem-br-gamemode#146 comes back as "the fetch timed out and
 * the console told an operator with a commit in hand that there was nothing to
 * ship". A stale NONZERO is kept: it is a floor, and a floor is information.
 */
export function refBehindNow(
  deployedRef: string | null | undefined,
  refUpdate: Pick<RefUpdate, 'ref' | 'behind' | 'stale'> | null | undefined,
): number | null {
  if (typeof deployedRef !== 'string' || deployedRef === 'main') return null
  if (!refUpdate || refUpdate.ref !== deployedRef) return null
  if (refUpdate.stale && refUpdate.behind === 0) return null
  return refUpdate.behind
}

/**
 * HOW FAR BEHIND MAIN THE BOX IS, OR NULL FOR "WE DO NOT KNOW".
 *
 * THE OTHER HALF OF `refBehindNow`, AND IT EXISTS BECAUSE THE TWO READINGS DID
 * NOT AGREE ABOUT WHAT NULL MEANS. The parked reading has returned `null`,
 * never `0`, since `refUpdateFrom` was written — "we have not looked" and
 * "there is nothing" are different facts and the whole safety of
 * `nothingToDeploy` rests on their staying apart. The main reading was spelled
 * `behindMain ?? 0` at four call sites, which folds an unanswered host into
 * "zero commits behind" and renders it as *up to date*. Same question, same
 * three states: known-behind, known-level, NOT YET KNOWN.
 *
 * WHAT "NOT YET KNOWN" ACTUALLY IS HERE, because it is not hypothetical. The
 * telemetry poller holds `status` as null until its first SSH round trip lands,
 * and `ensureDriver` starts the driver's tick and that poller in the same
 * breath — so the first driver tick after every console restart runs with no
 * status at all. Under `?? 0` that tick wrote `updateAvailable: 0` over a real
 * pending update AND cleared `updateFirstSeenAt`, which is the start of the
 * 72-hour automatic-deploy clock. A console that restarted daily could never
 * reach the deadline it exists to enforce.
 *
 * IT ANSWERS ONLY FOR MAIN, which is the mirror of `refBehindNow` answering
 * only off it. `behindMain` on a parked box is a large permanent number
 * describing an update nobody is waiting for, and every surface that has ever
 * rendered it beside a branch name has been a bug. Null there is not a gap in
 * our knowledge; it is the correct answer to a question that does not apply.
 *
 * A HOST THAT HAS NOT NAMED ITS REF FOLDS IN WITH MAIN, not with parked — the
 * `isParkedOffMain` polarity, not `!isOnMain`. This decides what a human READS
 * and what a human may ASK FOR, and an older dispatcher must keep behaving
 * exactly as it always has. lib/ssh states the rule; this obeys it rather than
 * restating it, which is why the comparison is spelled out the same way
 * `refBehindNow` spells it rather than importing the function (lib/ssh reaches
 * `node:child_process` at module scope and this file is read by a client
 * component — see the import at the top).
 */
export function behindMainNow(
  status:
    | { behindMain?: number | null; deployedRef?: string | null }
    | null
    | undefined,
): number | null {
  if (!status) return null
  const ref = status.deployedRef
  if (typeof ref === 'string' && ref !== 'main') return null
  return typeof status.behindMain === 'number' ? status.behindMain : null
}

/**
 * THE TWO COMMITS A DEPLOY WOULD MOVE BETWEEN, OR NULL.
 *
 * THE PAIRING RULE, ONCE, for the same reason `refBehindNow` states it once: a
 * reading taken for another branch is not a reading. `updateTarget` is refreshed
 * on the two-minute `branches` cadence while `deployedRef` moves on the
 * fifteen-second `status` one, so between a switch landing and the next answer
 * the poller holds a pair of commits belonging to the previous branch. Rendering
 * those under the new branch's name is the exact mislabelling every reading on
 * this page is guarded against.
 *
 * AN ARROW THAT POINTS AT ITSELF IS NOT AN UPDATE. `fromSha === toSha` is the
 * box sitting on the tip it would deploy — which is a real and common state, and
 * one where "moving from X to X" is worse than saying nothing. It also covers a
 * skew the count cannot: `behindMain` comes off a fifteen-second poll and these
 * shas off a two-minute one, so just after a deploy the count can still say
 * "behind" while the pair already agrees. The pair is the more recent fact about
 * the commits and is allowed to withhold the arrow; it is never allowed to
 * invent one.
 *
 * STALENESS IS CARRIED, NOT REFUSED, and that is the opposite of the rule for a
 * stale ZERO in `refBehindNow`. A stale zero is indistinguishable from "we have
 * not looked", so it must not refuse a deploy. A stale TIP is a real commit that
 * really was the tip when the box last managed a fetch — it may simply have been
 * overtaken. Withholding it would leave the operator with no commit to read at
 * all; showing it and saying it may have moved on leaves them better off.
 */
export function updateTargetNow(
  deployedRef: string | null | undefined,
  updateTarget: UpdateTarget | null | undefined,
): UpdateTarget | null {
  if (!updateTarget) return null
  // A host that has not named its ref cannot have a reading paired to it.
  if (typeof deployedRef !== 'string') return null
  if (updateTarget.ref !== deployedRef) return null
  if (updateTarget.fromSha === updateTarget.toSha) return null
  return updateTarget
}

/** Why a deploy cannot be asked for, in the three registers it gets read in. */
export interface NothingToDeploy {
  /** After the fact — the body of the 409, and what a toast would show. */
  reason: string
  /**
   * Instead of the box — what IS true, stated in one line.
   *
   * The scheduling card does not render at all when this object exists (the
   * owner: "the schedule an update box shouldn't even exist when there is no
   * update found"), and a card that renders nothing reads as a broken page. So
   * the space says the fact the missing box would have argued with, and it
   * names the ref, because "running the latest code" under a banner that says
   * the server is not on main is only true of one branch.
   */
  state: string
  /** And what would bring the box back. */
  fix: string
}

/**
 * IS THERE A DEPLOY A HUMAN COULD ASK FOR? Null means yes, go ahead.
 *
 * THE ONE COPY OF THIS RULE. It is called twice: by `api/maintenance` before it
 * schedules, and by `MaintenancePanel` to decide whether the scheduling box is
 * on the page at all. Those two must never disagree — a box that produces a 409
 * is a console lying to an operator, and a missing box over a request the server
 * would have honoured is #146 again — so neither of them states the rule itself.
 * Both read the SAME telemetry snapshot as well as the same function
 * (`hostView()` in the route, the same object over `/api/host` in the panel), so
 * the only way they can differ is one poll interval of skew, which resolves
 * itself. Absent box, refused request; present box, accepted request — one
 * expression decides both.
 *
 * KNOWN ZERO IS THE ONLY REFUSAL, ON EITHER REF. Not "unknown", which is the
 * trap: the count against a parked branch is null whenever the host has not
 * answered, whenever the branch is gone from the remote, for the first couple of
 * minutes after the console boots, and whenever the box's own fetch timed out.
 * Refusing on any of those would re-create #146 with a better excuse — the
 * operator has the commit, and we would be declining to ship it on the strength
 * of a number we do not have. Unknown renders the box and takes the deploy, and
 * that matters more now that the box disappears rather than greys out: there is
 * no longer a disabled control left behind to hint that the action exists at all.
 *
 * AND THE MAIN SIDE NOW OBEYS THAT SENTENCE TOO. It used to read
 * `(input.behindMain ?? 0) > 0`, which refuses on unknown — the coalesce turns
 * "the host has not answered yet" into a known zero and the console removes its
 * own scheduling box on the strength of it. That is #146 with the control
 * removed rather than greyed, on main, and it is reachable on every console
 * restart: the driver's first tick runs before the telemetry poller's first
 * answer. `behindMainNow` supplies the null; the test below is `!== 0` so the
 * null cannot fall into the zero branch, exactly as the parked side has always
 * been written.
 *
 * BOTH REFS, ONE FACT. On main the number is the distance from reviewed code;
 * parked it is the distance from the tip of the branch the box is actually on.
 * They are different measurements and must never be swapped (see lib/ssh), but
 * "it is zero, so a deploy would restart every match in progress to change
 * nothing" reads the same either way, which is why one function answers for
 * both — and now the two sides answer "we do not know" the same way as well.
 *
 * A REF CHANGE IS EXEMPT AND HAS TO BE, and that exemption lives here rather
 * than beside each caller. Switching branch changes WHICH CODE runs, not how
 * current it is: reverting to main from a branch sitting at main's tip, and
 * switching between two branches level with each other, are both real actions
 * with a legitimate zero in front of them.
 */
export function nothingToDeploy(input: {
  /**
   * Distance from main, as {@link behindMainNow} answers it: a number, or NULL
   * for "the host has not told us". Never coalesce this to zero at a call site
   * — that is the bug the `!== 0` below exists to be immune to, and a caller
   * that writes `?? 0` on the way in defeats it before it runs.
   */
  behindMain?: number | null
  /** What the host says it is running. Absent or `main` is the main case. */
  deployedRef?: string | null
  /** The parked-branch reading, unpaired; {@link refBehindNow} pairs it. */
  refUpdate?: Pick<RefUpdate, 'ref' | 'behind' | 'stale'> | null
  /** True when the same action also switches the box to another ref. */
  changingRef: boolean
}): NothingToDeploy | null {
  if (input.changingRef) return null

  const ref = input.deployedRef
  if (typeof ref === 'string' && ref !== 'main') {
    /**
     * `!== 0`, NEVER `!behind`, AND THAT ONE CHARACTER IS THE WHOLE SAFETY OF
     * THIS FUNCTION. `refBehindNow` returns a number or null, and in JavaScript
     * `!0` and `!null` are both true — so the falsy spelling folds "we looked
     * and there is nothing" together with "we have not looked", which is
     * precisely the collapse that produces #146. Only a reading that IS the
     * number zero refuses anything here.
     */
    if (refBehindNow(ref, input.refUpdate) !== 0) return null
    return {
      reason: `${ref} has not moved since this server deployed — there is nothing to deploy.`,
      state: `The server is running the latest code on ${ref}.`,
      fix: `There is nothing to schedule until somebody pushes to ${ref}. Putting a different branch on the box — or main back — is a different action, and it is below.`,
    }
  }

  /**
   * `!== 0`, NEVER `> 0`, AND IT IS THE SAME CHARACTER-LEVEL RULE AS ABOVE.
   * `undefined > 0` and `null > 0` are both false, so the comparison that reads
   * like "is there an update" quietly refuses on both spellings of "we have not
   * looked". Only a reading that IS the number zero refuses anything here.
   */
  if (input.behindMain !== 0) return null
  return {
    reason:
      'The server is already running the latest code — there is nothing to deploy.',
    state: 'The server is running the latest code.',
    fix: 'Maintenance can only be scheduled when there is an update to deploy.',
  }
}

/** States in which the window still governs the server's behaviour. */
export function isLive(w: MaintenanceWindow | null): w is MaintenanceWindow {
  if (!w) return false
  return w.state === 'scheduled' || w.state === 'draining' || w.state === 'deploying'
}

/**
 * Should the game be refusing connections right now?
 *
 * DERIVED FROM THE CLOCK, NOT FROM THE STORED STATE, so a console that was
 * asleep when `drainStartsAt` passed does not leave the server accepting
 * players it should be turning away. The stored state catches up on the next
 * tick; this answer is correct immediately.
 */
export function isDraining(
  w: MaintenanceWindow | null,
  now = Date.now(),
): w is MaintenanceWindow {
  if (!isLive(w)) return false
  if (w.state === 'deploying') return true
  return now >= w.drainStartsAt
}

/**
 * Record how far behind main the server is, and when we first noticed.
 *
 * WRITTEN ON THE SAME ROW THE GAME POLLS, so one GetItem tells the game both
 * whether to drain and whether to nudge admins about a waiting update.
 *
 * `updateFirstSeenAt` is set once and left alone while the update persists. It
 * is the start of the 72-hour clock, and refreshing it on every poll would push
 * the deadline forever into the future — the automation would never fire, which
 * is the exact failure it exists to prevent.
 */
export async function noteUpdateAvailable(behind: number): Promise<void> {
  const existing = await current()

  // Back in sync: clear the flag and the clock together, so the next update
  // starts a fresh three days rather than inheriting an old deadline.
  if (behind <= 0) {
    if (!existing) return
    await ddb
      .update({
        TableName: tables.maintenance,
        Key: { id: CURRENT },
        UpdateExpression: 'SET updateAvailable = :z, updateFirstSeenAt = :n',
        ExpressionAttributeValues: { ':z': 0, ':n': null },
      })
      .catch(() => {})
    return
  }

  const firstSeen = existing?.updateFirstSeenAt || Date.now()

  if (!existing) {
    // No row yet — the game still needs one to read, so create a minimal
    // finished window carrying just the update signal.
    await ddb.put({
      TableName: tables.maintenance,
      Item: {
        id: CURRENT,
        state: 'complete',
        createdAt: Date.now(),
        createdBy: null,
        createdByName: 'system',
        note: '',
        drainStartsAt: 0,
        deployMode: 'when-empty',
        deployAt: null,
        updateAvailable: behind,
        updateFirstSeenAt: firstSeen,
      } satisfies MaintenanceWindow,
    })
    return
  }

  await ddb
    .update({
      TableName: tables.maintenance,
      Key: { id: CURRENT },
      UpdateExpression: 'SET updateAvailable = :b, updateFirstSeenAt = :f',
      ExpressionAttributeValues: { ':b': behind, ':f': firstSeen },
    })
    .catch(() => {})
}

export async function current(): Promise<MaintenanceWindow | null> {
  const res = await ddb.get({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
  })
  return (res.Item as MaintenanceWindow | undefined) ?? null
}

/**
 * Schedule a window, replacing any finished one.
 *
 * REFUSES TO OVERWRITE A LIVE WINDOW. Scheduling on top of one that is already
 * draining would silently move the goalposts on a server that is already
 * turning players away — the caller has to cancel first, which is a decision
 * with a name in the audit log rather than an accident.
 */
export async function schedule(input: {
  createdBy: string | null
  createdByName: string
  note: string
  drainStartsAt: number
  deployMode: DeployMode
  deployAt: number | null
  /** Both or neither. See {@link MaintenanceWindow.targetRef}. */
  targetRef?: string | null
  targetSha?: string | null
}): Promise<MaintenanceWindow> {
  const existing = await current()

  // Read BEFORE the guard below. `isLive` is a type predicate, so once it has
  // been called TypeScript narrows `existing` to null on the false branch —
  // correct for control flow, useless for reading fields off the row we are
  // about to replace.
  const carriedAvailable = existing?.updateAvailable ?? null
  const carriedFirstSeen = existing?.updateFirstSeenAt ?? null

  if (isLive(existing)) {
    throw new Error('A maintenance window is already scheduled. Cancel it first.')
  }

  const w: MaintenanceWindow = {
    id: CURRENT,
    state: 'scheduled',
    createdAt: Date.now(),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    note: input.note,
    drainStartsAt: input.drainStartsAt,
    deployMode: input.deployMode,
    deployAt: input.deployMode === 'at-time' ? input.deployAt : null,
    drainStartedAt: null,
    deployStartedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelledByName: null,
    forcedAt: null,
    forcedBy: null,
    forcedByName: null,
    forcedWithPlayers: null,

    // CARRIED FORWARD, not reset. This is a full put over the same key, so
    // anything not repeated here is destroyed — and losing `updateFirstSeenAt`
    // would restart the 72-hour clock every time somebody scheduled and
    // cancelled, which is the one sequence that must not defeat the automation.
    updateAvailable: carriedAvailable,
    updateFirstSeenAt: carriedFirstSeen,

    /**
     * NOT carried forward, and the asymmetry with the two lines above is the
     * point. A ref change belongs to the window that asked for it: carrying it
     * would mean the NEXT window — an ordinary update, or one somebody
     * scheduled for a different reason entirely — silently inherited a branch
     * switch nobody chose in it.
     *
     * That this row is a full `put` is also exactly why the off-main automation
     * gate is NOT stored here. It is derived from the game host on every driver
     * tick; a flag on this row would be wiped by any schedule/cancel cycle,
     * after which the driver would auto-deploy main over a parked branch and
     * attribute it to `system`.
     */
    targetRef: input.targetRef ?? null,
    targetSha: input.targetSha ?? null,

    /**
     * THE PREVIOUS DEPLOY'S VERDICT IS CLEARED HERE, and the full `put` is what
     * does it. These three describe one deploy — whether it errored, which
     * process it restarted, and whether a new one ever spoke — and carrying
     * them into a window that has not deployed anything yet would leave the
     * page showing last week's failure over this week's countdown. Written as
     * explicit nulls rather than omitted so the intent is legible on the row.
     */
    deployError: null,
    deployBootEpoch: null,
    deployConfirmedAt: null,
  }

  await ddb.put({ TableName: tables.maintenance, Item: w })
  return w
}

/**
 * Cancel the live window.
 *
 * The row is kept in the cancelled state rather than deleted, for the same
 * reason a lifted ban keeps its row: "was there a window and who called it off"
 * is a real question, and a table that deletes cannot answer it.
 */
export async function cancel(input: {
  by: string | null
  byName: string
}): Promise<void> {
  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression:
      'attribute_exists(id) AND (#s = :scheduled OR #s = :draining)',
    UpdateExpression:
      'SET #s = :cancelled, cancelledAt = :t, cancelledBy = :b, cancelledByName = :n',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: {
      ':cancelled': 'cancelled',
      ':scheduled': 'scheduled',
      ':draining': 'draining',
      ':t': Date.now(),
      ':b': input.by,
      ':n': input.byName,
    },
  })
}

/** Move a scheduled window into draining. Idempotent by condition. */
export async function markDraining(): Promise<void> {
  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression: '#s = :scheduled',
    UpdateExpression: 'SET #s = :draining, drainStartedAt = :t',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: {
      ':scheduled': 'scheduled',
      ':draining': 'draining',
      ':t': Date.now(),
    },
  })
}

/**
 * Move into deploying. The condition is what makes this safe to call from a
 * timer: two ticks racing produce one winner and one harmless failure, so the
 * deploy cannot fire twice.
 */
export async function markDeploying(input?: {
  forcedBy?: string | null
  forcedByName?: string | null
  withPlayers?: number
  /**
   * The boot epoch of the process about to be restarted, from `liveView`.
   *
   * PASSED IN RATHER THAN READ HERE. `lib/state` is server-only in-memory
   * state and this module is imported by `MaintenancePanel`, a client
   * component — the same reason `lib/ssh` is only ever `import type`d at the
   * top of this file. The two callers that fire a deploy already hold the live
   * view; handing over one string keeps the boundary intact.
   *
   * THIS IS THE LAST MOMENT IT IS TRUE. A tick later the process is gone and
   * whatever the console is hearing from is the thing we would be trying to
   * distinguish it from.
   */
  bootEpoch?: string | null
}): Promise<void> {
  const forced = Boolean(input?.forcedBy || input?.forcedByName)
  const t = Date.now()

  /**
   * THE PREVIOUS DEPLOY'S VERDICT IS CLEARED IN THE SAME WRITE THAT STARTS THIS
   * ONE. A window that was scheduled on top of a `complete` row keeps that
   * row's fields (`schedule` nulls them, but a forced deploy on a window
   * scheduled before this change would not) — and a stale `deployConfirmedAt`
   * would declare the new deploy confirmed the instant it finished, which is
   * exactly the false success the gate exists to prevent.
   */
  const sets = [
    '#s = :deploying',
    'deployStartedAt = :t',
    'deployBootEpoch = :be',
    'deployConfirmedAt = :null',
    'deployError = :null',
  ]

  const values: Record<string, unknown> = {
    ':deploying': 'deploying',
    ':scheduled': 'scheduled',
    ':draining': 'draining',
    ':t': t,
    ':be': input?.bootEpoch ?? null,
    ':null': null,
  }

  if (forced) {
    sets.push(
      'forcedAt = :t',
      'forcedBy = :fb',
      'forcedByName = :fn',
      'forcedWithPlayers = :fp',
    )
    values[':fb'] = input?.forcedBy ?? null
    values[':fn'] = input?.forcedByName ?? null
    values[':fp'] = input?.withPlayers ?? 0
  }

  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression: '#s = :scheduled OR #s = :draining',
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: values,
  })
}

/**
 * Record that the game came back — the first heartbeat from a NEW process.
 *
 * WHY THIS IS WRITTEN DOWN RATHER THAN RE-DERIVED. The evidence is in-memory
 * live state, which dies with the console; the question ("did that deploy
 * land?") outlives it by weeks. Without a durable answer, a console restarted
 * later would look at a `complete` window, find no boot epoch to compare
 * against, and report a deploy that demonstrably worked as never confirmed.
 *
 * CONDITIONAL, SO IT IS WRITE-ONCE. Two ticks racing produce one winner and one
 * harmless failure, and a window that has moved on since is not overwritten.
 * `deployConfirmedAt = :null` is in the condition beside `attribute_not_exists`
 * because `schedule` writes the field as an explicit null rather than omitting
 * it, and a NULL attribute exists.
 */
export async function markDeployConfirmed(at: number): Promise<void> {
  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    ConditionExpression:
      '#s = :complete AND (attribute_not_exists(deployConfirmedAt) OR deployConfirmedAt = :null)',
    UpdateExpression: 'SET deployConfirmedAt = :t',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: {
      ':complete': 'complete',
      ':null': null,
      ':t': at,
    },
  })
}

export async function markComplete(error?: string | null): Promise<void> {
  /**
   * CLEARS THE UPDATE SIGNAL ON SUCCESS, and that is a bug fix rather than
   * tidying.
   *
   * `updateAvailable` is refreshed from the host's `status`, which only
   * re-checks the remote on a throttle — so for a minute or so after a
   * successful deploy the row still said an update was waiting. The console
   * duly offered to schedule maintenance for an update that had just been
   * applied: a restart that would end every match in progress and change
   * nothing.
   *
   * Clearing it here makes the console correct immediately and the next poll
   * simply re-confirms zero. A FAILED deploy deliberately leaves the signal
   * alone — the update genuinely is still waiting, and hiding it would be the
   * opposite mistake.
   */
  const clearSignal = !error

  await ddb.update({
    TableName: tables.maintenance,
    Key: { id: CURRENT },
    UpdateExpression: clearSignal
      ? 'SET #s = :complete, completedAt = :t, deployError = :e, updateAvailable = :z, updateFirstSeenAt = :null'
      : 'SET #s = :complete, completedAt = :t, deployError = :e',
    ExpressionAttributeNames: { '#s': 'state' },
    ExpressionAttributeValues: clearSignal
      ? {
          ':complete': 'complete',
          ':t': Date.now(),
          ':e': null,
          ':z': 0,
          ':null': null,
        }
      : {
          ':complete': 'complete',
          ':t': Date.now(),
          ':e': error,
        },
  })
}

/**
 * The badge state the console chrome shows, or null when nothing is planned.
 *
 * THREE, NOT TWO, AND THE THIRD IS THE ONE THAT WAS MISSING. This collapsed the
 * five states into "something is coming" and "something is happening now" —
 * and `deploying` fell into the second, because `isDraining` returns true for
 * it. So the chip said DRAINING through the entire deploy, which is the one
 * moment it is not true: draining is the server emptying itself with players
 * still on, and deploying is the server restarted and gone. An operator
 * watching the chip could not tell "waiting for the last match to finish" from
 * "the server is down right now", which are different answers to "can I ask
 * somebody to join".
 *
 * `updating` IS ALSO WHAT SUPPRESSES THE HEALTH CHIPS beside it — see
 * `updateInProgress` in lib/serverPhase. The order of the tests matters: the
 * `deploying` check comes FIRST, because `isDraining` would otherwise claim it.
 */
export function badgeState(
  w: MaintenanceWindow | null,
  now = Date.now(),
): 'scheduled' | 'draining' | 'updating' | null {
  if (!isLive(w)) return null
  if (w.state === 'deploying') return 'updating'
  return isDraining(w, now) ? 'draining' : 'scheduled'
}
