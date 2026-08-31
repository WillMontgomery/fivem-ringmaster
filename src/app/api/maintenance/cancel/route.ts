import { authorizeWrite, errorResponse } from '@/lib/actions'
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

export async function POST(req: Request): Promise<Response> {
  try {
    /**
     * EITHER DOOR — a session, or `blitz-bot`'s `/drain cancel` presenting the
     * service credential and the Discord id of the admin who ran it
     * (lib/service.ts).
     *
     * THE PAIR IS THE POINT: `/drain` schedules through `POST /api/maintenance`
     * and calls off through here, and a bot that can start a window but not stop
     * one leaves the admin who started it with no way back — which is the state
     * this route was in until now, answering `Not signed in` to the bot.
     *
     * NOTHING BELOW MOVES. The credential authorises the CALLER, not the action:
     * the "no window to cancel" 404 and the "already deploying" 409 run exactly
     * as they did, on the same code, in the same order, and the audit row names
     * the human the bot relayed for.
     *
     * `req` IS TAKEN ONLY TO BE READ AS A CREDENTIAL. This handler still parses
     * no body — there is nothing to say about cancelling but which window, and
     * there is only ever one.
     */
    const { actor } = await authorizeWrite('process', req)

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
