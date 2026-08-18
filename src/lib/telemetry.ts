import {
  isParkedOffMain,
  listBranches,
  refUpdateFrom,
  runVerb,
  sshConfigured,
  type HostStatus,
  type HostTelemetry,
  type RefUpdate,
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
const REF_POLL_MS = 120_000

function create(): TelState {
  return {
    status: null,
    statusAt: 0,
    samples: [],
    lastError: null,
    polling: false,
    timer: null,
    refUpdate: null,
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
 */
async function pollDeployedRef(status: HostStatus): Promise<void> {
  if (state.refBusy) return

  const key = `${status.deployedRef ?? ''}@${status.sha ?? ''}`
  const now = Date.now()
  if (key === state.refKey && now - state.refPolledAt < REF_POLL_MS) return

  state.refKey = key
  state.refPolledAt = now
  state.refBusy = true
  try {
    state.refUpdate = refUpdateFrom(await listBranches())
  } catch {
    /* keep the last reading; a dropped fetch is not a branch that moved */
  } finally {
    state.refBusy = false
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
    if (isParkedOffMain(status)) {
      void pollDeployedRef(status)
    } else {
      state.refUpdate = null
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
  }
}
