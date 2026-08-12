import { ddb, tables } from './dynamo'

/**
 * The GAME's row for a player, as distinct from the console's registry.
 *
 * TWO TABLES, TWO OWNERS, AND THAT IS DELIBERATE. `ringmaster-players` is this
 * console's own registry: who has connected, under what identifiers, when. It
 * is written here, on this box, from the snapshot feed. `br-players` belongs to
 * the game server — br_ddb writes it directly at the end of every match, and
 * Ringmaster has no part in that path at all.
 *
 * The split follows the standing rule that the game server must never depend on
 * this console. Career stats, currency and inventory are things a match needs;
 * routing them through here would mean a web console in another region could
 * stop people from earning. So the game owns them, and Ringmaster READS them —
 * which is the safe direction, and the only direction used here.
 *
 * KEYED DIFFERENTLY, TOO. The registry is keyed on a bare `license`; the game
 * row is a composite `{pk: license, sk: 'profile'}` because the game may later
 * hang other rows off the same partition. Getting this wrong returns nothing
 * rather than erroring, which is exactly the sort of silent empty that reads as
 * "this player has never played".
 */
export interface GameProfile {
  /** Career totals. Every one of these is an accumulated ADD, never a set. */
  matches: number
  wins: number
  top10s: number
  kills: number
  deaths: number
  downs: number
  revives: number
  damageDealt: number
  /** In-match seconds. NOT the same as connected time, which the registry holds. */
  playtimeSec: number
  soloMatches: number
  squadMatches: number

  /** Progression. */
  xp: number
  level: number

  /** Market. Earned only at match end — there is no purchase path. */
  balance: number
  owned: string[]
  /** kind -> item id. Flat `equip_<kind>` attributes on the row. */
  equipped: Record<string, string>

  /** When the last match was recorded, ms. Null if none ever has been. */
  lastMatchAt: number | null
}

const EQUIP_KINDS = ['character', 'chute', 'trail', 'weapon', 'banner', 'verdict']

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Read one player's game-side record.
 *
 * RETURNS NULL FOR "NEVER PLAYED", not a zeroed object. The distinction is the
 * whole point: a profile showing 0 matches and 0 wins reads as a player who has
 * turned up and lost every time, which is a different and much less flattering
 * claim than "no match has been recorded for this person yet". The caller
 * decides how to say that; this function refuses to guess.
 *
 * THROWS NOTHING. An unreadable game table means the identity half of the
 * profile still renders — a moderator looking up who somebody is should not be
 * blocked by a stats table being slow.
 */
export async function gameProfileFor(license: string): Promise<GameProfile | null> {
  let row: Record<string, unknown> | undefined
  try {
    const res = await ddb.get({
      TableName: tables.gamePlayers,
      Key: { pk: license, sk: 'profile' },
    })
    row = res.Item as Record<string, unknown> | undefined
  } catch (e) {
    console.error('[gameProfile] read failed for', license, e)
    return null
  }

  if (!row) return null

  // A row can exist with no match on it — the purchase path writes `balance`
  // and `owned` and nothing else. `matches` is the honest test for "has this
  // person actually played", and it is what decides null above the caller.
  const equipped: Record<string, string> = {}
  for (const kind of EQUIP_KINDS) {
    const v = row[`equip_${kind}`]
    if (typeof v === 'string' && v !== '') equipped[kind] = v
  }

  // The SDK returns a DynamoDB string set as a JS Set through the document
  // client. Anything else means the attribute is absent or was written wrong;
  // either way an empty list is the truthful answer.
  const ownedRaw = row.owned
  const owned =
    ownedRaw instanceof Set
      ? Array.from(ownedRaw as Set<string>)
      : Array.isArray(ownedRaw)
        ? (ownedRaw as string[])
        : []

  return {
    matches: num(row.matches),
    wins: num(row.wins),
    top10s: num(row.top10s),
    kills: num(row.kills),
    deaths: num(row.deaths),
    downs: num(row.downs),
    revives: num(row.revives),
    damageDealt: num(row.damageDealt),
    playtimeSec: num(row.playtimeSec),
    soloMatches: num(row.soloMatches),
    squadMatches: num(row.squadMatches),
    xp: num(row.xp),
    level: num(row.level) || 1,
    balance: num(row.balance),
    owned: owned.sort(),
    equipped,
    lastMatchAt: typeof row.lastMatchAt === 'number' ? row.lastMatchAt : null,
  }
}
