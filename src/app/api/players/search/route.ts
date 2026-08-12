import { authorize, errorResponse } from '@/lib/actions'
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
    const rows = searchDirectory(q, 10).map((e) => ({
      license: e.license,
      name: e.name,
      lastSeen: e.lastSeen,
      online: isOnline(e.license),
    }))

    return Response.json({ ok: true, players: rows })
  } catch (e) {
    return errorResponse(e)
  }
}
