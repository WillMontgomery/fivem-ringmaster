import { createHash, timingSafeEqual } from 'node:crypto'

import { DynamoDBAdapter } from '@auth/dynamodb-adapter'

import { checkAdminRole } from '@/lib/discordRole'
import { ddb, tables } from '@/lib/dynamo'
import { env } from '@/lib/env'
import {
  HANDOFF_TTL_MS,
  MINT_ROLE_TIMEOUT_MS,
  mint,
  mintLimiter,
} from '@/lib/handoff'

/**
 * Mint a pause-menu handoff token — #23.
 *
 * THE GAME SERVER CALLS THIS, NEVER A GAME CLIENT. Its credential is the same
 * shared secret `/api/ingest` uses, in the same header, compared the same way;
 * a client that could reach this endpoint could ask for a token naming somebody
 * else's Discord id, and no amount of care further down would fix that. The
 * secret lives in the game host's environment and nowhere on a player's
 * machine.
 *
 * IT LIVES UNDER `/api` SO THE MIDDLEWARE LEAVES IT ALONE. Every route under
 * that prefix is excluded from the session bounce and guards itself, and the
 * reasoning `src/middleware.ts` already writes down for `/api/ingest` is
 * exactly this route's: the caller has no session and never will, and a
 * redirect to a login page would be read as a delivery failure.
 *
 * WHAT IT COSTS, because the game side has to set a timeout against it: see
 * `MINT_BUDGET_MS` in lib/handoff.ts. 2.5s, of which the Discord round trip is
 * ~2s and everything else is two DynamoDB round trips.
 *
 * REASONS ARE RETURNED IN THE BODY. The only reader is our own game server over
 * the peered link, which is the same argument `/api/ingest` makes for putting
 * schema errors in its 400. They are machine codes, not sentences: what the
 * admin is shown in-game is the game side's to decide and is not written here.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Enough for `{"discordId":"..."}` and nothing that needs streaming. */
const MAX_BYTES = 4_096

/**
 * Constant-time comparison of the shared secret.
 *
 * Lifted deliberately unchanged from `/api/ingest` — hashed first so both sides
 * are always 32 bytes, because `timingSafeEqual` throws on a length mismatch
 * and catching that throw would leak the length of the real secret through
 * timing.
 */
function secretMatches(presented: string | null): boolean {
  if (!presented) return false

  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(env().INGEST_SECRET).digest()

  return timingSafeEqual(a, b)
}

function deny(error: string, status: number): Response {
  return Response.json({ ok: false, error }, { status })
}

export async function POST(req: Request): Promise<Response> {
  if (!secretMatches(req.headers.get('x-ringmaster-secret'))) {
    // No detail, same as /api/ingest. A caller that got this wrong is either
    // misconfigured or is not the game server.
    return deny('auth', 401)
  }

  const raw = await req.text()
  if (raw.length > MAX_BYTES) return deny('too-large', 413)

  let discordId: unknown
  try {
    discordId = (JSON.parse(raw) as { discordId?: unknown }).discordId
  } catch {
    return deny('malformed-json', 400)
  }

  if (typeof discordId !== 'string' || !/^[0-9]{1,32}$/.test(discordId)) {
    return deny('schema', 400)
  }

  /**
   * Bounded before anything expensive runs, so a stuck retry loop on the game
   * side costs a string compare rather than a Discord call.
   */
  if (!mintLimiter.allow(discordId)) return deny('rate-limited', 429)

  /**
   * THE ACCOUNT MUST ALREADY EXIST HERE, and this endpoint deliberately cannot
   * create one. A session is minted FOR an Auth.js user record; there is no
   * path by which an assertion from the game box brings a user into being, so
   * the worst a compromised game host can do is open a session for somebody who
   * already has one — never invent an admin.
   *
   * THE CONSEQUENCE IS WORTH KNOWING BEFORE IT IS REPORTED AS A BUG: an admin
   * who has never completed a normal Discord login on this console cannot use
   * the pause-menu handoff. Their first sign-in is an ordinary one, in a real
   * browser. That includes the first admin, for the same reason the grants row
   * needs `--discord-id` by hand (docs/aws-setup.md).
   */
  const adapter = DynamoDBAdapter(ddb, { tableName: tables.sessions })
  if (!adapter.getUserByAccount) return deny('store', 500)

  let known: boolean
  try {
    known = Boolean(
      await adapter.getUserByAccount({
        provider: 'discord',
        providerAccountId: discordId,
      }),
    )
  } catch (e) {
    console.error('[handoff] account lookup failed', e)
    return deny('store', 503)
  }
  if (!known) return deny('no-account', 403)

  /**
   * THE DISCORD ROLE GATE, RUN HERE BECAUSE THE REDEEM PATH SKIPS `signIn`.
   *
   * A normal login passes through `auth.ts`'s `signIn` callback, which is where
   * the admin role is actually required. Creating a session directly walks
   * around that callback, so without this an admin removed from the Discord
   * role would still get a working console out of the pause menu — read access
   * to bans, incidents and player data — until they tried to write something
   * and `lib/discordRole.ts` caught them. That gap is the whole reason this
   * call is here.
   *
   * FAIL CLOSED ON ANYTHING BUT `held`, WHICH IS THE OPPOSITE OF WHAT
   * `enforceDiscordAdmin` DOES, and the difference is deliberate rather than an
   * oversight. That gate governs a WRITE by somebody already signed in, where
   * denying on an unreachable Discord would break a working console over a
   * transient blip. This is a LOGIN, and `auth.ts` already argues the case for
   * logins in as many words: "The failure mode of 'admins cannot log in for ten
   * minutes' is strictly better than 'anyone can log in for ten minutes'."
   * Nothing is broken by refusing here — the admin alt-tabs and signs in the
   * ordinary way.
   *
   * SO AN UNSET `DISCORD_BOT_TOKEN` TURNS THIS FEATURE OFF. `checkAdminRole`
   * answers `unresolved` with no token, and unresolved denies. That is a
   * supported state elsewhere in the app and it is not one here: a login path
   * that quietly degrades to "no role check" is not a login path worth having.
   * The response says which it was so the game log names the cause.
   *
   * ITS OWN TIMEOUT, shorter than `ROLE_CHECK_TIMEOUT_MS`, because the caller
   * is on a five-second hard ceiling it cannot configure.
   */
  const role = await checkAdminRole(discordId, MINT_ROLE_TIMEOUT_MS)
  if (role.state === 'revoked') return deny('role-revoked', 403)
  if (role.state !== 'held') {
    console.warn(`[handoff] mint refused, role unresolved: ${role.why}`)
    return deny('role-unresolved', 503)
  }

  try {
    const { token, expiresAt } = await mint({ discordId })

    /**
     * The full URL rather than only the token, so the redeem path's shape is
     * this console's to change and not something the game hard-codes and gets
     * subtly wrong. `AUTH_URL` is the same origin Discord redirects back to.
     */
    const url = new URL('/api/handoff/redeem', env().AUTH_URL)
    url.searchParams.set('t', token)

    return Response.json({
      ok: true,
      url: url.toString(),
      token,
      expiresAt,
      ttlMs: HANDOFF_TTL_MS,
    })
  } catch (e) {
    // Never log the token, and there is none in scope to log by accident.
    console.error('[handoff] mint failed', e)
    return deny('store', 503)
  }
}
