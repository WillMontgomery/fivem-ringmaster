import { authorize, errorResponse } from '@/lib/actions'
import * as players from '@/lib/players'
import { isOnline, onlinePlayers, searchDirectory } from '@/lib/state'

/**
 * Player search, for the command palette.
 *
 * SEARCHES EVERYONE THE CONSOLE HAS SEEN, not just who is connected. The
 * palette used to read the live snapshot directly, which meant looking somebody
 * up after they logged off — the ordinary reason to look somebody up — returned
 * nothing at all.
 *
 * AND THEN IT READ ONLY THE OTHER HALF (#18). Moving off the snapshot moved
 * entirely off it: this endpoint asked the durable registry and, failing that,
 * the in-memory session directory. Both are records of who has BEEN here.
 * Neither can answer "who is on the server right now", so the palette's
 * "Online now" section was in fact "the ten most recently seen", which on a
 * console that has been up for a day is a list of people who went home. The
 * `online` flag was computed per row and used only to sort and to draw a tag —
 * it never selected anything.
 *
 * THE FIX IS A JOIN, NOT A HARDER QUERY. `onlinePlayers()` reads the same
 * `state.snapshot` object the live players page renders from, so the two
 * surfaces cannot disagree about who is connected. Which also settles whether
 * an empty "Online now" was
 * `WillMontgomery/fivem-br-gamemode#152` (the live feed dropping mid-match)
 * seen from another page: it was not, and could not have been. This endpoint
 * did not read the feed at all, so the section was empty of online players with
 * a perfectly healthy feed. After this change it does read the feed, and from
 * here on an empty "Online now" while players are in the server IS that issue,
 * and the live players page will be empty at the same moment.
 *
 * Capped server-side as well as in the UI. The cap is a product decision (a
 * shortlist, not a report) and product decisions that live only in a component
 * stop being true the first time something else calls the endpoint.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIMIT = 10

interface Row {
  license: string
  name: string
  lastSeen: number
  online: boolean
}

export async function GET(req: Request): Promise<Response> {
  try {
    await authorize('view', 'read')

    const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
    const now = Date.now()

    /**
     * THE LIVE SNAPSHOT FIRST, ALWAYS.
     *
     * Someone on the server right now is almost always the person being looked
     * for, and they are the one result the other two sources can be wrong
     * about: the registry is only written when the game emits `player_seen`,
     * and the session directory is lost on a console restart. The snapshot is
     * neither — it is re-sent in full every two seconds.
     */
    const matchesQuery = (name: string, license: string) =>
      !q ||
      name.toLowerCase().includes(q.toLowerCase()) ||
      license.toLowerCase().includes(q.toLowerCase())

    const live: Row[] = onlinePlayers()
      .filter((p) => matchesQuery(p.name, p.license))
      .map((p) => ({ license: p.license, name: p.name, lastSeen: now, online: true }))

    /**
     * WITH NOTHING TYPED, THE ANSWER IS THE SERVER. The palette heads this
     * "Online now", so it returns exactly that and nothing else — an empty
     * result now means an empty server, which is a true and readable statement,
     * rather than a silent substitution of people who left. History is one
     * keystroke away.
     */
    if (!q) {
      return Response.json({ ok: true, players: live.slice(0, LIMIT) })
    }

    /**
     * THE REGISTRY, THEN THE SESSION DIRECTORY.
     *
     * The registry is durable and covers everyone ever seen; the in-memory
     * directory covers only this console's uptime. Preferring the registry
     * means a search works after a console restart, which is the whole reason
     * it exists — but falling back keeps search working before the table has
     * been created, and during the window after a fresh deploy when nobody has
     * reconnected yet to be recorded.
     */
    let history: Row[] = []

    try {
      history = (await players.search(q, LIMIT)).map((p) => ({
        license: p.license,
        name: p.preferredName || p.name,
        lastSeen: p.lastSeen,
        online: isOnline(p.license),
      }))
    } catch {
      /* table missing or unreachable — fall through to the session directory */
    }

    if (history.length === 0) {
      history = searchDirectory(q, LIMIT).map((e) => ({
        license: e.license,
        name: e.name,
        lastSeen: e.lastSeen,
        online: isOnline(e.license),
      }))
    }

    // Live rows win on a collision: same person, and the snapshot's name is the
    // one they are playing under this minute.
    const seen = new Set(live.map((r) => r.license))
    const rows = [...live, ...history.filter((r) => !seen.has(r.license))]

    return Response.json({ ok: true, players: rows.slice(0, LIMIT) })
  } catch (e) {
    return errorResponse(e)
  }
}
