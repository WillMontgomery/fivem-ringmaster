import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  licenseSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as incidents from '@/lib/incidents'
import { kickPlayer, sshConfigured } from '@/lib/ssh'

/**
 * Remove a connected player, without banning them.
 *
 * IT USED TO TAKE A SCOPE OF ITS OWN, on the grounds that kicking is the
 * reversible act — they can reconnect a second later — so a moderator could be
 * trusted with it long before being trusted to keep somebody out permanently.
 * That was the whole argument for granular scopes, and the scopes are gone
 * (lib/grants.ts): nobody could issue them, so nobody ever held a partial set.
 * Whoever can sign in can kick.
 *
 * NO REASON REQUIRED, unlike a ban. A kick is a nudge ("you are AFK in the
 * bus", "stop blocking the door") and demanding a paragraph for it means the
 * kick either does not happen or gets recorded as "asdf". The audit row still
 * captures who did it and to whom, which is the part that matters.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const kickSchema = z.object({
  license: licenseSchema,
  playerName: z.string().trim().max(120).optional().nullable(),
  reason: z.string().trim().max(300).optional().nullable(),

  /**
   * The incident this kick is the verdict on, when it was chosen as one.
   *
   * Same reasoning as `/api/bans`: one kick, one shape, one `player.kick` row,
   * with a field naming where it was decided. The incident page does not get
   * its own way of removing somebody from the server.
   */
  incidentId: z.string().uuid().optional(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('kick', 'write')

    if (!sshConfigured()) {
      throw new ActionError(
        'The command channel to the game server is not configured.',
        503,
      )
    }

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = kickSchema.parse(body)

    /**
     * A CLOSED CASE MEANS NO KICK, for the same reason `/api/bans` refuses one:
     * the decision has already been made, and removing somebody from a match
     * because of a case that is already settled is an action nobody asked for.
     */
    let incidentRow: incidents.Incident | null = null
    if (input.incidentId) {
      incidentRow = await incidents.get(input.incidentId)
      if (!incidentRow) {
        throw new ActionError('That incident no longer exists.', 404)
      }
      if (incidentRow.state !== 'pending_review') {
        throw new ActionError(
          'That incident has already been resolved, so nobody was kicked.',
          409,
        )
      }
    }

    const reason = input.reason?.trim() || 'Kicked by an admin'

    const { commandId, ts } = await audit.begin({
      action: 'player.kick',
      actor,
      targetLicense: input.license,
      targetName: input.playerName ?? null,
      reason,
      detail: input.incidentId ? { incidentId: input.incidentId } : undefined,
    })

    try {
      const res = await kickPlayer(input.license, reason, commandId)
      if (!res.ok) throw new Error(res.error ?? 'kick refused')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await audit.resolve(ts, 'failed', message)
      throw new ActionError(`The game server refused the kick: ${message}`, 502)
    }

    /**
     * The verdict, recorded only now that the command has been accepted.
     *
     * "ACCEPTED" IS AS STRONG A CLAIM AS THIS PATH CAN MAKE, and the verdict
     * inherits exactly that and no more — see the note below on why the audit
     * row is not marked `ok` either. A `kick` verdict means the game host took
     * the command, which is the same thing the `player.kick` row beside it
     * means. If the two ever say different things, one of them is lying.
     *
     * A REFUSAL HERE DOES NOT UNDO THE KICK, and is reported rather than
     * thrown: they have already been removed from the match, and an error would
     * invite a retry that removes them again.
     */
    let incident: { closed: boolean; error?: string } | undefined
    if (incidentRow) {
      const res = await incidents.closeWithVerdict({
        incident: incidentRow,
        actor,
        resolution: reason,
        verdict: { action: 'kick' },
      })
      incident = res.ok ? { closed: true } : { closed: false, error: res.reason }
    }

    // DELIBERATELY NOT RESOLVED AS 'ok' HERE. All we know is that the command
    // reached the console; whether a player was removed comes back as an
    // outcome event carrying this commandId. Marking it done now would make the
    // audit log claim knowledge it does not have.
    return Response.json({ ok: true, accepted: true, commandId, incident })
  } catch (e) {
    return errorResponse(e)
  }
}
