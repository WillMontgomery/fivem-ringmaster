import { z } from 'zod'

import { ActionError, authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as maint from '@/lib/maintenance'
import { ensureDriver, tick } from '@/lib/maintenanceDriver'
import { liveView } from '@/lib/state'

/**
 * Read and schedule the maintenance window.
 *
 * GUARDED BY `process`, not `config`. The scopes were split precisely here: a
 * bad config edit degrades a match, a bad process action ends one for everyone
 * on the box. Scheduling maintenance is the second kind — it will restart the
 * server — so it needs the scope that says so.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const scheduleSchema = z
  .object({
    /** Shown to players turned away at the door while draining. */
    note: z
      .string()
      .trim()
      .min(5, 'Say what the maintenance is for — players see this.')
      .max(200),
    /** Minutes from now until the server stops accepting players. */
    drainInMinutes: z.number().int().min(0).max(1440),
    deployMode: z.enum(['when-empty', 'at-time']),
    /** Absolute epoch ms, only for at-time. */
    deployAt: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (v) => v.deployMode !== 'at-time' || typeof v.deployAt === 'number',
    { message: 'Choose a time for the deploy.', path: ['deployAt'] },
  )

export async function GET(): Promise<Response> {
  try {
    await authorize('view')
    ensureDriver()
    const w = await maint.current()
    return Response.json({
      ok: true,
      window: w,
      players: liveView(Date.now()).counts.connected,
    })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('process')

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = scheduleSchema.parse(body)

    const now = Date.now()
    const drainStartsAt = now + input.drainInMinutes * 60_000

    if (input.deployMode === 'at-time' && input.deployAt! <= drainStartsAt) {
      throw new ActionError(
        'The deploy time has to be after draining starts, or nobody gets a chance to finish.',
      )
    }

    const w = await audit.audited(
      {
        action: 'maintenance.schedule',
        actor,
        reason: input.note,
        detail: {
          drainStartsAt,
          deployMode: input.deployMode,
          deployAt: input.deployAt ?? null,
        },
      },
      () =>
        maint.schedule({
          createdBy: actor.license,
          createdByName: actor.name,
          note: input.note,
          drainStartsAt,
          deployMode: input.deployMode,
          deployAt: input.deployAt ?? null,
        }),
    )

    // Evaluate immediately rather than leaving the operator watching a badge
    // that updates in fifteen seconds — a window scheduled for "now" should be
    // draining by the time the page re-renders.
    ensureDriver()
    void tick()

    return Response.json({ ok: true, window: w }, { status: 201 })
  } catch (e) {
    // schedule() throws a plain Error when a window is already live; that is an
    // operator-facing message, not an internal one.
    if (e instanceof Error && e.message.includes('already scheduled')) {
      return Response.json({ ok: false, error: e.message }, { status: 409 })
    }
    return errorResponse(e)
  }
}
