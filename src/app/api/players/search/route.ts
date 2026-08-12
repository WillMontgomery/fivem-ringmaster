import { authorize, errorResponse } from '@/lib/actions'
import * as players from '@/lib/players'
import { isOnline, searchDirectory } from '@/lib/state'

/**
 * Player search, for the command palette.
 *
 * SEARCHES EVERYONE THE CONSOLE HAS SEEN, not just who is connected. The
 * palette used to read the live snapshot directly, which meant looking somebody
 * up after they logged off — the ordinary reason to look somebody up — returned
 * nothing at all.
 *
 * Capped server-side as well as in the UI. The cap is a product decision (a
 * shortlist, not a report) and product decisions that live only in a component
 * stop being true the first time something else calls the endpoint.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  try {
    await authorize('view')

    const q = new URL(req.url).searchParams.get('q') ?? ''

    /**
     * THE REGISTRY FIRST, THE SESSION DIRECTORY AS A FALLBACK.
     *
     * The registry is durable and covers everyone ever seen; the in-memory
     * directory covers only this console's uptime. Preferring the registry
     * means a search works after a console restart, which is the whole reason
     * it exists — but falling back keeps search working before the table has
     * been created, and during the window after a fresh deploy when nobody has
     * reconnected yet to be recorded.
     */
    let rows: Array<{
      license: string
      name: string
      lastSeen: number
      online: boolean
    }> = []

    try {
      rows = (await players.search(q, 10)).map((p) => ({
        license: p.license,
        name: p.preferredName || p.name,
        lastSeen: p.lastSeen,
        online: isOnline(p.license),
      }))
    } catch {
      /* table missing or unreachable — fall through to the session directory */
    }

    if (rows.length === 0) {
      rows = searchDirectory(q, 10).map((e) => ({
        license: e.license,
        name: e.name,
        lastSeen: e.lastSeen,
        online: isOnline(e.license),
      }))
    }

    return Response.json({ ok: true, players: rows })
  } catch (e) {
    return errorResponse(e)
  }
}
