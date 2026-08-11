import { runVerb, sshConfigured, type HostStatus, type HostTelemetry } from './ssh'

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
}

/** ~30 min at one sample per 15s. Enough to see a trend, cheap to hold. */
const WINDOW = 120
const POLL_MS = 15_000

function create(): TelState {
  return {
    status: null,
    statusAt: 0,
    samples: [],
    lastError: null,
    polling: false,
    timer: null,
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
  }
}
