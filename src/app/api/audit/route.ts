import { authorize, errorResponse } from '@/lib/actions'
import * as audit from '@/lib/audit'

/**
 * The audit log, newest first.
 *
 * GUARDED BY `view` RATHER THAN A SPECIAL SCOPE. Everyone who can see the
 * console can see what was done in it — an audit trail only some admins can
 * read is a weaker check on the ones who can hide from it. The sensitive
 * direction is writing, and nothing here writes.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    await authorize('view', 'read')
    return Response.json({ ok: true, rows: await audit.recent(100) })
  } catch (e) {
    return errorResponse(e)
  }
}
