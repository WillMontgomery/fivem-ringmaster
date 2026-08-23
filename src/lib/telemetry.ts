import { REF_POLL_MS } from './maintenance'
import {
  isParkedOffMain,
  listBranches,
  refUpdateFrom,
  runVerb,
  sshConfigured,
  updateTargetFrom,
  type HostStatus,
  type HostTelemetry,
  type RefUpdate,
  type UpdateTarget,
} from './ssh'

/**
 * Host telemetry, polled and held in a rolling window.
 *
 * IN-MEMORY, ONE INSTANCE, and short-lived on purpose — the same shape as the
 * live player state. A graph of the last hour is worthless the moment the box
 * that drew it restarts, and the durable record belongs in DynamoDB
 * (ringmaster-telemetry, provisioned but not yet written — that is the M3b
 * follow-up). Losing the window on restart costs one poll interval of history,
 * which nobody misses.
 *
 * The poll runs SERVER-SIDE on a timer, not per request: an SSH round trip per
 * browser refresh would be slow and would hammer the game box. The page reads
 * whatever the timer last collected.
 */

const globalForTel = globalThis as unknown as { ringTel?: TelState }

interface Sample extends HostTelemetry {
  /** Bytes/sec since the previous sample, computed here from the counters. */
  rxRate: number
  txRate: number
}

interface TelState {
  status: HostStatus | null
  statusAt: number
  samples: Sample[]
  lastError: string | null
  polling: boolean
  timer: ReturnType<typeof setInterval> | null

  /** How far the box is behind its own branch. Null on main and when unknown. */
  refUpdate: RefUpdate | null
  /**
   * The two commits an update would move between, on WHICHEVER ref the box is
   * on — main included. Null until a `branches` answer has been read.
   *
   * SEPARATE FROM `refUpdate` BECAUSE IT ANSWERS FOR MAIN TOO. They come out of
   * the same `branches` call one line apart; what differs is that this one
   * carries no count, so it cannot disagree with `behindMain`. See
   * `updateTargetFrom` in lib/ssh for why that is the whole reason it may cover
   * main at all.
   */
  updateTarget: UpdateTarget | null
  /** `<ref>@<deployed sha>` of the last attempt, whether or not it succeeded. */
  refKey: string
  /** When that attempt started, so a failing host is throttled too. */
  refPolledAt: number
  /** One `branches` call at a time; they are slow and they fetch. */
  refBusy: boolean
}

/** ~30 min at one sample per 15s. Enough to see a trend, cheap to hold. */
const WINDOW = 120
const POLL_MS = 15_000

/**
 * How often the parked branch's own tip is re-read. NOT the poll interval.
 *
 * ═══ THE NUMBER ITSELF NOW LIVES IN lib/maintenance ═══
 *
 * `updateTargetNow` refuses a destination reading that is too old to stand
 * behind, and it expresses "too old" as a multiple of THIS interval — so the two
 * have to be one constant or the freshness gate ends up calibrated for a cadence
 * that no longer exists. lib/maintenance is where it can be imported from both
 * sides: this module reaches `node:child_process` through lib/ssh and can never
 * be imported by a client component, and the gate is read by one.
 *
 * The reasoning below is why the number is what it is, and is unchanged.
 *
 * TWO MINUTES IS A COST DECISION, and the cost is on the game box rather than
 * here. `status` and `telemetry` read files and run `rev-list` against refs
 * already on disk; `branches` runs a real `git fetch --prune origin` against
 * GitHub with a four-second timeout, which is why the branch picker loads it on
 * demand and nothing in this console has ever put it on a timer. Two minutes is
 * roughly the cadence the box already fetches at anyway — `do_status` kicks off
 * a detached `git fetch origin main` whenever its cached ref is over a minute
 * old — so this adds work of the same order, not a new class of it.
 *
 * WHY A TIMER AT ALL, given that rule. The owner's requirement is that a commit
 * pushed to the parked branch is DISCOVERED, not merely discoverable: an
 * operator who has to open the branch picker to find out that the branch they
 * are testing has moved has not been told anything, they have gone looking. A
 * server-side timer is also strictly cheaper than the alternative that was
 * available — polling from the page — because it is bounded by wall-clock time
 * rather than by how many browser tabs are open, which is the exact reason
 * `/api/host/branches` is `process`-scoped.
 */
export { REF_POLL_MS }

function create(): TelState {
  return {
    status: null,
    statusAt: 0,
    samples: [],
    lastError: null,
    polling: false,
    timer: null,
    refUpdate: null,
    updateTarget: null,
    refKey: '',
    refPolledAt: 0,
    refBusy: false,
  }
}

const state: TelState = (globalForTel.ringTel ??= create())

/**
 * Derive per-second network rates from two cumulative samples.
 *
 * The dispatcher sends cumulative rx/tx byte counters, not rates, so the rate
 * is computed here — where the two timestamps that define the interval both
 * exist. A counter reset (host reboot, counter wrap) shows as a negative delta;
 * clamp to zero rather than draw a spike downward.
 */
function rateBetween(prev: HostTelemetry | undefined, cur: HostTelemetry): {
  rxRate: number
  txRate: number
} {
  if (!prev) return { rxRate: 0, txRate: 0 }
  const dt = (cur.at - prev.at) / 1000
  if (dt <= 0) return { rxRate: 0, txRate: 0 }
  return {
    rxRate: Math.max(0, (cur.rxBytes - prev.rxBytes) / dt),
    txRate: Math.max(0, (cur.txBytes - prev.txBytes) / dt),
  }
}

/**
 * Re-read how far the box is behind the branch it is parked on.
 *
 * DETACHED FROM THE SAMPLE PATH ON PURPOSE. This is a second SSH round trip
 * that can eat most of its six-second budget on the box's `git fetch`; awaiting
 * it inside `poll()` would make the CPU and memory graph lose samples whenever
 * GitHub was slow, which is a real regression to buy a number that changes when
 * somebody pushes. It runs beside the sample and lands whenever it lands.
 *
 * THE KEY IS THE THROTTLE, NOT A TIMESTAMP ALONE. Re-reading on a fixed
 * interval would leave the count wrong for up to two minutes after the two
 * moments it visibly matters — a deploy landing (the count should drop to zero
 * as the restart finishes, not two minutes later) and a branch switch (the old
 * branch's number must not sit under the new branch's name for a moment, which
 * is precisely the mislabelling this whole change exists to avoid). Both move
 * `deployedRef` or the deployed sha, so keying on the pair asks again
 * immediately for exactly those, and throttles everything else.
 *
 * A FAILED READ KEEPS THE LAST ONE, same as a failed sample keeps the last
 * graph. What it must not do is claim zero: `refUpdateFrom` returns null when
 * the branch is gone from the remote, and null renders as nothing rather than
 * as "you are up to date".
 *
 * ONE ANSWER, TWO READINGS. `refUpdateFrom` and `updateTargetFrom` are handed
 * the same `branches` object and assigned in the same beat, on purpose: the
 * count and the pair of commits it stands for must describe one moment. Read on
 * two cadences they would eventually render "3 new commits" beside an arrow
 * pointing at a tip from before those commits existed.
 */
async function pollDeployedRef(
  status: HostStatus,
  /**
   * Skip the interval, not the concurrency guard. See `refreshDeployedRef`.
   */
  force = false,
): Promise<void> {
  if (state.refBusy) return

  const key = `${status.deployedRef ?? ''}@${status.sha ?? ''}`
  const now = Date.now()
  if (!force && key === state.refKey && now - state.refPolledAt < REF_POLL_MS) {
    return
  }

  state.refKey = key
  state.refPolledAt = now
  state.refBusy = true
  try {
    const answer = await listBranches()
    state.refUpdate = refUpdateFrom(answer)
    state.updateTarget = updateTargetFrom(answer)
  } catch {
    /* keep the last reading; a dropped fetch is not a branch that moved */
  } finally {
    state.refBusy = false
  }
}

/**
 * Re-resolve the destination NOW, past the throttle, because somebody is acting.
 *
 * ═══ WHY A TIMER ALONE WAS NOT ENOUGH ═══
 *
 * The owner: "`latest` is confirmed deployed, but the hash on the maintenance
 * page isn't the latest hash. So it's misleading to say we're going from X to Y
 * but we actually end up on Z, which is the latest."
 *
 * The destination on that page is `updateTarget.toSha`, refreshed on the
 * two-minute cadence above; `tools/deploy.sh` resolves the destination itself,
 * from its own unbounded `git fetch`, at the instant it runs. The timer is the
 * right shape for a value nobody is looking at — it is bounded by wall clock
 * rather than by how many tabs are open, which is the whole reason `branches` is
 * not polled from the page. It is the wrong shape for the two instants when the
 * value stops being decoration and becomes a claim somebody is about to act on.
 *
 * SO THE TIMER STAYS AND THIS IS ADDED BESIDE IT, called only from those two
 * instants — `POST /api/maintenance`, where a human has pressed the button, and
 * the driver immediately before it fires the deploy. Both are human-scale events
 * that happen a handful of times a week, so this adds a `branches` call per
 * DEPLOY rather than per poll, per tab or per page load. Putting it anywhere
 * that is polled would undo the cost decision the interval exists to make.
 *
 * `refBusy` IS STILL RESPECTED AND `force` DOES NOT MEAN "TWICE AT ONCE". What
 * is being skipped is the interval, not the one-at-a-time rule: `branches` runs
 * a real `git fetch --prune` on the game box, and two of them racing is the
 * thing the box's four-second budget cannot absorb. A call that arrives while
 * one is already in flight returns immediately and gets that one's answer, which
 * is by definition current enough.
 *
 * IT CANNOT HANG THE CALLER. `listBranches` goes through `runVerb`, which is
 * bounded at six seconds by `execFile`'s own timeout, so the worst this adds to
 * a button press is that. A failure keeps the last reading, exactly as the timer
 * does — a route that could not re-resolve must not be a route that refuses.
 *
 * NO-OP WITH NO HOST READING. Without a `status` there is no key to throttle on
 * and no ref to resolve; the poller's first answer is what starts this working,
 * and until then the console says nothing rather than guessing, which is the
 * rule everywhere else on this page.
 */
export async function refreshDeployedRef(): Promise<void> {
  if (!sshConfigured()) return
  const status = state.status
  if (!status) return
  await pollDeployedRef(status, true)
}

/**
 * Ask the box WHICH COMMIT IT IS ON, right now, past the fifteen-second timer.
 *
 * ═══ THE ONE MOMENT THE POLL'S SKEW IS NOT ACCEPTABLE ═══
 *
 * `deployLandedSha` is the console's answer to "where did that deploy actually
 * go", and it goes into the audit trail. It is written the instant a heartbeat
 * proves the restarted process is up — which rides the two-second live feed,
 * while `status` is re-read every fifteen. So the reading in memory at that
 * instant could be from BEFORE the restart, and the field's own comment used to
 * concede exactly that: "the value is either the landed commit or the one before
 * it". The one before it is the commit the server was LEAVING. A record that may
 * name the wrong end of the move it exists to describe is not a record.
 *
 * SO THE DRIVER FORCES A READ THERE, and this is it. Same shape as
 * `refreshDeployedRef` above and called from the same class of moment: not on a
 * timer, but at the instant a value stops being decoration and becomes something
 * written down.
 *
 * NO BUSY GUARD, UNLIKE `refreshDeployedRef`, AND THE ASYMMETRY IS THE COST.
 * That one guards because `branches` runs a real `git fetch --prune` against
 * GitHub inside the box's four-second budget, and two of those racing is what it
 * cannot absorb. `status` reads files and runs `rev-list` against refs already on
 * disk — `poll()` fetches it alongside `telemetry` every tick precisely because
 * it is that cheap — so one extra call per DEPLOY needs no scheduling around.
 *
 * IT RETURNS THE READING RATHER THAN LEAVING THE CALLER TO GO AND LOOK, because
 * the caller has to be able to tell a fresh answer from a kept one. `hostView()`
 * cannot express that difference: on a failed read it hands back the previous
 * `status`, which here is the pre-restart commit — the exact value being fixed.
 * Null means THIS read did not land, and the driver writes "not recorded" rather
 * than a commit it cannot stand behind.
 *
 * A FAILURE STILL KEEPS THE LAST READING IN STATE, same as a failed poll. The
 * graph and the header must not blank because one SSH round trip during a
 * restart timed out; it is only the audit write that treats "we could not ask"
 * as an answer of its own.
 */
export async function refreshStatus(): Promise<HostStatus | null> {
  if (!sshConfigured()) return null
  try {
    const status = await runVerb<HostStatus>('status')
    state.status = status
    state.statusAt = Date.now()
    return status
  } catch {
    return null
  }
}

async function poll(): Promise<void> {
  if (!sshConfigured()) return

  try {
    // Status changes rarely; telemetry every tick. Both are cheap enough to
    // fetch together, and fetching them on the same connection keeps the two
    // views consistent.
    const [status, tel] = await Promise.all([
      runVerb<HostStatus>('status'),
      runVerb<HostTelemetry>('telemetry'),
    ])

    state.status = status
    state.statusAt = Date.now()
    state.lastError = null

    /**
     * CLEARED SYNCHRONOUSLY THE MOMENT THE BOX IS BACK ON MAIN, and only
     * refreshed in the background while it is not.
     *
     * The clearing half has to be immediate. `refUpdate` names a branch, and a
     * reading left behind after a revert would put "2 commits behind dev" in
     * the header of a console whose server is running main — a sentence that is
     * both false and unreachable, since nothing would ever poll to correct it.
     *
     * `isParkedOffMain`, NOT `!isOnMain`, and lib/ssh states the rule: a host
     * too old to report its ref folds in with main here, because everything
     * this value feeds is something a human READS. Gate the automation
     * pessimistically; gate the decoration on a stated fact.
     */
    const parked = isParkedOffMain(status)

    /**
     * The clearing half, and it stays synchronous and unconditional. Whatever
     * the gate below decides, a `refUpdate` naming `dev` must not survive one
     * tick of a box that is back on main: `pollDeployedRef` is async and its
     * answer lands whenever it lands, so waiting for it to overwrite this would
     * leave the old branch's count readable in the meantime.
     */
    if (!parked) state.refUpdate = null

    /**
     * WHEN THE `branches` VERB IS WORTH ITS COST, WHICH IS NOT ALWAYS.
     *
     * Parked, always: the count against the branch somebody is pushing to has
     * no other source, and discovering a push rather than merely making it
     * discoverable is the requirement REF_POLL_MS exists to pay for.
     *
     * ON MAIN, ONLY WHILE THERE IS AN UPDATE OUTSTANDING — `behindMain > 0`,
     * which the fifteen-second `status` poll already answers for free. This is
     * the one new cost in the change that replaced the commit count with the
     * two commits, and it is bounded on the side that matters: the steady state
     * of a healthy box is level with main, and a level box makes NO extra call
     * at all. When it is behind, one `git fetch --prune` every two minutes buys
     * the sha of the commit the operator is being asked to deploy — which is
     * precisely the window in which somebody is looking at the banner.
     *
     * WHY NOT ALWAYS, given the box already fetches main on its own: because
     * `branches` is the only read in this console that costs a real network
     * round trip from the game box to GitHub, and putting an unconditional
     * timer on it would spend that on every console that has ever been opened,
     * forever, to learn a sha nothing would render.
     */
    if (parked || status.behindMain > 0) {
      void pollDeployedRef(status)
    } else {
      state.updateTarget = null
      state.refKey = ''
      state.refPolledAt = 0
    }

    const prev = state.samples[state.samples.length - 1]
    state.samples.push({ ...tel, ...rateBetween(prev, tel) })
    if (state.samples.length > WINDOW) {
      state.samples.splice(0, state.samples.length - WINDOW)
    }
  } catch (e) {
    // A failed poll ages the data rather than clearing it — a graph that
    // blanks on one dropped SSH round trip is worse than one that holds its
    // last shape and says how old it is.
    state.lastError = e instanceof Error ? e.message : String(e)
  }
}

/** Start the poll timer once. Idempotent; safe to call from any request. */
export function ensurePolling(): void {
  if (state.timer || !sshConfigured()) return
  state.polling = true
  void poll()
  state.timer = setInterval(() => void poll(), POLL_MS)
}

export function hostView() {
  return {
    configured: sshConfigured(),
    status: state.status,
    statusAgeMs: state.statusAt ? Date.now() - state.statusAt : null,
    samples: state.samples,
    lastError: state.lastError,
    /**
     * SERVED FROM MEMORY LIKE EVERYTHING ELSE HERE. Reading this costs a local
     * function call, not an SSH round trip, so a page may poll it as freely as
     * it polls the rest of this object — which is the whole reason the `branches`
     * call that produces it lives on the server timer rather than in a route.
     */
    refUpdate: state.refUpdate,
    /**
     * The two commits an update would move between. Same provenance as
     * `refUpdate` — same call, same beat — and the same cost to read here,
     * which is none.
     */
    updateTarget: state.updateTarget,
  }
}
