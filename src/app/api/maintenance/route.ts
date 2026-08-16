import { cookies } from 'next/headers'
import { z } from 'zod'

import { ActionError, authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as maint from '@/lib/maintenance'
import { ensureDriver, tick } from '@/lib/maintenanceDriver'
import { readPrefs } from '@/lib/prefs'
import { liveView } from '@/lib/state'
import { formatInstant } from '@/lib/time'

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
    /**
     * Shown to players turned away at the door.
     *
     * OPTIONAL AND USUALLY ABSENT. The console generates it from the commit
     * count, because a maintenance window is always the same thing -- deploy
     * the update -- and asking somebody to type that every time produces
     * either the same sentence or an empty one.
     */
    note: z.string().trim().max(200).optional(),
    /** Minutes from now until the server stops accepting players. */
    drainInMinutes: z.number().int().min(0).max(1440),
    deployMode: z.enum(['when-empty', 'at-time']),
    /** Absolute epoch ms, only for at-time. */
    deployAt: z.number().int().positive().nullable().optional(),

    /**
     * Deploy a branch other than the one the box is on.
     *
     * BOTH OR NEITHER, ENFORCED BELOW. A ref with no sha is a request to deploy
     * "whatever that branch is when we get round to it", which is the exact
     * thing the sha exists to prevent — the window can sit for hours and anyone
     * with push access can move the branch in the meantime.
     */
    targetRef: z.string().trim().max(120).optional(),
    targetSha: z.string().trim().optional(),
  })
  .refine(
    (v) => v.deployMode !== 'at-time' || typeof v.deployAt === 'number',
    { message: 'Choose a time for the deploy.', path: ['deployAt'] },
  )
  .refine((v) => Boolean(v.targetRef) === Boolean(v.targetSha), {
    message: 'A branch has to be sent with the exact commit it was chosen at.',
    path: ['targetSha'],
  })

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

    /**
     * A REF CHANGE IS VALIDATED HERE AND ENFORCED ON THE BOX.
     *
     * Neither of these checks is the boundary — `tools/dispatch.sh` validates
     * the name as a raw string before git sees it, and `tools/deploy.sh` does
     * the whole thing again on the pin file it reads. They exist so a typo or a
     * stale page is refused with a sentence an admin can act on, rather than
     * travelling to the game host to come back as an SSH error.
     */
    if (input.targetRef && !maint.isUsableRef(input.targetRef)) {
      throw new ActionError(`"${input.targetRef}" is not a usable branch name.`)
    }
    if (input.targetSha && !maint.isFullSha(input.targetSha)) {
      throw new ActionError(
        'A branch has to be pinned to a full commit id. Reload the page and pick it again.',
      )
    }

    /**
     * NOTHING TO DEPLOY, NOTHING TO SCHEDULE.
     *
     * A maintenance window with no update behind it costs a restart and every
     * match in progress, and delivers exactly the code that was already
     * running. There is no version of that which is what somebody meant.
     *
     * A REF CHANGE IS EXEMPT, AND HAS TO BE. `updateAvailable` measures the
     * distance from main; switching branch changes WHICH CODE runs, not how
     * current it is. Without this exemption the two cases that matter most both
     * fail: reverting to main from a parked branch sitting at main's tip
     * (behind is 0, so "there is nothing to deploy" — while the box is visibly
     * running something else), and switching between two branches that are both
     * level with main.
     */
    const existing = await maint.current()
    const behind = existing?.updateAvailable ?? 0
    if (behind <= 0 && !input.targetRef) {
      throw new ActionError(
        'The server is already running the latest code — there is nothing to deploy.',
        409,
      )
    }

    if (input.deployMode === 'at-time' && input.deployAt! <= drainStartsAt) {
      throw new ActionError(
        'The deploy time has to be after draining starts, or nobody gets a chance to finish.',
      )
    }

    /**
     * A DEPLOY TIME PAST THE AUTOMATIC DEADLINE WOULD NEVER HAPPEN. The
     * automation schedules its own window once an update has waited 72 hours,
     * and that window would run first — so a later choice here is not a longer
     * delay, it is a setting that silently does nothing. Refusing it with the
     * reason is better than accepting it and being wrong later.
     *
     * THE TIME IN THAT SENTENCE IS THE READER'S, NOT THE CONTAINER'S. This was
     * a bare `toLocaleString()` — no options at all, so both the locale and the
     * timezone came from the Node process. It told an admin which deploy times
     * were legal, in the server's zone, with nothing saying so; the operator
     * would read a time five hours off, pick something "earlier", and be
     * refused again. Read from the request cookies here because a route handler
     * has no `PrefsProvider` above it.
     */
    const prefs = readPrefs(await cookies())
    const deadline = maint.autoDeadline(existing?.updateFirstSeenAt)
    if (
      input.deployMode === 'at-time' &&
      deadline !== null &&
      input.deployAt! > deadline
    ) {
      throw new ActionError(
        `That is after ${formatInstant(deadline, prefs)}, when this update ` +
          `is scheduled automatically because it will have been waiting 72 hours. ` +
          `Pick an earlier time, or let the automation handle it.`,
      )
    }

    // Generated rather than typed, unless somebody supplied one. Players see
    // this at the door, so it says what is happening in their terms — not
    // "3 commits behind main", which means nothing to them.
    const noteText =
      input.note && input.note.length > 0
        ? input.note
        : 'a server update'

    const w = await audit.audited(
      {
        action: 'maintenance.schedule',
        actor,
        reason: noteText,
        detail: {
          drainStartsAt,
          deployMode: input.deployMode,
          deployAt: input.deployAt ?? null,
          /**
           * THE BRANCH GOES IN THE AUDIT DETAIL, NOT IN `note`. `note` is shown
           * to players turned away at the door, and "deploying feature/loot-v2"
           * means nothing to somebody who wants to know when they can play. The
           * audit log is where "which code did we put on the box, and who chose
           * it" belongs, and it needs the sha as well as the name — a branch
           * name alone stops identifying anything the moment the branch moves.
           */
          targetRef: input.targetRef ?? null,
          targetSha: input.targetSha ?? null,
        },
      },
      () =>
        maint.schedule({
          createdBy: actor.license,
          createdByName: actor.name,
          note: noteText,
          drainStartsAt,
          deployMode: input.deployMode,
          deployAt: input.deployAt ?? null,
          targetRef: input.targetRef ?? null,
          targetSha: input.targetSha ?? null,
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
