import { authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as maint from '@/lib/maintenance'

/**
 * Call off a scheduled or draining window.
 *
 * CANCELLING WHILE DRAINING IS THE IMPORTANT CASE, and it is the reason there
 * is no "extend". A window that turns out to be badly timed — a full server, an
 * event nobody told you about — needs to stop turning players away *now*, and
 * cancelling does exactly that: the next tick sees no live window and the game
 * starts accepting connections again.
 *
 * Rescheduling afterwards is a fresh window with a fresh row and a fresh audit
 * entry, which reads better in the log than one window whose times moved twice.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  try {
    const { actor } = await authorize('process', 'write')

    const w = await maint.current()
    if (!maint.isLive(w)) {
      return Response.json(
        { ok: false, error: 'There is no maintenance window to cancel.' },
        { status: 404 },
      )
    }

    // A window already deploying cannot be called off — the command has gone to
    // the game host and the restart is happening. Saying so is better than
    // accepting a cancel that changes nothing.
    if (w.state === 'deploying') {
      return Response.json(
        {
          ok: false,
          error: 'The deploy has already started. It cannot be cancelled now.',
        },
        { status: 409 },
      )
    }

    await audit.audited(
      {
        action: 'maintenance.cancel',
        actor,
        reason: w.note,
        detail: { wasState: w.state },
      },
      () => maint.cancel({ by: actor.license, byName: actor.name }),
    )

    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
