import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { ddb, tables } from '@/lib/dynamo'
import {
  grantsForDiscordId,
  licenseForDiscordId,
  type Grant,
} from '@/lib/grants'
import { licensesFor } from '@/lib/players'
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
 *        (Auth.js)      (sessions table)       (Discord)   │   (hand-written)
 *                                                          │
 *                                                          └►  identifier index
 *                                                              (what the game saw)
 *
 * The account hop exists because the DynamoDB adapter stores the OAuth account
 * — provider and providerAccountId included — as an item under the user's
 * partition key. `providerAccountId` for Discord IS the Discord id.
 *
 * THE LAST HOP HAS TWO SOURCES AND THE SECOND ONE IS NOT REDUNDANT. The grants
 * row is written by hand and there is no UI that writes it; the identifier index
 * is written by the game on every connect. Since 4078d47 an admin can be made an
 * admin without anybody touching DynamoDB, so "no grants row" stopped being a
 * rare bootstrap state and became the normal one — see `licenseForDiscordId` in
 * lib/grants.ts for the rules and for what a null costs.
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
   * The admin's own game license, or null when neither the grants row nor the
   * game's own identifier index can name one unambiguously.
   *
   * NULL IS NOT A REDUCED ACCOUNT. It stamps `actorLicense: null` on their audit
   * rows and it makes Spectate refuse — there is no character on the server to
   * look through — and it withholds nothing else.
   *
   * IT IS ALSO NOT FREE, which is why it is now worth two reads to avoid. A null
   * here unlinks their name everywhere a row is rendered AND empties the "actions
   * taken" half of their own profile, because `audit.forPlayer` finds it with
   * `actorLicense === license`. See `licenseForDiscordId` in lib/grants.ts.
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
 * of authorisation. It is ALSO no longer the same thing as having no license —
 * the game's identifier index answers for anybody who has connected with
 * Discord integration on, which since 4078d47 is most of the admins who have
 * one. Only somebody the game has never seen under that Discord account is
 * attributed by name and id alone, and that state — the first admin's first
 * login — has to render, not throw.
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

  /**
   * TWO SOURCES, AND THE SECOND ONE IS ONLY REACHED WHEN THE FIRST IS EMPTY —
   * which matters here because AppShell's note about this function is still
   * true: this is four sequential DynamoDB reads on every page render and the
   * owner has already felt them. An admin with a grants row pays nothing new.
   * An admin without one pays a single GetItem, and gets attribution they
   * previously had no way to have. The whole rule lives in lib/grants.ts.
   */
  const { license, grant } = await licenseForDiscordId(discordId, {
    granted: grantsForDiscordId,
    seen: licensesFor,
    log: (level, message) => console[level](message),
  })

  return {
    name,
    avatarUrl,
    discordId,
    license,
    grant,
  }
}
