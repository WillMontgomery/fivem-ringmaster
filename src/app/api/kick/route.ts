import { z } from 'zod'

import {
  ActionError,
  authorizeWrite,
  errorResponse,
  licenseSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import {
  channelNotConfigured,
  dispatchKick,
  failureMessage,
  failureStatus,
} from '@/lib/commandOutcome'
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
    /**
     * EITHER DOOR. `blitz-bot`'s `/brkick` reaches this route with the service
     * credential and the Discord id of the admin who typed it; a browser
     * reaches it with a session. Both arrive here as an `actor`, and everything
     * below — the SSH check, the closed-case refusal, the audit row, the
     * verdict — is identical for both because none of it is authorisation. See
     * lib/service.ts.
     */
    const { actor } = await authorizeWrite('kick', req)

    /**
     * NO CHANNEL, SO NOTHING WAS EVEN ATTEMPTED — and it is reported as a typed
     * outcome rather than thrown, so the bot branches on `failure` here exactly
     * as it does on a refusal. The sentence is the one this route already sent;
     * only its wrapper changed. No audit row, for the reason there never was
     * one: `audit.begin` records an INTENT that is about to be acted on, and
     * this is a request that stops here.
     */
    if (!sshConfigured()) {
      const outcome = channelNotConfigured()
      return Response.json(
        { ok: false, ...outcome, error: failureMessage(outcome) },
        { status: failureStatus(outcome) },
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

    /**
     * WHAT ACTUALLY HAPPENED, not whether we sent it — the owner's second
     * comment on #42, and lib/commandOutcome.ts carries the reasoning. The two
     * failures this used to flatten into one 502 sentence are now told apart:
     * a box that ANSWERED AND SAID NO is `refused` and carries its reason; a box
     * that never answered is `unreachable`, which is not the same fact and is
     * not the same fix.
     */
    const outcome = await dispatchKick(() =>
      kickPlayer(input.license, reason, commandId),
    )

    if (outcome.outcome === 'failed') {
      await audit.resolve(ts, 'failed', outcome.detail)

      /**
       * A BODY RATHER THAN A THROW, and the difference is who can read it.
       * `ActionError` produces `{ ok, error }` and nothing else, which is a
       * sentence written for a dialog; the bot needs `failure` to choose its
       * own words in Discord. The sentence is still there, and still the one the
       * browser toasts, so KickDialog is untouched.
       *
       * `commandId` IS CARRIED ON THE FAILURE TOO. It names the audit row that
       * has just been stamped `failed`, which is the row somebody will be asked
       * about when an admin says the kick did not work.
       */
      return Response.json(
        { ok: false, ...outcome, commandId, error: failureMessage(outcome) },
        { status: failureStatus(outcome) },
      )
    }

    /**
     * The verdict, recorded only now that the command has been dispatched.
     *
     * "DISPATCHED" IS AS STRONG A CLAIM AS THIS PATH CAN MAKE, and the verdict
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

    /**
     * DELIBERATELY NOT RESOLVED AS 'ok' HERE. All we know is that the command
     * reached the FXServer console; whether a player was removed would come back
     * as an outcome event carrying this commandId, and nothing sends one today
     * (lib/commandOutcome.ts names what is missing). Marking it done now would
     * make the audit log claim knowledge it does not have.
     *
     * AND THE RESPONSE NOW SAYS THE SAME THING THE ROW DOES. `accepted: true` is
     * gone: it was receipt dressed as success, and it let a caller report "done"
     * for a command whose own audit row says `pending`. `confirmed: false` rides
     * the outcome so that a reader has to decide what to do about it.
     */
    return Response.json({ ok: true, ...outcome, commandId, incident })
  } catch (e) {
    return errorResponse(e)
  }
}
