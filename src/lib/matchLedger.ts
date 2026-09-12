import { ddb, tables } from './dynamo'
import { matchTag } from './matchTag'

/**
 * One finished match, assembled from the per-player rows the game wrote (#51).
 *
 * ═══ WHAT "GIVE ME ONE MATCH" COSTS, WHICH #51 ASKED TO BE ESTABLISHED FIRST ═══
 *
 * It costs a FULL TABLE SCAN of `br-players`, and there is no cheaper shape
 * available from this side. The reason is the key:
 *
 *   pk = the player's qualified license
 *   sk = `match#<endedAt>#<matchId>`
 *
 * The rows for one match are one row per participant, each in a DIFFERENT
 * partition. The match id is the trailing uniqueness component of a sort key,
 * not something addressable: knowing it (and even knowing `endedAt` exactly)
 * still leaves the partition keys unknown, and a partition key is the one thing
 * a Query cannot go without. There is no secondary index on that table — the
 * only GSIs in this estate are `GSI1` on the auth adapter's table and
 * `discordId-index` on `ringmaster-grants` — and `br-players` is the GAME's
 * table, written by `br_ddb` on the game box. Ringmaster reads it and never
 * writes it, so adding an index to it from here would be a change to somebody
 * else's deploy made by a console.
 *
 * So: Scan, with a `FilterExpression` on `matchId`. A filter is applied AFTER
 * the read, so it reduces the bytes returned and NOT the capacity consumed —
 * this pays for every profile row and every other match's history rows in the
 * table. `lib/scoreboardStore.ts` pays exactly this scan for the warmup board
 * and states the same accounting; this is the same read with a different filter.
 *
 * ═══ WHY THAT IS NEVERTHELESS ACCEPTABLE HERE, AND WHERE IT STOPS BEING ═══
 *
 * The board scan runs on a timer whether anybody looks or not. This one runs
 * when a moderator deliberately opens one match, which is rare and deliberate,
 * and — the part that makes it cheap in practice — A MATCH'S ROWS NEVER CHANGE
 * ONCE WRITTEN. They are written once, at match end, and never updated. So the
 * result is cached for the life of the process with no TTL to reason about, and
 * the second person to open the same case pays nothing.
 *
 * IT STOPS BEING ACCEPTABLE AT THE SAME PLACE THE BOARD DOES, and the fix is the
 * same fix: an index over `sk` (or over `matchId`) in the GAME repository's table
 * definition turns this into a Query. That is a decision somebody makes on
 * purpose, in that repo, and this file states what it needs rather than reaching
 * for it — the same shape `docs/aws-setup.md` uses when it refuses to widen an
 * IAM policy quietly to match today's code.
 *
 * IT ALSO NEEDS A PERMISSION THIS BOX MAY NOT HAVE. `dynamodb:Scan` on
 * `br-players` is not in `RingmasterTableAccess` as `docs/aws-setup.md` prints
 * it, and neither is the `GetItem` the profile page has been doing for weeks.
 * See the flag at the end of section 2 there. The symptom is an
 * `AccessDeniedException` in `journalctl -u ringmaster` and this page reporting
 * that it could not read, while every other page works. That is why
 * {@link matchLedgerFor} distinguishes "read failed" from "no such match" and
 * never collapses the two: one is a broken console and the other is a bad URL.
 *
 * ═══ THE NAMES DO NOT COME FROM THESE ROWS, BECAUSE THEY ARE NOT ON THEM ═══
 *
 * `historyRowFor` in `br_stats/server/persist.lua` writes the license and no
 * name. So a page listing participants would list licenses, which is not a list
 * of people. The names come from `ringmaster-players` — this console's OWN
 * registry, keyed on license, one `BatchGetItem` for the whole field — and a
 * license the registry has never seen keeps a null name rather than being
 * rendered as a license dressed up as a person.
 */

/**
 * How many 1 MB scan pages one lookup will walk before giving up.
 *
 * EXHAUSTING THIS IS A FAILURE, NOT A TRUNCATION, exactly as in
 * `lib/scoreboardStore.ts`. Stopping at the budget and rendering what came back
 * would produce a match page missing an unknown number of participants, with a
 * squad grouping that silently omits whole squads, presented as the match. On a
 * page somebody bans people from. So running out of budget is indistinguishable
 * from the read failing, and the page says it could not read.
 */
export const MAX_SCAN_PAGES = 40

/** The sort-key prefix that separates history rows from `profile` and `purchases`. */
const MATCH_PREFIX = 'match#'

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * A number that is only a number if the attribute is actually there.
 *
 * ═══ THE ONE DISTINCTION THIS WHOLE FILE TURNS ON ═══
 *
 * #51: "None of it backfills... The page must not render a missing value as a
 * real one; a zero is a claim." And #293: "Every match already played will show
 * zero spent, no squad grouping, and no start time."
 *
 * The distinction is available, and it is available because of how br_ddb writes.
 * `voltsSpent` and `startedAt` are on its `HISTORY_NUMBERS` allowlist, so on
 * every row written since `03cce2d` the attribute EXISTS — 0 when the player
 * genuinely spent nothing. On every row written before it, the attribute is
 * ABSENT. `undefined` and `0` therefore mean different things, and `num()` above
 * would flatten exactly the difference the owner will be reading the page for.
 */
const optNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** One player's part in the match. */
export interface MatchParticipant {
  /** The qualified license. The partition key of the row this came from. */
  license: string
  /**
   * Their most recent in-game name, from this console's registry.
   *
   * NULL WHEN THE REGISTRY HAS NEVER SEEN THEM, which is ordinary: the registry
   * is written from the snapshot feed, so a player who played before the feed
   * existed has a history row and no registry row. The page renders the license
   * for them rather than inventing a name.
   */
  name: string | null
  /**
   * `m<match tag>sq<n>`, or null.
   *
   * NULL COVERS TWO DIFFERENT THINGS and the ledger's `squadsRecorded` is what
   * tells them apart: a solo match where there was no squad, and a pre-#293 row
   * where the grouping was dropped before the write. Per participant they look
   * identical, and per MATCH they do not.
   */
  squadId: string | null
  placement: number
  kills: number
  downs: number
  revives: number
  damage: number
  /** Time alive, not how long the match ran. */
  survivedMs: number
  xpEarned: number
  voltsEarned: number
  /** Null on a row written before #293. Zero means they spent nothing. */
  voltsSpent: number | null
  /** NOT `placement === 1` — the storm can take the last squad standing. */
  won: boolean
}

/** One match, as far as the rows can describe it. */
export interface MatchLedger {
  id: number
  /** The five hex characters the game console prints. */
  tag: string
  /** 'solo' | 'squad' as the game spells it. '' when unreadable. */
  mode: string
  /** Wall-clock ms. The leading component of every row's sort key. */
  endedAt: number
  /**
   * Wall-clock ms, or null when it was not recorded.
   *
   * NULL FOR TWO REASONS, both of them real: the row predates #293, or the match
   * dissolved on the warmup pad and never started, which `persist.lua` stores as
   * 0 and says in as many words is "the one value every reader already has to
   * treat as not recorded".
   */
  startedAt: number | null
  /** Field size, as the game counted it at match end. */
  total: number
  /** Every row found, ordered by placement. */
  participants: MatchParticipant[]
  /**
   * Whether this match's rows carry a squad grouping at all.
   *
   * FALSE IS NOT "IT WAS A SOLO MATCH". A solo match has no squads and
   * `mode === 'solo'` says so. This is false when the grouping is MISSING —
   * a squad match whose rows predate #293 — and the page must not draw one
   * undifferentiated group and let it read as "everybody played alone".
   */
  squadsRecorded: boolean
  /** Whether any row carries `voltsSpent`. False for every pre-#293 match. */
  spendRecorded: boolean
}

/**
 * Cached forever, on purpose, and keyed by match id.
 *
 * A MATCH'S ROWS ARE IMMUTABLE. They are written once when the match ends and
 * never updated, so there is no staleness to bound and no TTL to justify. The
 * only thing that could change is rows ARRIVING — a match that was still running
 * when somebody first opened the page — and that is why a lookup that found
 * nothing is deliberately NOT cached below.
 */
const globalForLedger = globalThis as unknown as {
  matchLedgers?: Map<number, MatchLedger>
}
const cache = (globalForLedger.matchLedgers ??= new Map<number, MatchLedger>())

/**
 * How many matches are held before the oldest is dropped.
 *
 * A BOUND SO A LONG-LIVED PROCESS CANNOT GROW WITHOUT LIMIT. A ledger is a few
 * kilobytes and moderation revisits the same handful of matches, so this is
 * generous; it exists so the map is not a leak, not to manage a working set.
 */
const MAX_CACHED = 64

export type MatchLookup =
  /** The match, as far as the rows describe it. */
  | { status: 'found'; ledger: MatchLedger }
  /**
   * The scan finished and no row carries this id.
   *
   * ORDINARY, AND NOT THE SAME AS A FAILURE. A match still running has no rows
   * yet; a match from before #153 was never recorded per player; and a tag
   * somebody mistyped names a match that has never existed. The page says the
   * same thing for all three because it cannot tell them apart, and what it must
   * not do is imply the console is broken.
   */
  | { status: 'none' }
  /**
   * The read did not complete. See the header: most likely `dynamodb:Scan` on
   * `br-players` not being granted, which is a console problem and not a
   * statement about the match.
   */
  | { status: 'unreadable' }

/**
 * Every row in `br-players` that belongs to this match.
 *
 * SEPARATED FROM THE ASSEMBLY BELOW so the expensive half is one function with
 * one job, and so the page's fixture harness can exercise the assembly without a
 * table. `ProjectionExpression` names every attribute the page reads and nothing
 * else; asking for an absent attribute is free, which is what lets `voltsSpent`
 * and `startedAt` be requested for rows that do not carry them.
 */
async function scanMatchRows(id: number): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let startKey: Record<string, unknown> | undefined
  let pages = 0

  do {
    const res = await ddb.scan({
      TableName: tables.gamePlayers,
      /**
       * BOTH CLAUSES ARE LOAD BEARING. `matchId` alone would match the `profile`
       * row of nobody (profiles carry no `matchId`) but WOULD match a future row
       * type that happened to carry one; `begins_with(sk, 'match#')` is what
       * says "a per-match history row" rather than "anything mentioning a match".
       * The pair is the same shape `gameMatchesFor` uses on the Query side.
       */
      FilterExpression: 'begins_with(#sk, :prefix) AND #mid = :id',
      /**
       * ALL OF THEM ALIASED, INCLUDING THE ONES THAT DO NOT HAVE TO BE — the
       * rule `lib/scoreboardStore.ts` states: DynamoDB's reserved-word list has
       * several hundred entries and a projection that names one directly fails at
       * REQUEST time rather than at review time. Aliasing selectively means
       * knowing the list.
       */
      ProjectionExpression: [
        '#pk',
        '#mid',
        '#endedAt',
        '#startedAt',
        '#mode',
        '#squadId',
        '#placement',
        '#total',
        '#kills',
        '#downs',
        '#revives',
        '#damage',
        '#survivedMs',
        '#xpEarned',
        '#voltsEarned',
        '#voltsSpent',
        '#won',
      ].join(', '),
      ExpressionAttributeNames: {
        '#sk': 'sk',
        '#pk': 'pk',
        '#mid': 'matchId',
        '#endedAt': 'endedAt',
        '#startedAt': 'startedAt',
        '#mode': 'mode',
        '#squadId': 'squadId',
        '#placement': 'placement',
        '#total': 'total',
        '#kills': 'kills',
        '#downs': 'downs',
        '#revives': 'revives',
        '#damage': 'damage',
        '#survivedMs': 'survivedMs',
        '#xpEarned': 'xpEarned',
        '#voltsEarned': 'voltsEarned',
        '#voltsSpent': 'voltsSpent',
        '#won': 'won',
      },
      ExpressionAttributeValues: { ':prefix': MATCH_PREFIX, ':id': id },
      ExclusiveStartKey: startKey,
    })

    for (const item of (res.Items ?? []) as Record<string, unknown>[]) {
      rows.push(item)
    }

    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined
    pages++

    if (startKey && pages >= MAX_SCAN_PAGES) {
      // THROWN RATHER THAN RETURNED SHORT. See MAX_SCAN_PAGES.
      throw new Error(
        `the match scan did not finish inside ${MAX_SCAN_PAGES} pages ` +
          `(${rows.length} rows for match ${matchTag(id)} so far). br-players ` +
          `has outgrown a scan; it needs an index. See lib/matchLedger.`,
      )
    }
  } while (startKey)

  return rows
}

/**
 * The names, from this console's own registry.
 *
 * ONE `BatchGetItem` FOR THE WHOLE FIELD — a match is at most a few dozen
 * players and the limit is 100 keys, so the chunking below is for correctness at
 * the boundary rather than because a real match reaches it.
 *
 * FAILS SOFT, AND THAT IS THE RIGHT DIRECTION HERE. A name is a convenience over
 * a license; a registry read that fails should cost the names and not the page,
 * because every figure on it is already in hand by the time this is called.
 */
async function namesFor(licenses: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const unique = [...new Set(licenses)].filter((l) => l !== '')

  for (let i = 0; i < unique.length; i += 100) {
    const keys = unique.slice(i, i + 100).map((license) => ({ license }))
    try {
      const res = await ddb.batchGet({
        RequestItems: {
          [tables.players]: {
            Keys: keys,
            ProjectionExpression: '#license, #nm, #pref',
            ExpressionAttributeNames: {
              '#license': 'license',
              '#nm': 'name',
              '#pref': 'preferredName',
            },
          },
        },
      })
      const items = (res.Responses?.[tables.players] ?? []) as Record<string, unknown>[]
      for (const item of items) {
        const license = item.license
        if (typeof license !== 'string') continue
        /**
         * THE PREFERRED NAME WINS WHERE THERE IS ONE, matching what the profile
         * page shows: it is the name the player set from the pause menu, and a
         * page that called them something else would be disagreeing with their
         * own profile.
         */
        const pref = item.preferredName
        const nm = item.name
        const chosen =
          typeof pref === 'string' && pref !== ''
            ? pref
            : typeof nm === 'string' && nm !== ''
              ? nm
              : null
        if (chosen !== null) names.set(license, chosen)
      }
    } catch (e) {
      console.error('[matchLedger] name lookup failed', e)
      // Keep whatever was resolved. The page renders licenses for the rest.
    }
  }

  return names
}

/**
 * Assemble a ledger from raw rows.
 *
 * EXPORTED SO IT CAN BE CHECKED WITHOUT A TABLE. Every judgement this file makes
 * about missing data lives here, and `matchLedger.check.ts` drives it directly
 * with the row shapes the game writes on both sides of `03cce2d`.
 *
 * RETURNS NULL FOR NO ROWS, which the caller reports as `none`.
 */
export function ledgerFrom(
  id: number,
  rows: Record<string, unknown>[],
  names: Map<string, string> = new Map(),
): MatchLedger | null {
  if (rows.length === 0) return null

  const tag = matchTag(id)
  // A ledger for an id with no tag cannot be addressed or titled. `matchFromTag`
  // on the route makes this unreachable; it is here so the type is honest.
  if (tag === null) return null

  const participants: MatchParticipant[] = rows.map((row) => {
    const squadRaw = row.squadId
    return {
      license: typeof row.pk === 'string' ? row.pk : '',
      name:
        typeof row.pk === 'string' ? (names.get(row.pk) ?? null) : null,
      // br_ddb writes `String(squadId ?? '')`, so the empty string is "no
      // squad" and is normalised to null here — one absent-shape downstream.
      squadId: typeof squadRaw === 'string' && squadRaw !== '' ? squadRaw : null,
      placement: num(row.placement),
      kills: num(row.kills),
      downs: num(row.downs),
      revives: num(row.revives),
      damage: num(row.damage),
      survivedMs: num(row.survivedMs),
      xpEarned: num(row.xpEarned),
      voltsEarned: num(row.voltsEarned),
      // `optNum`, not `num`. See its header: absent and zero are different
      // claims and this is the field the difference was asked about.
      voltsSpent: optNum(row.voltsSpent),
      won: row.won === true,
    }
  })

  /**
   * ORDERED BY PLACEMENT, WITH THE UNPLACED LAST.
   *
   * `placement` is 0 on a row that never got one, and sorting numerically would
   * put those FIRST — ahead of the winner — which reads as a result rather than
   * as a gap. Ties break on kills so the order is stable across renders rather
   * than depending on which partition the scan reached first.
   */
  participants.sort((a, b) => {
    const ap = a.placement > 0 ? a.placement : Number.MAX_SAFE_INTEGER
    const bp = b.placement > 0 ? b.placement : Number.MAX_SAFE_INTEGER
    if (ap !== bp) return ap - bp
    if (b.kills !== a.kills) return b.kills - a.kills
    return a.license.localeCompare(b.license)
  })

  /**
   * THE MATCH-LEVEL FIELDS COME FROM THE ROWS, WHICH ALL CARRY THEM.
   *
   * Every participant's row was written from one envelope in one loop with one
   * timestamp, so `endedAt`, `mode`, `total` and `startedAt` are the same on all
   * of them. Taking the MAXIMUM rather than the first is deliberate: it means a
   * single row that somehow arrived with a zero cannot decide the whole page,
   * and `persist.lua` already treats 0 as "not recorded" for `startedAt`.
   */
  const endedAt = Math.max(...rows.map((r) => num(r.endedAt)))
  const total = Math.max(...rows.map((r) => num(r.total)))
  const startedRaw = Math.max(...rows.map((r) => optNum(r.startedAt) ?? 0))
  const mode = rows.map((r) => (typeof r.mode === 'string' ? r.mode : '')).find((m) => m !== '') ?? ''

  return {
    id,
    tag,
    mode,
    endedAt,
    // 0 IS "NOT RECORDED", per persist.lua, and so is an absent attribute.
    startedAt: startedRaw > 0 ? startedRaw : null,
    total,
    participants,
    /**
     * RECORDED IF ANY ROW CARRIES ONE. A squad match written since #293 has a
     * squad id on every row; one written before has it on none. A solo match has
     * it on none either, which is why the page reads this TOGETHER with `mode`
     * rather than on its own.
     */
    squadsRecorded: participants.some((p) => p.squadId !== null),
    /**
     * RECORDED IF ANY ROW CARRIES THE ATTRIBUTE — not if any value is non-zero.
     * A match where everybody genuinely spent nothing still RECORDED the spend,
     * and showing those zeros is correct; a pre-#293 match recorded nothing and
     * showing zeros there would be the invention #51 forbids.
     */
    spendRecorded: participants.some((p) => p.voltsSpent !== null),
  }
}

/**
 * One match, by its id.
 *
 * THROWS NOTHING, like every other read in this estate: a page somebody is
 * moderating from must not 500 because a table is slow. The three outcomes are
 * in {@link MatchLookup} and the caller has to tell them apart.
 */
export async function matchLedgerFor(id: number): Promise<MatchLookup> {
  const held = cache.get(id)
  if (held) return { status: 'found', ledger: held }

  let rows: Record<string, unknown>[]
  try {
    rows = await scanMatchRows(id)
  } catch (e) {
    console.error('[matchLedger] scan failed for match', matchTag(id), e)
    return { status: 'unreadable' }
  }

  /**
   * NOT CACHED, deliberately. A match that is still running has no rows yet, and
   * caching that answer for the life of the process would leave the page empty
   * for the rest of the day after somebody opened it a minute early.
   */
  if (rows.length === 0) return { status: 'none' }

  const licenses = rows
    .map((r) => r.pk)
    .filter((pk): pk is string => typeof pk === 'string')
  const names = await namesFor(licenses)

  const ledger = ledgerFrom(id, rows, names)
  if (ledger === null) return { status: 'none' }

  // Bounded, oldest out first. `Map` iterates in insertion order, so the first
  // key is the oldest.
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(id, ledger)

  return { status: 'found', ledger }
}

/**
 * Participants grouped by squad, in a deterministic order.
 *
 * THE SAME GROUPING RULE AS THE LIVE BOARD'S, and it is a separate function
 * rather than an import because `components/MatchCard.tsx`'s `bySquad` is over
 * live `PlayerRow`s with different fields. The ORDER rule is what matters and it
 * matches: by squad index where both have one, ungrouped last.
 */
export function bySquad(
  participants: readonly MatchParticipant[],
): Array<[string | null, MatchParticipant[]]> {
  const map = new Map<string | null, MatchParticipant[]>()
  for (const p of participants) {
    const list = map.get(p.squadId)
    if (list) list.push(p)
    else map.set(p.squadId, [p])
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === null) return 1
    if (b[0] === null) return -1
    /**
     * BY THE SQUAD'S BEST PLACEMENT, not by its index. On a finished match the
     * interesting order is who won, and the index is an arbitrary mint order.
     * The live board sorts by index because nothing has placed yet.
     */
    const best = (list: MatchParticipant[]) =>
      Math.min(...list.map((p) => (p.placement > 0 ? p.placement : Number.MAX_SAFE_INTEGER)))
    const ab = best(a[1])
    const bb = best(b[1])
    if (ab !== bb) return ab - bb
    return a[0].localeCompare(b[0])
  })
}

/**
 * Who got the most kills, which the owner named specifically.
 *
 * "any other helpful info about the match like who got the most kills, etc."
 *
 * A LIST, NOT A WINNER, because a tie is common in a mode where most players
 * finish on one or two kills and there is no tiebreak that is not invented.
 * EMPTY WHEN NOBODY GOT A KILL — a match where the top score is zero has no
 * most-kills, and naming the alphabetically-first player as the leader of
 * nothing would be a claim about them.
 */
export function mostKills(
  participants: readonly MatchParticipant[],
): MatchParticipant[] {
  const top = Math.max(0, ...participants.map((p) => p.kills))
  if (top === 0) return []
  return participants.filter((p) => p.kills === top)
}
