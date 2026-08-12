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
 * separate action with its own scope. Issuing a ban against a player who is
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
})

export async function GET(): Promise<Response> {
  try {
    // Reading the ban list needs `view`, not `ban`: a moderator who cannot
    // issue bans still has to be able to see who is banned.
    await authorize('view')
    return Response.json({ ok: true, bans: await bans.all() })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('ban')

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = issueSchema.parse(body)

    const existing = await bans.banFor(input.license)
    if (existing && bans.isActive(existing)) {
      throw new ActionError('That license is already banned.', 409)
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
        detail: { expiresAt, permanent: expiresAt === null },
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

    return Response.json({ ok: true, ban }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
