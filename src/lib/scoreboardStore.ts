import { ddb, tables } from './dynamo'
import { LICENSE_PREFIX, type BoardRow } from './scoreboard'

/**
 * Where the warmup board's numbers come from, and how often (#247).
 *
 * ═══ THE READ IS A SCAN, AND THIS IS THE HONEST ACCOUNT OF IT ═══
 *
 * `br-players` is partitioned on the player's qualified license, so it can
 * answer "everything about this one player" in a `GetItem` and cannot answer
 * "the ten highest anything" at all. There is no index over `wins`, over `xp` or
 * over `sk`, and this console does not own that table: it is the game's, written
 * by `br_ddb` on the game box, and Ringmaster reads it and never writes it.
 * Adding a secondary index to somebody else's table from here would be a change
 * to their deploy made by a console.
 *
 * So a leaderboard costs a full table scan, filtered to `sk = 'profile'`. A
 * `FilterExpression` is applied AFTER the read, so it reduces the bytes returned
 * and not the capacity consumed: the scan pays for every match-history row in
 * the table as well as every profile, and since #153 the history rows outnumber
 * the profiles and keep growing. That is the real cost and it is why almost
 * everything else in this file is about not paying it very often.
 *
 * ═══ WHAT THE FIX WOULD BE, WRITTEN DOWN RATHER THAN DONE ═══
 *
 * A global secondary index partitioned on `sk` would turn this into a Query over
 * the profile rows alone, which is the shape the read model wants and roughly a
 * hundredth of the work. It belongs in the game repository's table definition,
 * it costs a write unit per profile update, and it is a decision somebody makes
 * on purpose. `docs/aws-setup.md` already refuses to widen an IAM policy quietly
 * to match today's code, for the same reason, and this note is deliberately the
 * same shape: the code says what it needs, and a human decides.
 *
 * IT ALSO NEEDS A PERMISSION THIS BOX MAY NOT HAVE. `dynamodb:Scan` on
 * `br-players` is not in `RingmasterTableAccess` as that document prints it, and
 * neither is the `GetItem` the profile page has been doing for weeks. See the
 * flag at the end of section 2 there; the symptom is `AccessDeniedException` in
 * `journalctl -u ringmaster` and a board that answers 503 while every other page
 * works.
 *
 * ═══ SO IT IS BUILT ONCE PER TTL, FOR THE WHOLE PROCESS ═══
 *
 * A full field of players fetches this page inside a few seconds at the top of
 * every warmup. One scan serves all of them, and the one after that is a minute
 * away. `lib/incidents.ts` already caches its open count for fifteen seconds
 * against exactly this shape of stampede and says so; this is the same move
 * against a much more expensive read.
 */

/**
 * How long a built board is served before it is refreshed.
 *
 * SIXTY SECONDS, AND THE NUMBER IS SET BY WHAT IT MEASURES RATHER THAN BY TASTE.
 * Every quantity on this board is a career total, and career totals move exactly
 * once per player per match, at match end, from a write on the game box. A match
 * takes minutes. So a minute of staleness cannot show anybody a number that is
 * wrong by more than one match, and the board is being looked at during warmup,
 * which is the part of the cycle when nothing is being added to it at all.
 *
 * IT IS A REFRESH THRESHOLD, NOT AN EXPIRY. See `snapshotFrom`: a board older
 * than this is still served, and the refresh happens behind the request rather
 * than in front of it.
 */
export const SNAPSHOT_TTL_MS = 60_000

/**
 * How many 1 MB scan pages one build will walk before giving up.
 *
 * ═══ EXHAUSTING THIS IS A FAILURE, NOT A TRUNCATION ═══
 *
 * The tempting behavior is to stop at the budget and rank what came back. That
 * would produce a leaderboard of the players who happened to be in the first
 * forty megabytes of an unordered scan, presented as the best in the game, with
 * nothing on screen or in the log to say otherwise. It would be wrong in a way
 * nobody could ever notice from the outside, which is the exact failure mode
 * this repository keeps shipping.
 *
 * So a build that runs out of budget fails, loudly, and the board falls back to
 * the last good snapshot or to no board at all. A wall showing static is a
 * visible problem that gets fixed; a plausible wrong ranking is not.
 *
 * FORTY PAGES IS FOUR HUNDRED TIMES TODAY'S TABLE and is a tripwire for the
 * growth curve described above, not a working limit.
 */
export const MAX_SCAN_PAGES = 40

/**
 * Every attribute the board reads, aliased.
 *
 * ALL OF THEM ARE ALIASED, INCLUDING THE ONES THAT DO NOT HAVE TO BE. DynamoDB's
 * reserved-word list has several hundred entries, `name` is on it, and a
 * projection that names an attribute directly fails at request time with a
 * syntax error rather than at review time. Aliasing selectively means knowing the
 * list; aliasing everything means not needing to.
 */
const ATTRS = {
  '#pk': 'pk',
  '#nm': 'name',
  '#wins': 'wins',
  '#kills': 'kills',
  '#matches': 'matches',
  '#revives': 'revives',
  '#xp': 'xp',
  /**
   * ═══ PROJECTED, AND IT IS NOT ON THE PROFILE ROW YET ═══
   *
   * `voltsSpent` landed in the gamemode in `03cce2d` (#293) on the roster entry,
   * the results row, the history row and br_ddb's `HISTORY_NUMBERS`. It did NOT
   * land on `STATS_ADDS`, which is the allowlist for the atomic ADD onto
   * `{sk: 'profile'}`, so the rows this scan reads carry no such attribute and
   * every `BoardRow.voltsSpent` is zero.
   *
   * ASKING FOR AN ABSENT ATTRIBUTE IS FREE. DynamoDB returns nothing for it; it
   * does not error and it does not cost capacity. Naming it here means the day
   * the gamemode adds it to `STATS_ADDS`, the board starts reading real numbers
   * with no change on this side - and `lib/scoreboard.ts`'s `spend` category is
   * one `available: true` away from being a card.
   *
   * DAMAGE AND PLAY TIME USED TO BE ON THIS LIST AND ARE NOT ANY MORE. The owner
   * removed both from the board by name, so the board stops asking for them: a
   * projection is the cheapest place to stop reading something.
   */
  '#spent': 'voltsSpent',
} as const

const PROJECTION = Object.keys(ATTRS).join(', ')

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * A raw item as one board row.
 *
 * FIELD BY FIELD, NOT A CAST, for the reason `lib/gameProfile.ts` gives about
 * the same table: these rows are written by a different repository on a
 * different box, and an attribute that arrives missing, renamed or as a string
 * should cost that attribute rather than throw inside a response somebody's game
 * client is waiting on.
 */
function toRow(item: Record<string, unknown>): BoardRow {
  return {
    license: typeof item.pk === 'string' ? item.pk : '',
    name: typeof item.name === 'string' ? item.name : '',
    wins: num(item.wins),
    kills: num(item.kills),
    matches: num(item.matches),
    revives: num(item.revives),
    xp: num(item.xp),
    voltsSpent: num(item.voltsSpent),
  }
}

/**
 * What a build needs from the world, named rather than imported.
 *
 * THE SEAM IS HERE SO THE CHECK CAN DRIVE THE REAL CACHE, which is the same
 * arrangement `LicenseLookup` in lib/grants.ts and `GateDeps` in
 * lib/discordRole.ts already use. The single-flight and the refresh threshold are
 * the parts most likely to be quietly broken by an edit, and they are only
 * testable if the reads underneath them can be counted.
 */
export interface BoardSources {
  /** Every `sk = 'profile'` row, or a rejection. */
  scanProfiles(): Promise<BoardRow[]>
  /** Qualified licenses of everybody holding an admin link row. */
  adminLicenses(): Promise<string[]>
  now(): number
  log(level: 'warn' | 'error', message: string): void
}

/**
 * One built board, with the moment it was built.
 *
 * `admins` IS ALWAYS POPULATED WHEN THE FLAG IS ON AND ALWAYS EMPTY WHEN IT IS
 * OFF, rather than being collected always and applied conditionally. The owner's
 * words were "we definitely shouldn't query Discord every time", and while this
 * reads DynamoDB rather than Discord, the same instinct applies to a table nobody
 * asked us to read: with the flag off there is no admin question, so there is no
 * admin read.
 */
export interface Snapshot {
  rows: BoardRow[]
  admins: ReadonlySet<string>
  at: number
}

export interface SnapshotCache {
  held: Snapshot | null
  inFlight: Promise<Snapshot | null> | null
  /** True once a failure has been logged, cleared by the next success. */
  failing: boolean
}

export function newSnapshotCache(): SnapshotCache {
  return { held: null, inFlight: null, failing: false }
}

/** The one cache the live route uses. */
const liveCache = newSnapshotCache()

async function build(
  options: { hideAdmins: boolean },
  deps: BoardSources,
  alreadyLogged: boolean,
): Promise<Snapshot | null> {
  try {
    /**
     * SEQUENTIAL, NOT `Promise.all`, AND ONLY BECAUSE OF THE `if`. With the flag
     * off the second read does not happen at all; with it on, the grants table is
     * a handful of rows and the scan beside it is the entire cost of this
     * function, so overlapping them saves nothing worth the branch.
     */
    const rows = await deps.scanProfiles()
    const admins = options.hideAdmins
      ? new Set(await deps.adminLicenses())
      : new Set<string>()

    return { rows, admins, at: deps.now() }
  } catch (e) {
    /**
     * ON THE TRANSITION, NOT ON THE TICK. This is polled by every client in the
     * lobby; logging each failure would put a full field's worth of identical
     * lines in the journal per warmup, in the journal somebody would be reading
     * to find out why. `lib/telemetry` logs poll failures the same way and says
     * why.
     */
    if (!alreadyLogged) {
      deps.log(
        'error',
        `[scoreboard] could not build the leaderboard: ${
          e instanceof Error ? e.message : String(e)
        }. The warmup board will serve its last good copy, or nothing.`,
      )
    }
    return null
  }
}

/**
 * The cached board, refreshed behind the request rather than in front of it.
 *
 * ═══ WHY STALE IS SERVED WHILE FRESH IS FETCHED ═══
 *
 * The naive cache blocks whoever arrives first after the TTL lapses on a full
 * table scan. On this route that is a player standing in front of a prop at the
 * top of a warmup, and the wait would land on a different player every minute
 * forever. Serving what is held and refreshing behind it means exactly one
 * request in the life of the process ever waits for a scan: the first.
 *
 * ═══ AND WHY ONE REFRESH AT A TIME ═══
 *
 * Without the in-flight guard, the moment the threshold lapses every request
 * that arrives starts its own scan of the same table, which is a self-inflicted
 * stampede at precisely the busiest instant. `lib/incidents.ts` makes the same
 * argument about its open-count recount, on a read costing a fraction of this
 * one.
 *
 * A FAILED REFRESH KEEPS THE PREVIOUS SNAPSHOT. A scan that times out or is
 * denied does not empty the wall; the numbers go stale, which is visible to
 * nobody, rather than absent, which is visible to everybody.
 *
 * RETURNS NULL ONLY WHEN THERE HAS NEVER BEEN A SNAPSHOT. The route turns that
 * into a 503 and the client shows static, which is the outage behavior the owner
 * asked for.
 */
export async function snapshotFrom(
  cache: SnapshotCache,
  options: { hideAdmins: boolean },
  deps: BoardSources,
): Promise<Snapshot | null> {
  const fresh =
    cache.held !== null && deps.now() - cache.held.at < SNAPSHOT_TTL_MS
  if (fresh) return cache.held

  if (cache.inFlight === null) {
    cache.inFlight = build(options, deps, cache.failing)
      .then((snapshot) => {
        if (snapshot) {
          cache.held = snapshot
          cache.failing = false
        } else {
          cache.failing = true
        }
        return snapshot
      })
      .finally(() => {
        cache.inFlight = null
      })
  }

  /**
   * ONLY THE COLD START AWAITS. Everybody else takes what is held, however old
   * it is, and the refresh they triggered lands for whoever asks next.
   */
  if (cache.held !== null) return cache.held
  return cache.inFlight
}

/** The live reads. */
export const liveSources: BoardSources = {
  async scanProfiles(): Promise<BoardRow[]> {
    const rows: BoardRow[] = []
    let startKey: Record<string, unknown> | undefined
    let pages = 0

    do {
      const res = await ddb.scan({
        TableName: tables.gamePlayers,
        /**
         * APPLIED AFTER THE READ, so it saves bandwidth and not capacity. It is
         * still worth having: without it every `match#...` row in the table
         * would be marshalled, transferred and discarded here instead of at the
         * service, and there are far more of those than there are profiles.
         */
        FilterExpression: '#sk = :profile',
        ProjectionExpression: PROJECTION,
        ExpressionAttributeNames: { ...ATTRS, '#sk': 'sk' },
        ExpressionAttributeValues: { ':profile': 'profile' },
        ExclusiveStartKey: startKey,
      })

      for (const item of (res.Items ?? []) as Record<string, unknown>[]) {
        rows.push(toRow(item))
      }

      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined
      pages++

      if (startKey && pages >= MAX_SCAN_PAGES) {
        /**
         * THROWN RATHER THAN RETURNED SHORT. See MAX_SCAN_PAGES: a partial
         * ranking presented as a complete one is the failure this budget exists
         * to prevent, so running out of budget has to be indistinguishable from
         * the read failing.
         */
        throw new Error(
          `the profile scan did not finish inside ${MAX_SCAN_PAGES} pages ` +
            `(${rows.length} profile rows so far). br-players has outgrown a ` +
            `scan; it needs an index partitioned on sk. See lib/scoreboardStore.`,
        )
      }
    } while (startKey)

    return rows
  },

  /**
   * ═══ THE ONLY DURABLE RECORD OF WHO IS AN ADMIN, AND IT IS INCOMPLETE ═══
   *
   * There is no cache of Discord role membership anywhere in this console and
   * there never has been: `lib/discordRole.ts` asks Discord live before every
   * write and states, at length, that a TTL there would be a window in which a
   * removed admin still works. That is the right call for a permission gate and
   * it leaves this feature with nothing to read.
   *
   * What does exist is `ringmaster-grants`: the hand-written Discord-to-license
   * link rows, created with `scripts/grant.mjs`. `lib/grants.ts` is explicit
   * that this is NOT a permission record, and it is not being used as one here
   * either. It is being used as the only durable answer to a different question
   * that happens to overlap: which licenses belong to people who administer this
   * server.
   *
   * SO "BEST EFFORT" HAS A PRECISE MEANING AND IT IS NOT ABOUT THE CACHE TTL.
   * The list misses any admin who was made one the new way, by being given the
   * Discord role and nothing else, because nothing writes them a row. It also
   * keeps anybody whose row was never removed after they stopped being an admin.
   * Both are corrected by hand, with `scripts/grant.mjs`, and neither is
   * corrected by waiting.
   */
  async adminLicenses(): Promise<string[]> {
    const licenses: string[] = []
    let startKey: Record<string, unknown> | undefined
    let pages = 0

    do {
      const res = await ddb.scan({
        TableName: tables.grants,
        ProjectionExpression: '#license',
        ExpressionAttributeNames: { '#license': 'license' },
        ExclusiveStartKey: startKey,
      })

      for (const item of (res.Items ?? []) as Record<string, unknown>[]) {
        const license = item.license
        // The qualified form is what the board's rows are keyed on. A row
        // carrying anything else cannot match one and is dropped rather than
        // being made to match by guessing at a prefix.
        if (typeof license === 'string' && license.startsWith(LICENSE_PREFIX)) {
          licenses.push(license)
        }
      }

      startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined
      pages++
    } while (startKey && pages < MAX_SCAN_PAGES)

    return licenses
  },

  now: () => Date.now(),
  log: (level, message) => {
    if (level === 'warn') console.warn(message)
    else console.error(message)
  },
}

/** The board, from the live cache and the live reads. */
export function boardSnapshot(options: {
  hideAdmins: boolean
}): Promise<Snapshot | null> {
  return snapshotFrom(liveCache, options, liveSources)
}

/**
 * One player's own career row.
 *
 * A `GetItem`, ONE PER PAGE LOAD, AND DELIBERATELY NOT CACHED. It is a single
 * partition read against a key the caller already validated, it happens once
 * when a client creates its DUI rather than on a timer, and a cache in front of
 * it would be a second staleness window on the one part of this page that is
 * about the person reading it.
 *
 * RETURNS NULL FOR A PLAYER WITH NO ROW, which is not an error: it is somebody
 * who has never finished a match. The page renders the leaderboard alone rather
 * than a panel of zeros, and nothing on screen says so, because a zero is a
 * claim and a sentence explaining the absence is copy nobody asked for.
 *
 * THROWS NOTHING. A failed read costs the per-player half; the board is already
 * built and the wall still has something true on it.
 */
export async function playerRowFor(license: string): Promise<BoardRow | null> {
  try {
    const res = await ddb.get({
      TableName: tables.gamePlayers,
      Key: { pk: license, sk: 'profile' },
      ProjectionExpression: PROJECTION,
      ExpressionAttributeNames: ATTRS,
    })
    const item = res.Item as Record<string, unknown> | undefined
    if (!item) return null

    // Keyed on what was actually asked for. `pk` comes back in the projection
    // and will agree, but the caller's normalized license is the value this row
    // is true of by construction rather than by the store having echoed it.
    return { ...toRow(item), license }
  } catch (e) {
    console.error('[scoreboard] player row read failed for', license, e)
    return null
  }
}
