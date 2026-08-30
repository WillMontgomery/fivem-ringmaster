import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  licenseSchema,
} from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as bans from '@/lib/bans'

/**
 * Lift a ban.
 *
 * ONE RESPONSIBILITY, NOT TWO. Splitting issuing from lifting was tempting
 * back when there were scopes to split, and it was wrong then: an admin trusted
 * to remove someone from the server is trusted to admit they were wrong about
 * it, and a separate lift permission mostly produces moderators who can ban and
 * cannot undo — the worst of both. There are no permissions now, so the
 * question is settled by construction.
 *
 * The row survives — see lib/bans.ts. Lifting stamps who and why onto the
 * existing record rather than deleting it.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const liftSchema = z.object({
  license: licenseSchema,
  // Optional, and deliberately not held to the same minimum as a ban reason:
  // "issued in error" is a complete explanation, and demanding prose before
  // someone can undo a mistake is how mistakes stay in place.
  reason: z.string().trim().max(300).optional().nullable(),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('ban', 'write')

    const body = await req.json().catch(() => {
      throw new ActionError('Expected a JSON body.')
    })
    const input = liftSchema.parse(body)

    const existing = await bans.banFor(input.license)
    if (!existing) throw new ActionError('No ban on record for that license.', 404)
    if (existing.liftedAt) {
      throw new ActionError('That ban has already been lifted.', 409)
    }

    await audit.audited(
      {
        action: 'ban.lift',
        actor,
        targetLicense: input.license,
        targetName: existing.playerName ?? null,
        reason: input.reason ?? null,
        detail: { originalReason: existing.reason, bannedAt: existing.at },
      },
      () =>
        bans.lift({
          license: input.license,
          by: actor.license,
          byName: actor.name,
          reason: input.reason ?? null,
        }),
    )

    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
