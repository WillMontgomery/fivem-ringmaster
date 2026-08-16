import { cookies } from 'next/headers'

import { auth } from '@/auth'
import { isIdle } from '@/lib/activity'
import { IDLE_ERROR_CODE } from '@/lib/idle'
import { ensurePolling, hostView } from '@/lib/telemetry'

/**
 * What the Host page polls.
 *
 * Session-guarded like /api/state. Starting the SSH poll timer here — lazily,
 * on the first authenticated request — means the box does not open an SSH
 * connection to the game host until an admin actually looks at the Host page.
 * ensurePolling is idempotent, so every subsequent request is a cheap read of
 * whatever the timer last collected; the request never waits on SSH itself.
 *
 * IDLE-CHECKED BEFORE THE SSH TIMER STARTS. The Host page polls this every five
 * seconds with no visibility guard, so an abandoned tab on this route is both
 * the likeliest way to hold a stale session open and the one that keeps an SSH
 * connection to the game box warm for nobody.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false }, { status: 401 })
  }

  if (isIdle(await cookies())) {
    return Response.json({ ok: false, code: IDLE_ERROR_CODE }, { status: 401 })
  }

  ensurePolling()
  return Response.json(hostView())
}
