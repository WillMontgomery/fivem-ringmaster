import { randomUUID } from 'node:crypto'

import { DynamoDBAdapter } from '@auth/dynamodb-adapter'

import { ddb, tables } from '@/lib/dynamo'
import { env } from '@/lib/env'
import {
  HANDOFF_LANDING,
  HANDOFF_REFUSED,
  redeem,
  secureCookies,
  sessionCookieName,
  sessionSameSite,
} from '@/lib/handoff'

/**
 * Spend a pause-menu handoff token and become signed in — #23.
 *
 * EVERY FAILURE LANDS ON THE LOGIN PAGE AND SAYS NOTHING ELSE. Expired, spent,
 * forged, malformed, an admin who does not exist, DynamoDB refusing — one
 * status, one destination, no query parameter, no body. There is deliberately
 * nothing here that can be built into an oracle for whether a token existed,
 * and nothing that leaves a half-established session behind: the cookie is set
 * on the success path only, after the row has already been consumed.
 *
 * IT LIVES UNDER `/api` FOR THE SAME REASON `/api/auth` IS EXCLUDED FROM THE
 * MIDDLEWARE — this is how a session is obtained, so requiring one to reach it
 * is a redirect loop. The prefix match in `src/middleware.ts` already covers
 * that without an entry naming this route, which is the point of it being a
 * prefix. A browser navigating to a `/api/...` URL is unusual; Auth.js's own
 * `/api/auth/signin` does exactly this.
 *
 * THE SESSION IT CREATES IS NOT A WEAKER KIND OF SESSION. It is written by the
 * same adapter, into the same table, in the same shape, with the same cookie
 * and the same lifetime as one Discord OAuth produces. Nothing downstream can
 * tell the two apart, and that is the requirement rather than a convenience:
 * `currentAdmin()`, the two-hour idle timeout and the write-time Discord role
 * recheck in `lib/discordRole.ts` all apply to it
 * unchanged, because none of them can see how it began.
 *
 * NO `ingame` FLAG RIDES ON IT, and its absence is deliberate. #23 wants an
 * in-game marker to unlock a Spectate button; a marker stored on the session
 * record would make this session distinguishable from a normal one, which is
 * the property above. When that lands it needs a carrier of its own that
 * authorises nothing.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Auth.js's default database-session lifetime — @auth/core/lib/init.js. */
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The login page, and nothing else on any failure path.
 *
 * `no-store` and `no-referrer` are set here specifically rather than relying on
 * the app-wide headers: this is the one response in the app whose REQUEST URL
 * carried a credential, and neither a cache entry nor a `Referer` should carry
 * it any further. See the note on the token in the query string below.
 */
function land(to: string, setCookie?: string): Response {
  const headers = new Headers({
    Location: to,
    'Cache-Control': 'no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
  })
  if (setCookie) headers.append('Set-Cookie', setCookie)

  // 303 rather than 302: the follow-up is unambiguously a GET of the landing
  // page, and the browser must not carry anything from this request into it.
  return new Response(null, { status: 303, headers })
}

/**
 * THE TOKEN TRAVELS IN THE QUERY STRING, AND THAT WAS CHECKED RATHER THAN
 * ASSUMED.
 *
 * It has to: the game points an iframe's `src` at a URL, which is a GET, and
 * there is no POST a NUI page can make into a frame without generating markup
 * to do it. So the question is what the exposure actually costs here.
 *
 * NOTHING IN THIS APP LOGS REQUEST URLS — no request logger, no framework
 * access log, and no `console.*` call anywhere in `src/` that takes a URL, a
 * pathname or a search param. Verified by grep, not assumed. What remains is
 * outside this repo: a reverse proxy or load balancer in front of the console
 * would log the full path if one is configured to, and that is worth the
 * owner's attention when this deploys.
 *
 * THREE THINGS MAKE THE RESIDUAL EXPOSURE SMALL. The token is dead the instant
 * this route reads it, so a URL recovered from anywhere afterwards is a spent
 * one. The 303 means the document that ends up loaded has no token in its URL,
 * so nothing further inherits it. And `Referrer-Policy` is `no-referrer` on
 * this response, over the app-wide `strict-origin-when-cross-origin`.
 */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('t')

  let result
  try {
    result = await redeem(token)
  } catch (e) {
    // The token is never in the message and never in the error — `redeem`
    // throws only what the store throws, and the store is given a hash.
    console.error('[handoff] redeem failed', e)
    return land(HANDOFF_REFUSED)
  }

  if (!result.ok) {
    // The reason is logged and never surfaced. Refused and expired are ordinary
    // outcomes — a second frame lost a race, or somebody left the pause menu
    // open — and are `warn` rather than `error` so they do not read as faults.
    console.warn(`[handoff] redeem refused: ${result.reason}`)
    return land(HANDOFF_REFUSED)
  }

  const adapter = DynamoDBAdapter(ddb, { tableName: tables.sessions })
  if (!adapter.getUserByAccount || !adapter.createSession) {
    console.error('[handoff] adapter is missing session methods')
    return land(HANDOFF_REFUSED)
  }

  try {
    /**
     * THE TOKEN IS ALREADY SPENT BY THE TIME THIS RUNS, and everything after it
     * can only fail closed. An admin whose account has since been deleted, or a
     * DynamoDB that refuses the write, ends up on the login page with the row
     * consumed — which is the safe direction. The alternative, holding the row
     * until the session is written, means a failure leaves a live token behind.
     */
    const user = await adapter.getUserByAccount({
      provider: 'discord',
      providerAccountId: result.discordId,
    })
    if (!user?.id) return land(HANDOFF_REFUSED)

    // `crypto.randomUUID()`, which is what Auth.js's callback action uses for a
    // database session token.
    const sessionToken = randomUUID()
    const expires = new Date(Date.now() + SESSION_MAX_AGE_MS)

    await adapter.createSession({ sessionToken, userId: user.id, expires })

    /**
     * THE FLAGS MUST MATCH `defaultCookies()` EXACTLY, or this route issues a
     * cookie that `auth()` does not read and the redeem silently produces a
     * signed-out console. The name lives in `lib/handoff.ts` so the checks can
     * assert it against the pair `src/middleware.ts` sniffs for, and `src/auth.ts`
     * now builds Auth.js's own cookie from the same three functions so the two
     * cannot drift.
     *
     * `SameSite` IS `None` ON HTTPS — #23, the owner's call, made, with the
     * reasoning written where the value is decided (`lib/handoff.ts`). The `Lax`
     * literal that used to sit here was the one thing stopping the framed flow
     * working: a third-party context does not send a Lax cookie on a subresource
     * request, so the redirect below arrived at the landing page with no session
     * and bounced straight to /login. It is `None` ONLY because
     * `src/middleware.ts` now refuses cross-origin writes.
     *
     * BOTH FLAGS COME FROM ONE BOOLEAN so that `None` without `Secure` — a
     * cookie browsers drop in silence — cannot be produced by editing one line.
     */
    const secure = secureCookies(env().AUTH_URL)
    const cookie = [
      `${sessionCookieName(secure)}=${sessionToken}`,
      'Path=/',
      'HttpOnly',
      `SameSite=${sessionSameSite(secure) === 'none' ? 'None' : 'Lax'}`,
      `Expires=${expires.toUTCString()}`,
      secure ? 'Secure' : null,
    ]
      .filter(Boolean)
      .join('; ')

    /**
     * NO ACTIVITY COOKIE IS ISSUED and none is needed. `lib/activity.ts` reads
     * an absent `rm_act` as "not yet idle" precisely so a fresh sign-in is not
     * bounced on its first request, and the idle guard stamps it on mount. This
     * session starts its two hours exactly where a Discord login starts them.
     */
    return land(HANDOFF_LANDING, cookie)
  } catch (e) {
    console.error('[handoff] session creation failed', e)
    return land(HANDOFF_REFUSED)
  }
}
