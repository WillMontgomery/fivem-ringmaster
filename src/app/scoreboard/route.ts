import { env } from '@/lib/env'
import { boardHeaders, normalizeLicense, playerPanelFrom, rankBoard } from '@/lib/scoreboard'
import { renderScoreboard } from '@/lib/scoreboardPage'
import { boardSnapshot, playerRowFor } from '@/lib/scoreboardStore'

/**
 * The warmup-area stat board (#247).
 *
 *   GET /scoreboard?id=b6f5a1273092df7eb6a8c2a981418f275f2ae3fb
 *
 * ═══ THE URL IS THE OWNER'S, VERBATIM, AND THE `id` IS NOT A CREDENTIAL ═══
 *
 * He chose this shape and said why: "we use the license as a DDB key in many
 * places already, so it seemed intuitive". Before building it, every place a
 * license appears in either system was checked for whether one could be
 * PRESENTED to gain something, and none can. Every other Ringmaster route sits
 * behind a session or a constant-time shared secret; the game takes a license
 * off the FiveM connection rather than from anything a person supplies. A
 * license is a key, the way a row id is a key, and this route treats it as
 * exactly that: it selects whose numbers the second panel shows and which row on
 * the leaderboard is highlighted.
 *
 * WHAT IT DOES HAND OUT TO ANYBODY WHO GUESSES ONE, stated plainly rather than
 * left implied: that player's name and five career totals. The same figures the
 * verdict screen shows them, on a wall every other player in the lobby is
 * already looking at. No identifiers, no Discord account, no moderation history,
 * no wallet, no cosmetics. Guessing one is guessing forty hex characters.
 *
 * ═══ IT IS A ROUTE HANDLER, WHICH IS WHY IT IS NOT A PAGE ═══
 *
 * The consumer is a DUI: a Chromium 103 instance created by the game client on
 * the player's own machine, painting this document onto a texture. The root
 * layout's stylesheet, fonts and providers are all wrong for it and all of them
 * would ship. A route handler has no layout, so `lib/scoreboardPage.ts` writes
 * the entire document and nothing else travels. See that file.
 *
 * ═══ WHAT IT ANSWERS ═══
 *
 *   200  a board. The leaderboard always, the per-player panel when that license
 *        has a career row, and the two alternate in the page on the page's own
 *        clock.
 *   400  `id` is missing or is not a license. That is a caller bug, and it is
 *        told apart from the case below on purpose.
 *   503  there is no board to show: the snapshot has never been built, or every
 *        category came back with nothing true to say.
 *
 * ALL THREE CARRY `Access-Control-Allow-Origin: *`. That is the whole point of
 * the header - see its own note below - and it is why the 503 is worth telling
 * apart from the 400 at all.
 *
 * ═══ WHAT THE CLIENT NEEDS FROM THIS, FOR THE OUTAGE CASE ═══
 *
 * The owner: "If ringmaster is down, that's fine. We just show static on the
 * screen instead." That is the Lua's job and this route's contribution to it is
 * to be unambiguous about failure. ANYTHING THAT IS NOT A 200 MEANS SHOW STATIC:
 * a 400, a 503, a 502 from Caddy, a TLS error, a timeout, a DNS failure. The
 * bodies of the non-200 answers are one word and carry nothing to parse, so
 * there is no shape for the client to get wrong.
 *
 * THE ONE CASE THAT WOULD OTHERWISE BE A TRAP is a console that is up and
 * signed-out-redirecting: a page path with no session cookie is bounced to
 * `/login` with a 307, and a client following it would paint a login form onto a
 * prop. `src/middleware.ts` exempts this path from the bounce for exactly that
 * reason, and `scoreboard.check.ts` drives the shipped middleware in production
 * mode to prove it.
 */

export const runtime = 'nodejs'
/**
 * NOTHING ABOUT THIS RESPONSE MAY BE CACHED BY THE FRAMEWORK OR THE PROXY.
 * `force-dynamic` covers Next; the `Cache-Control` below covers Caddy and
 * Cloudflare, and it is not optional: the document contains one named player's
 * career, so a shared cache that keyed loosely would show one player another
 * player's panel. The leaderboard half is already cached where caching is cheap,
 * in this process, for a minute. See `lib/scoreboardStore.ts`.
 */
export const dynamic = 'force-dynamic'

/**
 * ═══ THE ONE HEADER THE GAME SIDE CANNOT WORK WITHOUT ═══
 *
 * Owner: "be sure to add Access-Control-Allow-Origin". It is a hard requirement
 * rather than a nicety, and the reason is worth writing down once because it is
 * not obvious from either repository alone.
 *
 * THE BOARD MUST FALL BACK TO A STATIC TEXTURE WHEN RINGMASTER IS DOWN, AND THE
 * CLIENT CANNOT DETECT THAT ALONE. `br_core/client/board.lua` says so at length:
 * there is no load callback and no way to read a runtime texture back, and
 * `IS_DUI_AVAILABLE` reports only that a CEF instance started - which is true
 * whether the page loaded or the browser is sitting on ERR_NAME_NOT_RESOLVED.
 *
 * AND THE BOARD PAGE CANNOT REPORT FOR ITSELF. FiveM's NUI callback channel
 * whitelists exactly two origins per resource, `nui://<res>` and
 * `https://cfx-nui-<res>` (nui-resources/src/ResourceUI.cpp). A document served
 * from ringmaster.blitz-royale.com is neither, so it has no way to speak to Lua.
 *
 * THE PLAN IS A SMALL SHELL PAGE SERVED FROM `https://cfx-nui-br_ui/...` THAT
 * FRAMES THIS ONE AND PROBES IT. That shell is on a whitelisted origin, so it
 * can call back into Lua; what it cannot do without this header is learn what
 * happened. A cross-origin `fetch` with `mode: 'no-cors'` returns an opaque
 * response: it tells the shell that the host ANSWERED, which separates DNS and
 * connection failure from success, and it CANNOT READ A STATUS CODE. A 503 from
 * this route - the "no board to show" case below, which is the exact case the
 * static fallback exists for - is indistinguishable from a 200.
 *
 * SO THE VALUE IS A WILDCARD, AND THAT IS THE CORRECT VALUE HERE RATHER THAN A
 * LAZY ONE. This route is deliberately unauthenticated, carries no cookie, sends
 * no credentials and returns only what anybody already holding that license
 * could request directly. There is nothing for a wildcard to leak that a plain
 * `curl` does not already have. Naming an origin instead is not even possible:
 * the parent is `https://cfx-nui-<resource>`, and `next.config.mjs` already
 * explains at length why that origin cannot be written as a source expression.
 *
 * ON EVERY ANSWER, NOT JUST THE 200. The probe's entire job is to tell a 200
 * from a 503, so a 503 that cannot be read is a 503 that did not happen.
 * `scoreboard.check.ts` asserts the header on all three status codes.
 *
 * NO PREFLIGHT AND SO NO `OPTIONS` HANDLER. A `GET` with no custom request
 * header is a CORS simple request; the browser sends it directly and reads the
 * response if this header allows it. Adding `Access-Control-Allow-Methods` or an
 * `OPTIONS` export would be answering a question nothing asks, on a route whose
 * whole security argument is that it exports one method.
 */
function refuse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: boardHeaders('text/plain; charset=utf-8'),
  })
}

export async function GET(req: Request): Promise<Response> {
  const license = normalizeLicense(new URL(req.url).searchParams.get('id'))
  if (!license) return refuse(400, 'bad id')

  const { SCOREBOARD_HIDE_ADMINS: hideAdmins, SCOREBOARD_MOTION: motion } = env()

  /**
   * THE SNAPSHOT FIRST, AND THE PLAYER'S OWN ROW BESIDE IT. They are independent
   * reads against the same table and neither needs the other's answer, so they
   * overlap: the page's worst case is the slower of the two rather than their
   * sum. The snapshot is nearly always a property access on a cached object, so
   * in practice this is the `GetItem` and nothing else.
   */
  const [snapshot, row] = await Promise.all([
    boardSnapshot({ hideAdmins }),
    playerRowFor(license),
  ])

  /**
   * NO SNAPSHOT AT ALL means this process has never managed to build one - a
   * cold start whose first scan failed, or a denied permission. There is nothing
   * true to paint, so the wall gets static.
   */
  if (!snapshot) return refuse(503, 'no board')

  const hidden = snapshot.admins
  /**
   * THE `id` IN THE URL IS ALSO WHO IS LOOKING. Owner: "if the player viewing
   * the scoreboard is anywhere on it - highlight that row." The same license
   * that selects the per-player panel selects the row to light up, which is why
   * there is no second parameter: there is only one person in front of this
   * board and the URL already names them.
   */
  const board = rankBoard(snapshot.rows, { hidden, viewer: license })

  /**
   * AN EMPTY BOARD IS ALSO STATIC, AND THIS IS THE HONEST EMPTY STATE. Every
   * category drops entries whose value is zero and drops itself when nothing is
   * left, so `categories` is empty exactly when the game has recorded nothing
   * anybody has actually done. Rendering that would mean either a wall of empty
   * cards or a sentence apologizing for them, and the second is the "AI slop"
   * the house rules forbid. Saying nothing is both cheaper and truer.
   */
  if (board.categories.length === 0) return refuse(503, 'no board')

  /**
   * A LICENSE WITH NO CAREER ROW IS NOT AN ERROR. It is somebody who has never
   * finished a match, and the answer is the leaderboard on its own: no second
   * panel, no swap timer, no zeros and nothing on screen explaining the absence.
   */
  const player = row ? playerPanelFrom(row, snapshot.rows, { hidden }) : null

  return new Response(renderScoreboard({ board, player, motion }), {
    status: 200,
    headers: boardHeaders('text/html; charset=utf-8'),
  })
}
