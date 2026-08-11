import { auth } from '@/auth'
import { ensurePolling, hostView } from '@/lib/telemetry'

/**
 * What the Host page polls.
 *
 * Session-guarded like /api/state. Starting the SSH poll timer here — lazily,
 * on the first authenticated request — means the box does not open an SSH
 * connection to the game host until an admin actually looks at the Host page.
 * ensurePolling is idempotent, so every subsequent request is a cheap read of
 * whatever the timer last collected; the request never waits on SSH itself.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false }, { status: 401 })
  }

  ensurePolling()
  return Response.json(hostView())
}
