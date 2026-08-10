/**
 * Require a session for everything the matcher covers.
 *
 * THIS IS A CONVENIENCE, NOT THE BOUNDARY, and the distinction matters enough
 * to state before anyone leans on it. Middleware answers "is someone signed
 * in", which is not the same question as "may this person do this" — that one
 * is answered per action, server-side, by lib/grants.ts, in the route that
 * acts. A signed-in stranger with no grants gets past this file and no further.
 *
 * Same principle as the gamemode: the client asks, the server decides. A
 * middleware check is the equivalent of hiding a button.
 */
export { auth as default } from '@/auth'

export const config = {
  /**
   * Everything except the exclusions below.
   *
   * `/api/ingest` IS EXCLUDED ON PURPOSE and it is the one that would break
   * silently. The game server pushes there with a shared secret over the VPC
   * peering link — it has no session and never will. Letting the session
   * middleware near it would bounce every push to a login page, and the game
   * side would read that redirect as a delivery failure and back off, so the
   * player list would simply be empty with nothing anywhere saying why. The
   * endpoint does its own constant-time secret check.
   *
   * `/api/auth` is excluded because it is how a session is obtained in the
   * first place; requiring one to reach it is a redirect loop.
   */
  matcher: [
    '/((?!api/auth|api/ingest|login|_next/static|_next/image|favicon.ico).*)',
  ],
}
