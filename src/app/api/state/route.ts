import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { isIdle } from '@/lib/activity'
import { IDLE_ERROR_CODE } from '@/lib/idle'
import { liveView } from '@/lib/state'

/**
 * What the dashboard polls.
 *
 * SESSION-GUARDED, unlike /api/ingest — this is the read side, for browsers.
 * This auth() call is the whole check, against the session record in DynamoDB,
 * same as every page. The middleware does NOT run in front of it: its matcher
 * excludes all of /api, deliberately, because a redirect is the wrong answer
 * for a poller (it would follow the 307, get HTML with a 200, and choke parsing
 * it as JSON). An earlier version of this comment claimed the cookie sniff ran
 * first, which was never true.
 *
 * A 401 here is what the poller sees when a session is revoked mid-shift, and
 * it fails quiet: the board keeps its last data and the feed chip ages honestly
 * until the next navigation bounces to login.
 *
 * THE IDLE CHECK IS NOT OPTIONAL HERE. This is the highest-frequency endpoint
 * in the app at one call every two seconds. Left unchecked it would be the one
 * place a session that has already timed out could still read live player data
 * indefinitely — and note that answering the poll does NOT extend the window.
 * Requests are not activity; see lib/idle.ts.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false }, { status: 401 })
  }

  if (isIdle(await cookies())) {
    return Response.json({ ok: false, code: IDLE_ERROR_CODE }, { status: 401 })
  }

  const now = Date.now()
  return Response.json({ view: liveView(now), now })
}
