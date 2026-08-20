import { NextResponse, type NextRequest } from 'next/server'

import { CSRF_REJECT_STATUS, requestOriginAllowed } from '@/lib/origin'

/**
 * Two jobs, and only one of them is a boundary.
 *
 * ============================================================================
 * 1. THE CROSS-ORIGIN REFUSAL — #23. This IS a boundary and it is the reason
 * the matcher below now covers `/api`. Every state-changing request in the
 * console passes through here, so a route added tomorrow is guarded by having
 * been added, not by its author remembering. `lib/origin.ts` holds the rule and
 * says why it is "reject when `Origin` is present and wrong" rather than
 * "require `Origin`" — the distinction the game box's two secret-authenticated
 * endpoints depend on.
 *
 * IT RUNS BEFORE EVERYTHING, including the dev short-circuit below. A guard
 * that behaves differently in `next dev` is a guard nobody has ever actually
 * seen work.
 *
 * PER-ROUTE COPIES WERE THE ALTERNATIVE AND ARE NOT AN OPTION. This repository
 * has shipped the same one-line omission across five routes before now, and
 * `/api/session/keepalive` already carries a hand-rolled version of exactly
 * this check that no other route ever grew. One place, applied by the
 * framework, asserted by `lib/origin.check.ts` against every route file on
 * disk.
 * ============================================================================
 *
 * 2. THE SIGNED-OUT BOUNCE. Everything below the guard. THIS IS A FAST PATH,
 * NOT THE BOUNDARY, and the distinction is load-bearing rather than pedantic.
 * All it does is look for a session cookie. It does not validate it, does not
 * look up the session record, and does not know anything about scopes — a
 * forged cookie sails straight through.
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

/**
 * Paths the BOUNCE skips. Not the origin check — nothing skips that.
 *
 * `/api` IS THE ONE THAT MATTERS AND THE REASONING IS UNCHANGED from when it
 * was an exclusion in the matcher: a REDIRECT is the wrong answer for an API.
 * A poller would follow the 307 to the login page, receive HTML with a 200, and
 * choke parsing it as JSON; the game box's push would read it as a delivery
 * failure, back off, and leave the player list empty with nothing saying why.
 * Every route under `/api` guards itself with `auth()` and answers 401, which
 * a caller understands as "stop asking". `/api/auth` and `/api/handoff/redeem`
 * additionally CANNOT require a session, being how one is obtained.
 *
 * WHAT CHANGED IS ONLY WHERE THE SKIP LIVES. It moved out of the matcher and
 * into this function so that `/api` still reaches the origin check above. A
 * prefix match rather than a list of routes, for the reason the list version
 * failed: it needed a new entry per route, and forgetting one turned a 401 into
 * an HTML login page with a 200 status, which `fetch()` reports as success and
 * then fails to parse.
 *
 * `/login` is excluded because bouncing it is a redirect loop, and `/preview`
 * is the design harness, which 404s in production regardless.
 */
function bounceExempt(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/preview' ||
    pathname.startsWith('/preview/')
  )
}

export default function middleware(req: NextRequest) {
  /**
   * FIRST, AND WITHOUT EXCEPTION. A refusal is a status code and nothing else:
   * there is no admin reading this, and a sentence would only describe the
   * control to whoever tripped it.
   */
  if (!requestOriginAllowed(req)) {
    return new NextResponse(null, { status: CSRF_REJECT_STATUS })
  }

  if (bounceExempt(req.nextUrl.pathname)) return NextResponse.next()

  /**
   * `next dev` skips the bounce, so the design harness and the wireframe pages
   * can be looked at without a Discord round trip.
   *
   * SAFE BECAUSE THIS WAS NEVER THE BOUNDARY. Skipping it does not grant
   * access to anything — pages that hold real data still call `auth()`
   * themselves and still redirect, in dev exactly as in production. What this
   * skips is a convenience redirect in front of pages that render no data at
   * all. The origin check above is deliberately NOT inside this branch.
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
   * EVERYTHING THE APP SERVES, which is a deliberate widening: `/api` used to
   * be excluded here and is now handled inside the function instead, because
   * an excluded path is a path the origin check never sees. `lib/origin.check.ts`
   * evaluates this pattern against every route file on disk and fails the build
   * if any route exporting POST/PUT/PATCH/DELETE falls outside it.
   *
   * Only genuinely static, session-free assets are left out. They are GETs, so
   * the origin check would pass them anyway, and keeping them out spares an
   * edge invocation per file.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
