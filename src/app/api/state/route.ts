import { auth } from '@/auth'
import { liveView } from '@/lib/state'

/**
 * What the dashboard polls.
 *
 * SESSION-GUARDED, unlike /api/ingest — this is the read side, for browsers.
 * The middleware's cookie sniff runs first as the cheap bounce; this auth()
 * call is the real check, against the session record in DynamoDB, same as
 * every page. A 401 here is what the poller sees when a session is revoked
 * mid-shift, and it fails quiet: the board keeps its last data and the feed
 * chip ages honestly until the next navigation bounces to login.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false }, { status: 401 })
  }

  const now = Date.now()
  return Response.json({ view: liveView(now), now })
}
