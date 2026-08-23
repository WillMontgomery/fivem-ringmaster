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
  /**
   * Everyone this console has seen since it started, keyed by license.
   *
   * WHY IT EXISTS: search could only ever find players who were connected at
   * that exact moment, because the live snapshot was the only source. Looking
   * somebody up half an hour after they logged off — which is the ordinary
   * reason to look somebody up — returned nothing, with no way to say why.
   *
   * IN MEMORY, AND HONEST ABOUT IT. Lost on a console restart. The durable
   * record is the player_seen stream landing in DynamoDB (M7b); until then this
   * covers the session, and the empty state says exactly that.
   */
  directory: Map<string, DirectoryEntry>
  /** Counters, so `is it working` has an answer that is not a shrug. */
  stats: {
    snapshots: number
    snapshotsStale: number
    eventsApplied: number
    eventsDuplicate: number
  }
}

/** One player the console has seen, whether or not they are on right now. */
export interface DirectoryEntry {
  license: string
  name: string
  firstSeen: number
  lastSeen: number
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
    directory: new Map(),
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

  // Everyone on the server right now is somebody search should be able to find
  // later. Snapshots are the reliable source: a player_seen event only fires
  // the first time the GAME meets a license, so a console that started
  // afterwards would never hear about anybody already playing.
  for (const p of env.snapshot.players) {
    remember(p.license, p.name, now)
  }

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
/**
 * Remember a player, wherever we learned about them.
 *
 * Called from both sources deliberately: `player_seen` events announce a
 * license the first time this server process meets it, and snapshots carry
 * everyone currently on. Neither alone is complete — events are missed if the
 * console was down, and snapshots forget the moment somebody leaves.
 */
function remember(license: string | null | undefined, name: string, now: number) {
  if (!license) return
  const existing = state.directory.get(license)
  if (existing) {
    existing.name = name || existing.name
    existing.lastSeen = now
    return
  }
  state.directory.set(license, {
    license,
    name: name || 'Unknown',
    firstSeen: now,
    lastSeen: now,
  })
}

/**
 * Search everyone this console has seen, by name or identifier.
 *
 * MATCHES ON BOTH because the two realistic starting points are a name
 * somebody typed in Discord and a license pasted from a report, and an admin
 * should not have to know which box to use.
 */
export function searchDirectory(query: string, limit = 10): DirectoryEntry[] {
  const q = query.trim().toLowerCase()
  const online = new Set(
    (state.snapshot?.snapshot.players ?? []).map((p) => p.license).filter(Boolean),
  )

  const rows = [...state.directory.values()].filter(
    (e) =>
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.license.toLowerCase().includes(q),
  )

  // Online first, then most recently seen. Someone on the server right now is
  // almost always the one being looked for.
  rows.sort((a, b) => {
    const ao = online.has(a.license) ? 1 : 0
    const bo = online.has(b.license) ? 1 : 0
    if (ao !== bo) return bo - ao
    return b.lastSeen - a.lastSeen
  })

  return rows.slice(0, limit)
}

/** Is this license connected right now? For labelling search results. */
export function isOnline(license: string): boolean {
  return (state.snapshot?.snapshot.players ?? []).some((p) => p.license === license)
}

/** One connected player, reduced to what a search result needs. */
export interface OnlinePlayer {
  license: string
  name: string
}

/**
 * Everyone the latest snapshot says is connected.
 *
 * THE SEARCH HAD NO WAY TO ASK THIS, and that is the whole of #18's second
 * half. `searchDirectory` reads the session directory and `players.search`
 * reads the durable registry; both are records of people who have *been* here,
 * and neither has any notion of who is here now. The palette headed a list of
 * them "Online now" and was wrong whenever anybody had ever logged off.
 *
 * READS THE SAME OBJECT THE LIVE PLAYERS PAGE RENDERS FROM — `state.snapshot`,
 * the last envelope the game pushed — so the two pages cannot disagree about
 * who is on. If this list is empty, so is that page, and the cause is the feed,
 * not the search.
 *
 * A player with no license yet (mid-handshake) is skipped: there is nothing to
 * link a search result to, and inventing a key here is how the wrong profile
 * gets opened.
 */
export function onlinePlayers(): OnlinePlayer[] {
  const rows: OnlinePlayer[] = []
  for (const p of state.snapshot?.snapshot.players ?? []) {
    if (!p.license) continue
    rows.push({ license: p.license, name: p.name || 'Unknown' })
  }
  return rows
}

export function applyEvents(env: EventsEnvelope, now: number): number {
  let applied = 0

  for (const ev of env.events) {
    const key = `${env.server.bootEpoch}:${ev.seq}`

    if (state.seen.has(key)) {
      state.stats.eventsDuplicate++
      continue
    }
    state.seen.add(key)

    // player_seen is how a license first becomes known to this console.
    if (ev.kind === 'player_seen') {
      const p = ev.data as { license?: string; name?: string }
      remember(p.license, p.name ?? 'Unknown', now)
    }

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
/**
 * The last DynamoDB probe the game reported, dated against real time.
 *
 * ═══ WHY IT IS ITS OWN ACCESSOR AND NOT A FIELD ON `liveView` ═══
 *
 * Its reader is the HOST page, which polls `/api/host` and never touches
 * `/api/state`. Hanging it off `liveView` would put a fact the Host page needs
 * behind a second poll of a payload carrying up to 2048 player rows, purely
 * because of where it happened to arrive. `hostView()` calls this instead, so
 * the Host page gets both br_ddb facts from the one request it already makes.
 *
 * IT CONVERTS THE CLOCK HERE, and this is the only place that can. `at` is a
 * `GetGameTimer()` reading and is meaningless without the `wallMs`/`gameMs`
 * pair sampled in the SAME envelope. Handing the raw value upwards would invite
 * a caller to date it against "the latest clock" from somewhere else, which
 * mis-dates it by exactly one server restart.
 *
 * NULL COVERS EVERY ABSENCE and the caller must not distinguish them: no
 * snapshot yet, a game build that predates the block, br_ddb not started. All
 * three are "we have not been told", which `reachNow` renders as silence.
 */
export function ddbProbe(): {
  probe: NonNullable<SnapshotEnvelope['snapshot']['ddb']>
  atMs: number
} | null {
  const snap = state.snapshot
  const ddb = snap?.snapshot.ddb
  if (!snap || !ddb) return null
  return { probe: ddb, atMs: realTime(snap.server, ddb.at) }
}

export function liveView(now: number) {
  const snap = state.snapshot

  return {
    online: snap !== null,
    ageMs: snap ? now - state.receivedAt : null,

    /**
     * When the last push landed, as an absolute timestamp.
     *
     * `ageMs` is computed against whatever `now` the caller passed, which
     * freezes the moment it is server-rendered. Handing out the origin instead
     * lets a client component tick the age continuously — the same reasoning
     * as `connectedAt` being a clock reading rather than a duration.
     */
    lastPushAt: snap ? state.receivedAt : null,

    bootEpoch: snap?.server.bootEpoch ?? null,
    counts: snap?.snapshot.counts ?? { connected: 0, inMatch: 0 },
    truncated: snap?.snapshot.truncated ?? false,
    matches: snap?.snapshot.matches ?? [],
    players: snap?.snapshot.players ?? [],

    /**
     * The anticheat settings the game last reported.
     *
     * Null when br_core is not loaded or the game predates sending it. The
     * Anticheat page shows "unknown" rather than a threshold it would then
     * display as fact.
     */
    anticheat: snap?.snapshot.anticheat ?? null,

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
