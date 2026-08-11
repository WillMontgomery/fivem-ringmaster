import { auth } from '@/auth'
import { ddb, tables } from '@/lib/dynamo'
import { grantsForDiscordId, type Grant, type Scope } from '@/lib/grants'

/**
 * Who is signed in, in the terms the rest of the system speaks.
 *
 * THE MAPPING PROBLEM, stated once: Discord tells us who logged in, but every
 * grant, ban and audit row keys on the game LICENSE. Auth.js's session gives
 * us its own internal user id — not even the Discord id. So the chain is
 *
 *   session.user.id  ──►  account record  ──►  discordId  ──►  grants row
 *        (Auth.js)      (sessions table)       (Discord)     (license, scopes)
 *
 * The account hop exists because the DynamoDB adapter stores the OAuth account
 * — provider and providerAccountId included — as an item under the user's
 * partition key. `providerAccountId` for Discord IS the Discord id.
 */

export interface CurrentAdmin {
  /** Display name from Discord, for the sidebar. */
  name: string
  discordId: string | null
  /** null until a grants row links this Discord account to a license. */
  license: string | null
  scopes: Scope[]
  grant: Grant | null
}

/**
 * The Discord id behind an Auth.js user id.
 *
 * One Query on the sessions table: the adapter's single-table layout keys the
 * account item as pk USER#<id> / sk ACCOUNT#<provider>#<providerAccountId>,
 * with the account object's own attributes alongside. No GSI needed — the
 * partition key is known.
 */
async function discordIdFor(userId: string): Promise<string | null> {
  const res = await ddb.query({
    TableName: tables.sessions,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':sk': 'ACCOUNT#discord#',
    },
    Limit: 1,
  })

  const item = res.Items?.[0] as { providerAccountId?: string } | undefined
  return item?.providerAccountId ?? null
}

/**
 * The signed-in admin, resolved to license and scopes — or null when nobody
 * is signed in.
 *
 * A signed-in person with NO grants row is not an error and not null: they
 * passed the Discord role gate but nobody has granted them anything yet, so
 * they get an empty scope list and a sidebar that says so. That state is the
 * first admin's first login, every time a new moderator joins, and the day
 * after someone's grants are revoked — it has to render, not throw.
 */
export async function currentAdmin(): Promise<CurrentAdmin | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const name = session.user.name ?? 'Unknown'

  const discordId = await discordIdFor(session.user.id)
  if (!discordId) return { name, discordId: null, license: null, scopes: [], grant: null }

  const grant = await grantsForDiscordId(discordId)

  return {
    name,
    discordId,
    license: grant?.license ?? null,
    scopes: grant?.scopes ?? [],
    grant,
  }
}
