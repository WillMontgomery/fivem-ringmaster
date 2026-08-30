import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  licenseSchema,
  reasonSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as bans from '@/lib/bans'
import * as incidents from '@/lib/incidents'
import { kickPlayer, sshConfigured } from '@/lib/ssh'
import { liveView } from '@/lib/state'

/**
 * Bans: list and issue.
 *
 * THE FIRST WRITE PATH IN THIS APPLICATION. Everything before it was read-only
 * by construction, which is what made the read-before-write slice worth doing:
 * the whole observation surface was proven against a live server before
 * anything could change one.
 *
 * A ban here is a RECORD ONLY. Writing the row does not remove anyone from the
 * server — enforcement happens when the banned license next connects and the
 * game host checks this table, and kicking someone already connected is a
 * separate action on a separate route. Issuing a ban against a player who is
 * online right now therefore does nothing visible until they reconnect, and
 * the UI says so rather than implying otherwise.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const issueSchema = z.object({
  license: licenseSchema,
  reason: reasonSchema,
  playerName: z.string().trim().max(120).optional().nullable(),
  /**
   * Days from now, or null/absent for permanent.
   *
   * A DURATION FROM THE CLIENT, converted to an absolute expiry HERE. Letting
   * the browser send `expiresAt` would let a clock-skewed or hostile client
   * pick a timestamp in the past and produce a ban that was never in force.
   */
  days: z.number().int().positive().max(3650).optional().nullable(),

  /**
   * The incident this ban is the verdict on, when it was issued from one.
   *
   * ONE BAN, ONE SHAPE, ONE AUDIT ACTION. A ban chosen as an incident verdict
   * is not a different kind of ban — it is this route, this schema, this
   * `ban.issue` row, with an extra field naming where the decision was made.
   * The alternative was a second endpoint under /api/incidents that also issued
   * bans, and an audit log with two ways to say one thing is the failure mode
   * this console has already paid for once.
   *
   * ABSENT IS THE ORDINARY CASE. The profile page and the moderation board send
   * nothing here and nothing changes for them.
   */
  incidentId: z.string().uuid().optional(),
})

export async function GET(): Promise<Response> {
  try {
    // A READ, so no Discord round trip — see `ActionIntent` in lib/actions.
    // The label is for the audit log and authorises nothing.
    await authorize('view', 'read')
    return Response.json({ ok: true, bans: await bans.all() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('ban', 'write')

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = issueSchema.parse(body)

    const existing = await bans.banFor(input.license)
    if (existing && bans.isActive(existing)) {
      throw new ActionError('That license is already banned.', 409)
    }

    /**
     * REFUSE BEFORE BANNING IF THE CASE IS ALREADY CLOSED.
     *
     * Checked here rather than after, because the alternative is a ban nobody
     * asked for: two admins on the same incident, the other one resolves it as
     * "no action", and this request would otherwise cut somebody off for a case
     * that had already been decided the other way.
     *
     * THE RACE IS NARROWED, NOT CLOSED, and the residual is deliberate. If the
     * other admin's write lands between this read and the resolve below, the
     * BAN STILL STANDS and the incident carries their verdict. That asymmetry
     * is the right way round: the ban is a real thing that happened to a real
     * person and it is in the audit log and on their profile either way, while
     * a verdict claiming a ban that never happened would have #168 pay 250
     * Volts against nothing. Ban first, record second, and never the reverse.
     */
    if (input.incidentId) {
      const incident = await incidents.get(input.incidentId)
      if (!incident) {
        throw new ActionError('That incident no longer exists.', 404)
      }
      if (incident.state !== 'pending_review') {
        throw new ActionError(
          'That incident has already been resolved, so no ban was issued.',
          409,
        )
      }
    }

    const expiresAt =
      input.days == null ? null : Date.now() + input.days * 86_400_000

    const ban = await audit.audited(
      {
        action: 'ban.issue',
        actor,
        targetLicense: input.license,
        targetName: input.playerName ?? null,
        reason: input.reason,
        detail: {
          expiresAt,
          permanent: expiresAt === null,
          // PROVENANCE, NOT A SECOND SHAPE. Same action, same fields, plus
          // where it was decided — the same thing `becauseOf` does for the
          // kick below.
          ...(input.incidentId ? { incidentId: input.incidentId } : {}),
        },
      },
      () =>
        bans.issue({
          license: input.license,
          by: actor.license,
          byName: actor.name,
          reason: input.reason,
          expiresAt,
          playerName: input.playerName ?? null,
        }),
    )

    /**
     * If they are on the server right now, remove them immediately.
     *
     * WITHOUT THIS A BAN IS A PROMISE ABOUT THEIR NEXT LOGIN. The connect gate
     * only runs at connect, so banning someone mid-match left them playing —
     * which is exactly backwards for the case bans are usually issued in, where
     * an admin is watching somebody ruin a match right now.
     *
     * IT NEVER FAILS THE BAN. The record is the source of truth and it is
     * already written; the kick is enforcement of it. If the channel is down,
     * the ban still stands and the connect gate catches them next time — so a
     * failed kick is reported alongside a successful ban rather than turning
     * the whole request into an error the admin would retry, double-writing
     * the audit log.
     */
    const online = liveView(Date.now()).players.some(
      (p) => p.license === input.license,
    )

    let kicked: { attempted: boolean; ok: boolean; error?: string } = {
      attempted: false,
      ok: false,
    }

    if (online && sshConfigured()) {
      const { commandId, ts } = await audit.begin({
        action: 'player.kick',
        actor,
        targetLicense: input.license,
        targetName: input.playerName ?? null,
        reason: input.reason,
        detail: { becauseOf: 'ban.issue' },
      })

      try {
        // The message the player sees as they are dropped. Same words as the
        // connect gate uses, so being removed and being refused read alike.
        const msg =
          expiresAt === null
            ? `Banned: ${input.reason}`
            : `Banned until ${new Date(expiresAt).toISOString().slice(0, 16).replace('T', ' ')} UTC: ${input.reason}`

        const res = await kickPlayer(input.license, msg, commandId)
        if (!res.ok) throw new Error(res.error ?? 'kick refused')

        // ACCEPTED, not confirmed. The real outcome arrives as an event
        // carrying this commandId; until it does the row stays honest about
        // not knowing.
        kicked = { attempted: true, ok: true }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await audit.resolve(ts, 'failed', message)
        kicked = { attempted: true, ok: false, error: message }
      }
    }

    /**
     * Now record it as the verdict on the case it came from.
     *
     * LAST, AND UNABLE TO UNDO ANYTHING BEFORE IT. Everything above already
     * happened to a person; this only writes down why. So a refusal here — the
     * other admin won the race described above — is reported alongside a
     * successful ban rather than turned into an error, exactly as the failed
     * kick is. The admin is told the ban stands and the case was closed by
     * somebody else, which is both true and actionable.
     *
     * THE VERDICT IS DERIVED FROM WHAT ACTUALLY HAPPENED, not from what was
     * asked for: `expiresAt` is the absolute value this route computed, not the
     * `days` the browser sent. Nothing a client says ends up in the field #168
     * pays against.
     */
    let incident: { closed: boolean; error?: string } | undefined
    if (input.incidentId) {
      const row = await incidents.get(input.incidentId)
      const res = row
        ? await incidents.closeWithVerdict({
            incident: row,
            actor,
            resolution: input.reason,
            verdict: { action: 'ban', expiresAt },
          })
        : ({ ok: false, reason: 'That incident no longer exists.' } as const)

      incident = res.ok ? { closed: true } : { closed: false, error: res.reason }
    }

    /**
     * And close every OTHER case about them, if this ban is permanent.
     *
     * LAST OF ALL, FOR THE REASON EVERYTHING ELSE HERE IS ORDERED. This is the
     * only step that can touch cases the admin never opened, it cannot undo a
     * single thing above it, and it never throws — a sweep that failed must not
     * turn a successful ban into an error the admin retries.
     *
     * WHAT DECIDES "PERMANENT" IS `ban.expiresAt`, the value on the row that was
     * actually written, and the check lives inside the sweep rather than in an
     * `if` here — one place, testable, and not something a second caller could
     * get subtly wrong. A temporary ban reads nothing and writes nothing.
     *
     * THE INCIDENT IT CAME FROM IS EXCLUDED BY ID. It was closed above with the
     * admin's own reason and its own verdict; it is not one of the "others".
     */
    const alsoClosed = await incidents.closeOthersOnPermanentBan({
      ban,
      fromIncidentId: input.incidentId ?? null,
      actor,
    })

    return Response.json(
      {
        ok: true,
        ban,
        online,
        kicked,
        incident,
        /**
         * REPORTED ONLY WHEN IT DID SOMETHING OR TRIED TO. On the overwhelming
         * majority of bans there are no other open cases, and a field reading
         * "closed 0 of 0" on every response is furniture the browser then has to
         * decide not to mention.
         */
        ...(alsoClosed.permanent &&
        (alsoClosed.found > 0 || alsoClosed.lookupFailed)
          ? { alsoClosed }
          : {}),
      },
      { status: 201 },
    )
  } catch (e) {
    return errorResponse(e)
  }
}
