import { z } from 'zod'

import {
  ActionError,
  authorize,
  errorResponse,
  reasonSchema,
} from '@/lib/actions'
import * as incidents from '@/lib/incidents'

/**
 * Close an incident with NO ACTION, once and permanently.
 *
 * THIS ROUTE CAN ONLY EVER WRITE ONE VERDICT, and that is the design rather
 * than a limitation. A `ban` verdict is written by `/api/bans` after the ban row
 * exists; a `kick` verdict by `/api/kick` after the game host accepts the
 * command. Neither can be claimed from here, so there is no request a browser
 * can send that records an action which did not happen — which matters because
 * fivem-br-gamemode#168 pays 250 Volts against exactly that field. The wire
 * carries no verdict at all: it is not a parameter, it is a consequence of
 * which endpoint you reached.
 *
 * "NO ACTION" IS A VERDICT, NOT AN ABSENCE. An admin who watched a match and
 * concluded there was nothing in the report has decided something, and this
 * writes it down as `{ action: 'none' }`. What it must never be confused with
 * is a resolved incident carrying no verdict at all — see lib/incidents, where
 * absent means nobody decided.
 *
 * IT USED TO TAKE THE `ban` SCOPE rather than one of its own, because resolving
 * is a moderation decision — "I looked, and this person is fine" carries the
 * same weight as acting, since the consequence of getting it wrong is that
 * nobody looks again. There are no scopes now, so resolving and reading are
 * separated only by the `write` intent: this one re-checks Discord, and opening
 * the case does not.
 *
 * THE ONE-WAY RULE IS ENFORCED IN THE DATABASE, not here. lib/incidents issues
 * a conditional write that requires the incident to still be pending, so two
 * admins pressing resolve on the same one is an ordinary race the loser is told
 * about rather than a silent overwrite of somebody else's decision. The same
 * write is what makes a verdict unamendable: there is no path that sets
 * `verdict` without also moving `state`, and `state` can only move once.
 *
 * AUDITED, because the audit log is where "who decided nothing was wrong" has
 * to survive — the incident itself carries the timeline, but the audit log is
 * the one place every moderation action across the whole console is comparable.
 * The row is written by `incidents.closeWithVerdict`, shared with the two
 * routes above so that closing a case cannot be logged three different ways.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  incidentId: z.string().uuid(),
  /**
   * THE SAME SCHEMA THE BAN REASON USES, which it was not before: this had its
   * own `min(1).max(500)` and no control-character strip, so the one free-text
   * field on this route was the only admin text in the console that could carry
   * newlines into an audit row. It is the same kind of value written by the same
   * kind of person into the same kind of box; it gets the same rule.
   */
  resolution: reasonSchema,
})

export async function POST(req: Request): Promise<Response> {
  try {
    const { actor } = await authorize('ban', 'write')

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

    const result = await incidents.closeWithVerdict({
      incident: existing,
      actor,
      resolution,
      verdict: { action: 'none' },
    })

    if (!result.ok) {
      throw new ActionError(result.reason, 409)
    }

    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e)
  }
}
