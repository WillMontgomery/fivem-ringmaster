import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { ddb, tables } from '@/lib/dynamo'
import { grantsForDiscordId, type Grant } from '@/lib/grants'
import { isIdle } from '@/lib/activity'

/**
 * Who is signed in, in the terms the rest of the system speaks.
 *
 * THE MAPPING PROBLEM, stated once: Discord tells us who logged in, but every
 * ban, audit row and game-side record keys on the game LICENSE. Auth.js's
 * session gives us its own internal user id — not even the Discord id. So the
 * chain is
 *
 *   session.user.id  ──►  account record  ──►  discordId  ──►  grants row
 *        (Auth.js)      (sessions table)       (Discord)      (license)
 *
 * The account hop exists because the DynamoDB adapter stores the OAuth account
 * — provider and providerAccountId included — as an item under the user's
 * partition key. `providerAccountId` for Discord IS the Discord id.
 *
 * NOTHING ON THIS OBJECT DECIDES WHAT THE ADMIN MAY DO. `scopes` used to, and
 * there are no scopes any more: whoever holds the Discord admin role is a full
 * admin, and that role is the only authorisation input in the system. The last
 * hop is kept for ATTRIBUTION, not permission — see lib/grants.ts.
 */

export interface CurrentAdmin {
  /** Display name from Discord, for the sidebar. */
  name: string
  /** Discord avatar URL, persisted by the adapter from the OAuth profile. */
  avatarUrl: string | null
  discordId: string | null
  /**
   * The admin's own game license, or null when no grants row links this Discord
   * account to one.
   *
   * NULL IS NOT A REDUCED ACCOUNT. It stamps `actorLicense: null` on their audit
   * rows and it makes Spectate refuse — there is no character on the server to
   * look through — and it withholds nothing else.
   */
  license: string | null
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
 * The signed-in admin, resolved to a license where one exists — or null when
 * nobody is signed in.
 *
 * A signed-in person with NO grants row is not an error, not null, and no
 * longer even limited: they passed the Discord role gate, which is the whole
 * of authorisation, so they are a full admin whose actions are attributed by
 * name and Discord id rather than by license. That state is the first admin's
 * first login and every admin who has never joined the game server — it has to
 * render, not throw.
 *
 * AN IDLE SESSION IS NULL HERE, not a separate state, and that is what makes
 * the timeout cost nothing at the call sites. Every page already handles "not
 * signed in" by bouncing to the login page, so an idle reader takes the path
 * that already exists rather than needing a new branch in thirteen routes.
 */
export async function currentAdmin(): Promise<CurrentAdmin | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  /**
   * Idle is an AUTHENTICATION failure, so it is checked here with the session
   * rather than alongside the scope checks — someone who walked away has not
   * lost a permission, they have stopped being present.
   *
   * FREE. `auth()` has already caused the request cookies to be parsed; this is
   * a string compare and one HMAC, with no DynamoDB round trip. The record is
   * deleted by the keepalive route when the client notices, not here — a read
   * path that deletes sessions would delete them from the middle of a page
   * render.
   */
  if (isIdle(await cookies())) return null

  const name = session.user.name ?? 'Unknown'
  const avatarUrl = session.user.image ?? null

  const discordId = await discordIdFor(session.user.id)
  if (!discordId) return { name, avatarUrl, discordId: null, license: null, grant: null }

  const grant = await grantsForDiscordId(discordId)

  return {
    name,
    avatarUrl,
    discordId,
    license: grant?.license ?? null,
    grant,
  }
}
