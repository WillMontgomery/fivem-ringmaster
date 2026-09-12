import { boardHeaders, normalizeLicense, squadDigest, squadPanelFor } from '@/lib/scoreboard'
import { liveView } from '@/lib/state'

/**
 * Whether the board on the wall is still about the right people (#247).
 *
 *   GET /scoreboard/squad?id=b6f5a1273092df7eb6a8c2a981418f275f2ae3fb
 *   200  {"squad":"3f0a91c4d7e25b68"}
 *
 * ═══ WHY THIS EXISTS ═══
 *
 * Owner, 2026-09-12: "Let's say I'm in squads, yeah? I'm alone when the page
 * loads, then I get matched with some others. The 'squads' display on the
 * scoreboard doesn't show the others after the page loads."
 *
 * `/scoreboard` renders the squad slide from the live snapshot at REQUEST TIME
 * and then never speaks again, and the DUI is created on the same edge of warmup
 * that forms the squads. So the board very often paints the instant before the
 * viewer has any squad at all - and then stays that way for the rest of the
 * warmup, because nothing on the page ever asked a second question. This is the
 * second question.
 *
 * ═══ IT ANSWERS A FINGERPRINT AND NOT A SQUAD ═══
 *
 * The body is `squadDigest` and nothing else: sixteen hex characters over the
 * composition the slide would be drawn from. Two reasons, and the second is the
 * one that decided the shape.
 *
 *   IT IS POLLED BY EVERY CLIENT IN THE LOBBY. A full field asking every five
 *   seconds is about ten requests a second at this box, and the whole point of a
 *   poll that usually says "nothing has changed" is that saying so is cheap. A
 *   squad roster would be the slide's entire payload, sent over and over to
 *   report that it has not moved.
 *
 *   AND IT MEANS THE PAGE IS STILL RENDERED IN ONE PLACE. When the digest does
 *   move, the page re-fetches `/scoreboard` and takes the panel out of the real
 *   document. Nothing here has to describe a squad slide, so there is no second
 *   renderer to drift out of step with `lib/scoreboardPage.ts`.
 *
 * ═══ WHAT IT ANSWERS ═══
 *
 *   200  a digest. INCLUDING WHEN THERE IS NO SQUAD, which is the answer the
 *        owner's own case depends on: a solo page has to be able to learn that
 *        it now has a squad, and a squadded page has to be able to learn that it
 *        no longer does. `squadDigest(null)` is a perfectly good value and it is
 *        not the digest of any squad.
 *   400  `id` is missing or is not a license. Same rule and same refusal as the
 *        board, from the same function.
 *
 * THERE IS NO 503 HERE AND THAT IS DELIBERATE. This route touches no database.
 * It reads the in-process snapshot the game pushes to `/api/ingest`, and a
 * console that has never been pushed to is a `feedNow` of `offline`, which
 * `squadFrom` already answers as "no squad" rather than as an error. A status
 * code nobody can act on would only give the page a branch to get wrong.
 *
 * ═══ NOTHING THE GAME DEPENDS ON ═══
 *
 * Owner: "I don't want the game server to be reliant on Ringmaster - only the
 * reverse is okay." This is read-only, it takes no argument that reaches the
 * game box, and it is called by a browser rather than by the game. A page whose
 * poll never answers keeps the slide it has; see `pageScript`.
 */

export const runtime = 'nodejs'
/**
 * NOT CACHED, BY THE FRAMEWORK OR BY ANYTHING IN FRONT OF IT. The whole value of
 * this answer is that it is current, and `boardHeaders` carries the `no-store`
 * and the CORS wildcard the board's own route explains at length.
 */
export const dynamic = 'force-dynamic'

function answer(status: number, body: string, type: string): Response {
  return new Response(body, { status, headers: boardHeaders(type) })
}

export async function GET(req: Request): Promise<Response> {
  const license = normalizeLicense(new URL(req.url).searchParams.get('id'))
  if (!license) return answer(400, 'bad id', 'text/plain; charset=utf-8')

  const live = liveView(Date.now())

  /**
   * `careerOf` ANSWERS NOTHING, AND THAT IS NOT A SHORTCUT. The digest is over
   * the squad's COMPOSITION - who, in what order, wearing which blip color - and
   * `squadDigest` reads no career number at all. Handing this a real lookup
   * would be a DynamoDB read per poll per player to compute a value that cannot
   * change because of it. See `squadDigest` for why the numbers are excluded.
   */
  const squad = squadPanelFor({
    players: live.players,
    ageMs: live.ageMs,
    viewer: license,
    careerOf: () => null,
  })

  return answer(
    200,
    JSON.stringify({ squad: squadDigest(squad) }),
    'application/json; charset=utf-8',
  )
}
