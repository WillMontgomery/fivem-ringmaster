import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { isIdle } from '@/lib/activity'
import { IDLE_ERROR_CODE } from '@/lib/idle'
import { maintenanceView } from '@/lib/maintenanceDriver'
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
 * it fails quiet: the board keeps its last data until the next navigation
 * bounces to login.
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

  /**
   * THE MAINTENANCE PHASE RIDES THIS POLL RATHER THAN GETTING ITS OWN.
   *
   * The header chips need two facts to decide whether the server's silence is
   * explained: how old the feed is, and whether a deploy is running. The first
   * is already here on a two-second cadence. Giving the second its own poller
   * would double the console's request rate to learn a value that changes a
   * handful of times a week — and worse, the two would then be sampled at
   * different moments, so the chip could compare a fresh `lastPushAt` against a
   * stale `completedAt` and flip the wrong way at exactly the transition it
   * exists to get right. One payload, one instant, one decision.
   *
   * IT COSTS NO DATABASE READ. `maintenanceView` hands out what the driver last
   * read on its own fifteen-second tick — the same in-memory pattern as
   * `hostView` — so this is a property access, not a GetItem per poll per
   * console.
   */
  const m = maintenanceView(now)

  return Response.json({
    view: liveView(now),
    now,
    maintenance: {
      state: m.window?.state ?? null,
      completedAt: m.window?.completedAt ?? null,
      badge: m.badge,
      /** 0 = the driver has never read the row. Absence, not "no window". */
      at: m.at,

      /**
       * THE THREE FIELDS THE COMPLETION GATE NEEDS, riding the same payload as
       * `view.bootEpoch` and `view.lastPushAt` that they are compared against.
       *
       * ONE PAYLOAD, ONE INSTANT, ONE DECISION — the same argument as the block
       * above. `deployPhase` compares the boot epoch the console is hearing now
       * against the one recorded when the deploy fired; sampling those two from
       * different responses would let a fresh epoch meet a stale record of the
       * old one and declare a server back before it is.
       */
      deployError: m.window?.deployError ?? null,
      deployBootEpoch: m.window?.deployBootEpoch ?? null,
      deployConfirmedAt: m.window?.deployConfirmedAt ?? null,
    },
  })
}
