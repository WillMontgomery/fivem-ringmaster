import { cookies } from 'next/headers'
import { z } from 'zod'

import { ActionError, authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as maint from '@/lib/maintenance'
import { ensureDriver, tick } from '@/lib/maintenanceDriver'
import { readPrefs } from '@/lib/prefs'
import { isParkedOffMain } from '@/lib/ssh'
import { liveView } from '@/lib/state'
import { hostView, refreshDeployedRef } from '@/lib/telemetry'
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
    await authorize('view', 'read')
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
    const { actor } = await authorize('process', 'write')

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

    const existing = await maint.current()

    /**
     * IS THE BOX PARKED ON A BRANCH RIGHT NOW?
     *
     * Read from the telemetry poller's in-memory snapshot, which is the same
     * thing the driver reads and costs nothing — no SSH call of our own for a
     * fact that is already sitting in memory, refreshed every fifteen seconds.
     *
     * `isParkedOffMain`, NEVER `!isOnMain`, and lib/ssh states the rule this
     * follows: `isOnMain` folds "the host has not answered" in with "off main"
     * because it gates the automation, which must fail towards doing nothing.
     * This decides what a HUMAN IS ALLOWED TO ASK FOR, so it folds a silent
     * host in with main and leaves a game box whose dispatcher predates branch
     * switching behaving in every respect as it did before.
     *
     * The cold-start edge fails in the safe direction on purpose: a console
     * that has not yet heard from the host reads `parked` as false and this
     * route stays as strict as it was. It cannot strand anyone, because the
     * button that sends an unpinned refresh is only rendered once the host has
     * stated a ref — the page and this route read the same snapshot, so the
     * offer and the acceptance cannot disagree.
     */
    /**
     * RE-RESOLVE THE DESTINATION BEFORE ANY OF IT IS READ.
     *
     * THE OWNER'S REPORT, AND THE ONE MOMENT IT COULD HAVE BEEN CAUGHT: "it's
     * misleading to say we're going from X to Y but we actually end up on Z,
     * which is the latest." Everything below — the gates, the note, and the
     * commit written onto the row as `shownSha` — reads the telemetry poller's
     * snapshot, whose `updateTarget` is refreshed on a two-minute throttle. A
     * button press is the instant that reading stops being decoration and starts
     * being a claim, so it is the instant to pay a `branches` call for.
     *
     * ONCE PER PRESS, WHICH IS NOT A POLL. `/api/host` is read by every open tab
     * every five seconds and makes no SSH call of its own precisely so the game
     * box does not pay for browser tabs. This is a human scheduling a restart, a
     * handful of times a week, and it costs one bounded round trip.
     *
     * FAILURE IS NOT A REFUSAL. `refreshDeployedRef` swallows its own errors and
     * keeps the last reading, so a game box that cannot be reached leaves this
     * route exactly as strict as it was rather than turning "we could not check"
     * into "you may not deploy" — which is WillMontgomery/fivem-br-gamemode#146's
     * shape and the failure every gate below is written to avoid.
     */
    await refreshDeployedRef()

    const { status: hostStatus, refUpdate, updateTarget } = hostView()
    const parked = isParkedOffMain(hostStatus)

    /**
     * HOW FAR BEHIND MAIN, OR NULL FOR "THE HOST HAS NOT SAID".
     *
     * READ FROM THE HOST SNAPSHOT, NOT OFF THE ROW, and that is the change that
     * makes "not yet known" expressible at all. `existing?.updateAvailable ?? 0`
     * had no way to say it: a console whose poller has not answered, and a
     * console with no maintenance row at all, both arrived here as the number
     * zero — which `nothingToDeploy` then read as a KNOWN zero and refused. The
     * row is the driver's copy of this same number, one tick behind it and
     * written only when the driver knew something; the snapshot is the number
     * itself, and its absence is legible as absence.
     *
     * IT IS STILL THE SAME READING THE PANEL USES. `/api/host` hands the panel
     * this exact object and the panel runs `behindMainNow` over it, so the card
     * on the page and the acceptance here are one function over one snapshot,
     * skewed by at most a poll interval. Card present, request accepted; card
     * absent, request refused — unchanged, and now true in the unknown case too,
     * where both sides say "go ahead".
     */
    const behindMain = maint.behindMainNow(hostStatus)

    /**
     * NOTHING TO DEPLOY, NOTHING TO SCHEDULE.
     *
     * A maintenance window with no update behind it costs a restart and every
     * match in progress, and delivers exactly the code that was already
     * running. There is no version of that which is what somebody meant.
     *
     * THE RULE IS NOT WRITTEN HERE, ON PURPOSE. `nothingToDeploy` in
     * lib/maintenance is the single copy, and MaintenancePanel calls the same
     * function to decide whether the scheduling card is on the page at all. The
     * two decisions are the same decision: if the card is there this must
     * accept, and if this would refuse the card must not be. Restating the
     * condition here — even correctly, even once — is how those two drift.
     *
     * WHAT IT REFUSES IS A KNOWN ZERO, on whichever ref the box is on. Off main
     * that is `refUpdate`, the distance from the tip of the branch the box is
     * actually running, which the poller reads off the `branches` verb on its
     * own slow cadence (lib/telemetry). Every way of NOT having that number —
     * host silent, branch deleted from the remote, console booted a minute ago,
     * the box's own fetch timed out — comes back as null and is allowed
     * through, because refusing a deploy on the strength of a number we do not
     * have is WillMontgomery/fivem-br-gamemode#146 with a better excuse. A ref
     * change is allowed through as well; see the function.
     *
     * IT READS THE SAME SNAPSHOT THE PAGE DOES. `hostView()` is the telemetry
     * poller's in-memory object, and `/api/host` hands the panel that same
     * object — so the offer and the acceptance are computed from one reading by
     * one function, and can differ only by a poll interval of skew that
     * resolves itself.
     *
     * The automatic path is NOT relaxed or tightened by any of this. It lives
     * in the driver behind `onMain && behind !== null && behind > 0` and stays
     * exactly where it is: the rule is that automatic updates require main, not
     * that deploying requires main. Nothing derived from `refUpdate` is written
     * to the maintenance row, and `behindMain` above still means distance from
     * main and nothing else — it is now read from the host snapshot rather than
     * from the row's copy of it, which is the same number a tick fresher and,
     * unlike the row, able to say that nobody has measured it yet.
     */
    const noDeploy = maint.nothingToDeploy({
      behindMain,
      deployedRef: hostStatus?.deployedRef ?? null,
      refUpdate,
      changingRef: Boolean(input.targetRef),
    })
    if (noDeploy) {
      throw new ActionError(noDeploy.reason, 409)
    }

    /**
     * AND WOULD THE BOX ACTUALLY TAKE IT? A SEPARATE QUESTION FROM WHETHER
     * ANYTHING IS WAITING.
     *
     * `tools/dispatch.sh` refuses a ref that changes `tools/dispatch.sh`, and it
     * says so per branch in the `branches` answer this snapshot was built from.
     * Until now only the branch picker read that: an update of the branch the
     * box is already on picks no branch, so nothing consulted eligibility and
     * the refusal arrived as a failed deploy in a systemd log. A window
     * scheduled for later is the same bug with a delay on it and nobody
     * watching when it fires, which is why this refuses at scheduling time
     * rather than leaving it to the driver.
     *
     * SAME FUNCTION AS THE PAGE, SAME SNAPSHOT, exactly as `nothingToDeploy`
     * above: `refBlockedNow` greys the panel's button and refuses here, so a
     * disabled control and a 409 cannot come apart. The rule itself — a stated
     * refusal only, staleness not consulted, a reading paired to its own ref —
     * is in lib/maintenance and is not restated here.
     *
     * ONLY FOR AN UNPINNED UPDATE, AND THAT GUARD IS LOAD-BEARING. `refUpdate`
     * describes the ref the box is ON. A request carrying `targetRef` is a
     * SWITCH to a different ref, which the picker has already gated on that
     * branch's own `eligible` and which `switchref` checks again on the box —
     * and gating it on the current branch's verdict would refuse the one action
     * that gets an operator OFF a branch the box will not deploy, including
     * "Revert to main". A blocked branch must never be a branch nobody can
     * leave.
     *
     * THE SENTENCE IS THE BOX'S, in the register the revert path already uses
     * for the same fact (`MaintenancePanel`'s `revert`).
     */
    if (!input.targetRef) {
      const refBlocked = maint.refBlockedNow(
        hostStatus?.deployedRef ?? null,
        refUpdate,
      )
      if (refBlocked !== null) {
        throw new ActionError(
          `${hostStatus?.deployedRef} cannot be deployed right now: ${refBlocked}`,
          409,
        )
      }
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

    /**
     * NULL WHENEVER THE AUTOMATION CANNOT FIRE, not merely when the row has no
     * timestamp on it.
     *
     * The driver schedules its own window only on `onMain && behind > 0`, so
     * with no update pending there is no automatic window for a chosen deploy
     * time to collide with — and refusing a time against a deadline that will
     * never arrive would be refusing for a reason that does not exist. That is
     * not hypothetical on a parked box: `updateAvailable` is held at zero while
     * the server runs a branch, but a stale `updateFirstSeenAt` can still be
     * sitting on the row until the next driver tick clears it, which would make
     * a timed refresh of the parked branch fail with a sentence about an
     * automatic update that is not coming.
     *
     * AND NULL WHEN THE DISTANCE IS UNKNOWN, for the same reason. The driver's
     * gate is now `onMain && behind !== null && behind > 0`; a tick that does not
     * know the distance schedules nothing, so there is no deadline to collide
     * with and no reason to refuse a time against one. `behindMain !== null &&
     * behindMain > 0` is that gate, spelled the same way.
     */
    const deadline =
      behindMain !== null && behindMain > 0
        ? maint.autoDeadline(existing?.updateFirstSeenAt)
        : null
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

    /**
     * THE COMMIT THE PAGE WAS NAMING WHEN THIS REQUEST WAS MADE.
     *
     * THROUGH `updateTargetNow`, NOT OFF THE SNAPSHOT DIRECTLY, and that is the
     * same rule every other reading in this route follows: the page renders what
     * that function returns, so recording anything else would write down a claim
     * the operator was never shown. It withholds a pair belonging to another
     * branch, a pair pointing at itself, and — since the fix this change is part
     * of — a reading too old to stand behind. Each of those is a state in which
     * the card showed NO arrow, and null here says exactly that.
     *
     * NULL FOR A SWITCH, DELIBERATELY. A request carrying `targetRef` is pinned:
     * `targetSha` is a promise the game box ENFORCES — `switchref` refuses if the
     * branch has moved, and `deploy.sh` refuses again — so it is a stronger
     * record than a reading, and it is already on the row. Writing a second,
     * weaker commit beside it would invite a comparison against the wrong one.
     */
    const shownSha = input.targetRef
      ? null
      : (maint.updateTargetNow(hostStatus?.deployedRef, updateTarget)?.toSha ??
        null)

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
          /**
           * WHICH REF AN UNPINNED UPDATE WAS AIMED AT, for the windows that
           * carry no `targetRef` at all.
           *
           * Null on main, where it would only ever repeat itself. Off main it
           * is the whole answer to "what did that restart ship", because an
           * update of a parked branch is a thing an admin can schedule and
           * `targetRef` is deliberately null for it — that field means "switch
           * the box to this", and writing the current ref into it would turn an
           * update into a pinned switch on the driver's side.
           *
           * THE KEY IS STILL SPELLED `refreshingRef` THOUGH THE UI NO LONGER
           * SAYS "REFRESH", and that is on purpose. It is an audit detail key,
           * not a label: rows carrying it are already in the log, the driver
           * writes the identical key on the deploy row (lib/maintenanceDriver),
           * and renaming it here alone would split one field into two that no
           * query joins. Audit keys are data whose value is that they do not
           * move; the word an operator reads is on the page.
           *
           * SEPARATELY, IT IS NOT A SHA AND MUST NOT BE READ AS ONE. An update
           * takes the branch's tip whenever the deploy fires, which may be a
           * commit that did not exist when this row was written. It records the
           * ref that was intended, not the code that landed.
           */
          refreshingRef:
            !input.targetRef && parked ? (hostStatus?.deployedRef ?? null) : null,
          /**
           * AND THE COMMIT THE PAGE NAMED WHEN THIS BUTTON WAS PRESSED — the
           * other half of the sentence the log could never finish. `refreshingRef`
           * above says which branch; this says which commit the operator was
           * looking at while deciding, so "what did the console promise" is
           * answerable from the row rather than from somebody's memory of a card
           * that was replaced the moment they clicked.
           *
           * IT IS A CLAIM, NOT A TARGET. Nothing deploys it. See
           * `MaintenanceWindow.shownSha` for why that distinction is the whole
           * point of recording it at all.
           */
          shownSha,
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
          shownSha,
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
