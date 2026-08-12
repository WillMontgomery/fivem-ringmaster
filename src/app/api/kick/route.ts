import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  licenseSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import { kickPlayer, sshConfigured } from '@/lib/ssh'

/**
 * Remove a connected player, without banning them.
 *
 * SEPARATE SCOPE FROM BANNING. `kick` is the reversible one — they can
 * reconnect a second later — so a moderator can be trusted with it long before
 * they are trusted to keep somebody out permanently. That split is the entire
 * reason scopes are granular rather than one admin bit.
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
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('kick')

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

    const reason = input.reason?.trim() || 'Kicked by an admin'

    const { commandId, ts } = await audit.begin({
      action: 'player.kick',
      actor,
      targetLicense: input.license,
      targetName: input.playerName ?? null,
      reason,
    })

    try {
      const res = await kickPlayer(input.license, reason, commandId)
      if (!res.ok) throw new Error(res.error ?? 'kick refused')
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await audit.resolve(ts, 'failed', message)
      throw new ActionError(`The game server refused the kick: ${message}`, 502)
    }

    // DELIBERATELY NOT RESOLVED AS 'ok' HERE. All we know is that the command
    // reached the console; whether a player was removed comes back as an
    // outcome event carrying this commandId. Marking it done now would make the
    // audit log claim knowledge it does not have.
    return Response.json({ ok: true, accepted: true, commandId })
  } catch (e) {
    return errorResponse(e)
  }
}
