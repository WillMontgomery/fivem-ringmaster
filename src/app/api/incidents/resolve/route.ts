import { z } from 'zod'

import { ActionError, authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'
import * as incidents from '@/lib/incidents'

/**
 * Close an incident, once and permanently.
 *
 * TAKES THE `ban` SCOPE, not a scope of its own. Resolving is a moderation
 * decision — "I looked, and this person is fine" carries the same weight as
 * acting, because the consequence of getting it wrong is that nobody looks
 * again. Reading an incident needs nothing beyond being logged in.
 *
 * THE ONE-WAY RULE IS ENFORCED IN THE DATABASE, not here. lib/incidents issues
 * a conditional write that requires the incident to still be pending, so two
 * admins pressing resolve on the same one is an ordinary race the loser is told
 * about rather than a silent overwrite of somebody else's decision.
 *
 * AUDITED, because the audit log is where "who decided nothing was wrong" has
 * to survive — the incident itself carries the timeline, but the audit log is
 * the one place every moderation action across the whole console is comparable.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  incidentId: z.string().uuid(),
  resolution: z.string().trim().min(1).max(500),
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('ban')

    const body = await req.json().catch(() => {
      throw new ActionError('That request was not valid JSON.', 400)
    })

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ActionError('That resolution was not accepted.', 400)
    }

    const { incidentId, resolution } = parsed.data

    const existing = await incidents.get(incidentId)
    if (!existing) {
      throw new ActionError('That incident no longer exists.', 404)
    }

    const result = await incidents.resolve({
      incidentId,
      // The actor always has a license here -- authorize() resolves the
      // session to a grants row, and grants are keyed on license.
      byLicense: actor.license ?? '',
      byName: actor.name,
      resolution,
    })

    if (!result.ok) {
      throw new ActionError(result.reason, 409)
    }

    // AFTER the write, not around it. The two-phase intent/outcome shape exists
    // for actions that reach OUT to something that can fail slowly — a kick
    // crossing an SSH channel, a deploy. This one already succeeded against a
    // conditional write, so there is no window in which it could be pending:
    // the row opens and closes in the same breath.
    const handle = await audit.begin({
      action: 'incident.resolve',
      actor,
      targetLicense: existing.subjectLicense,
      targetName: existing.subjectName,
      reason: resolution,
      detail: { incidentId, kind: existing.kind },
    })
    await audit.resolve(handle.ts, 'ok')

    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
