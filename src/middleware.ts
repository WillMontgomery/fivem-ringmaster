import { NextResponse, type NextRequest } from 'next/server'

/**
 * Bounce obviously-signed-out requests to the login page.
 *
 * THIS IS A FAST PATH, NOT THE BOUNDARY, and the distinction is load-bearing
 * rather than pedantic. All this does is look for a session cookie. It does
 * not validate it, does not look up the session record, and does not know
 * anything about scopes — a forged cookie sails straight through.
 *
 * The real check is `auth()` in the page or route, followed by
 * `requireScope()` per action. Those run server-side against the session
 * record in DynamoDB, which is what makes revocation immediate.
 *
 * WHY IT CANNOT DO MORE. Auth.js is configured with a *database* adapter, and
 * middleware runs on the edge runtime where the AWS SDK does not. Calling
 * `auth()` here would either fail to build or silently degrade. The first
 * version of this file was `export { auth as default }`, which typechecks,
 * deploys, and does nothing at all — verified against a production build,
 * where an unauthenticated request to `/` returned 200 rather than a redirect.
 * A guard that does nothing is worse than no guard, because everything behind
 * it gets written as though it were protected.
 */

/**
 * Auth.js's cookie, both spellings. The `__Secure-` prefix is used whenever
 * the app is served over HTTPS, which is every deployment and no dev machine.
 */
const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
]

export default function middleware(req: NextRequest) {
  /**
   * `next dev` skips the bounce, so the design harness and the wireframe pages
   * can be looked at without a Discord round trip.
   *
   * SAFE BECAUSE THIS WAS NEVER THE BOUNDARY. Skipping it does not grant
   * access to anything — pages that hold real data still call `auth()`
   * themselves and still redirect, in dev exactly as in production. What this
   * skips is a convenience redirect in front of pages that render no data at
   * all.
   *
   * NODE_ENV is inlined at build time, so the branch is eliminated from the
   * production bundle rather than merely unreachable.
   */
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const signedIn = SESSION_COOKIES.some((c) => req.cookies.has(c))
  if (signedIn) return NextResponse.next()

  const url = new URL('/login', req.nextUrl.origin)

  // Where to come back to. Passed as a search param and handed to Auth.js,
  // which validates it against the configured origin — never interpolated
  // into markup or used for a redirect directly, because an open redirect on
  // a login page is how a convincing phishing link gets built from a real
  // domain.
  if (req.nextUrl.pathname !== '/') {
    url.searchParams.set('callbackUrl', req.nextUrl.pathname)
  }

  return NextResponse.redirect(url)
}

export const config = {
  /**
   * Everything except the exclusions below.
   *
   * `/api/ingest` IS EXCLUDED ON PURPOSE and it is the one that would break
   * silently. The game server pushes there with a shared secret over the VPC
   * peering link — it has no session and never will. A redirect to a login
   * page would be read as a delivery failure, the game side would back off,
   * and the player list would simply be empty with nothing saying why.
   *
   * `/api/auth` is excluded because it is how a session is obtained in the
   * first place; requiring one to reach it is a redirect loop.
   *
   * `/api/state` is excluded because a REDIRECT is the wrong answer for an
   * API: the poller would follow the 307 to the login page, receive HTML with
   * a 200, and choke parsing it as JSON. The route runs its own auth() and
   * answers 401, which the poller understands as "stop asking".
   *
   * `/preview` is the design harness, which 404s in production regardless.
   */
  matcher: [
    '/((?!api/auth|api/ingest|api/state|login|preview|_next/static|_next/image|favicon.ico).*)',
  ],
}
