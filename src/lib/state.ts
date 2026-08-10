import {
  realTime,
  type EventsEnvelope,
  type GameEvent,
  type SnapshotEnvelope,
} from './ingest'

/**
 * Live server state, in memory.
 *
 * THIS IS CORRECT FOR EXACTLY ONE INSTANCE, and that is worth reading before
 * anyone puts this behind a load balancer. The game host pushes to one
 * endpoint; two app instances would each hold half the pushes and each show a
 * confidently incomplete player list, with nothing anywhere saying so. If a
 * second instance is ever wanted, this moves to a shared store first.
 *
 * Deliberately not persisted. A snapshot is worthless two seconds after it was
 * taken, and the durable record of what happened is the event stream and
 * DynamoDB, not this. Losing all of it on restart costs one push interval.
 */

const globalForState = globalThis as unknown as { ringState?: LiveState }

interface LiveState {
  snapshot: SnapshotEnvelope | null
  /** When we received it, our clock — for staleness, which is what an operator actually asks. */
  receivedAt: number
  /** Ring buffer of recent events, newest last. */
  events: StoredEvent[]
  /** `${bootEpoch}:${seq}` of events already applied. */
  seen: Set<string>
  /** Counters, so `is it working` has an answer that is not a shrug. */
  stats: {
    snapshots: number
    snapshotsStale: number
    eventsApplied: number
    eventsDuplicate: number
  }
}

export interface StoredEvent extends GameEvent {
  /** The sending process, so events from before a restart stay distinguishable. */
  bootEpoch: string
  /** `at` converted through the envelope's clock pair. A real timestamp. */
  realMs: number
}

/** Recent events kept in memory. Beyond this, DynamoDB is the record. */
const EVENT_BUFFER = 500

/** Dedupe keys retained. Comfortably more than any plausible retry window. */
const SEEN_LIMIT = 5000

function create(): LiveState {
  return {
    snapshot: null,
    receivedAt: 0,
    events: [],
    seen: new Set(),
    stats: {
      snapshots: 0,
      snapshotsStale: 0,
      eventsApplied: 0,
      eventsDuplicate: 0,
    },
  }
}

/**
 * Next.js re-evaluates modules aggressively in development, which would
 * otherwise reset live state on every edit. Same escape hatch as the DynamoDB
 * client.
 */
export const state: LiveState = (globalForState.ringState ??= create())

/**
 * Apply a snapshot. Latest wins.
 *
 * Out-of-order arrivals are dropped rather than applied. Snapshots are never
 * retried, so this should not happen — but the network is still the network,
 * and applying a stale one would make the console show the past as the
 * present, which is the single worst failure this endpoint has.
 *
 * The comparison is per boot epoch on purpose: `takenGameMs` is milliseconds
 * since *server start*, so it goes backwards across a restart. Comparing
 * across epochs would reject everything after one.
 */
export function applySnapshot(env: SnapshotEnvelope, now: number): boolean {
  const prev = state.snapshot

  if (
    prev &&
    prev.server.bootEpoch === env.server.bootEpoch &&
    prev.snapshot.takenGameMs >= env.snapshot.takenGameMs
  ) {
    state.stats.snapshotsStale++
    return false
  }

  state.snapshot = env
  state.receivedAt = now
  state.stats.snapshots++
  return true
}

/**
 * Apply an event batch, skipping anything already seen.
 *
 * Deduped on `(bootEpoch, seq)` rather than `seq` alone. The outbox restarts
 * its counter at 0 on every resource start and the game host restarts
 * resources after every deploy, so `seq` alone would throw away the first N
 * events after each one.
 *
 * @returns how many were new
 */
export function applyEvents(env: EventsEnvelope, now: number): number {
  let applied = 0

  for (const ev of env.events) {
    const key = `${env.server.bootEpoch}:${ev.seq}`

    if (state.seen.has(key)) {
      state.stats.eventsDuplicate++
      continue
    }
    state.seen.add(key)

    state.events.push({
      ...ev,
      bootEpoch: env.server.bootEpoch,
      realMs: realTime(env.server, ev.at),
    })
    applied++
  }

  state.stats.eventsApplied += applied

  // Trim oldest first. Bounded because an endpoint nobody reads for a week
  // must not become the reason the box runs out of memory.
  if (state.events.length > EVENT_BUFFER) {
    state.events.splice(0, state.events.length - EVENT_BUFFER)
  }
  if (state.seen.size > SEEN_LIMIT) {
    const drop = state.seen.size - SEEN_LIMIT
    let i = 0
    for (const k of state.seen) {
      if (i++ >= drop) break
      state.seen.delete(k)
    }
  }

  void now
  return applied
}

/**
 * What the dashboard reads.
 *
 * `ageMs` rather than a timestamp, because the question an operator has is
 * "is this current", and a raw time makes them do the subtraction. A console
 * showing a five-minute-old player list as though it were live is worse than
 * one showing nothing.
 */
export function liveView(now: number) {
  const snap = state.snapshot

  return {
    online: snap !== null,
    ageMs: snap ? now - state.receivedAt : null,
    bootEpoch: snap?.server.bootEpoch ?? null,
    counts: snap?.snapshot.counts ?? { connected: 0, inMatch: 0 },
    truncated: snap?.snapshot.truncated ?? false,
    matches: snap?.snapshot.matches ?? [],
    players: snap?.snapshot.players ?? [],

    /**
     * The clock pair from the snapshot that produced these rows.
     *
     * Travels with the data rather than being read separately, because every
     * per-player `connectedAt` is on the game clock and only convertible
     * against the pair sampled alongside it. Pulling "the latest clock" from
     * somewhere else would silently mis-date rows from an older snapshot.
     */
    snapshotClock: {
      wallMs: snap?.server.wallMs ?? 0,
      gameMs: snap?.server.gameMs ?? 0,
    },

    stats: state.stats,
  }
}
