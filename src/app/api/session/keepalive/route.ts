import { cookies } from 'next/headers'

import { auth, signOut } from '@/auth'
import { isIdle, signActivity } from '@/lib/activity'
import {
  ACTIVITY_COOKIE,
  ACTIVITY_MAX_AGE_SECONDS,
  IDLE_ERROR_CODE,
  IDLE_MS,
  KEEPALIVE_HEADER,
} from '@/lib/idle'

/**
 * The one endpoint that refreshes — or ends — a session on inactivity.
 *
 * TWO JOBS, ONE ROUND TRIP. Still within the window: re-stamp the activity
 * cookie and hand back the new deadline. Past it: delete the session and say
 * so. Doing both here means the client never has to decide which it is, which
 * matters because the client's clock is the thing least worth trusting in this
 * whole feature — a laptop that slept for three hours wakes up with a timer
 * that expired while it was suspended.
 *
 * THE ONLY PLACE THAT DELETES ON IDLE, and it deletes the DynamoDB session
 * record through Auth.js rather than merely clearing cookies. The sidebar's
 * sign-out button already documents why: clearing cookies orphans the row until
 * its TTL, and a session record that still resolves is a session that a
 * captured cookie still opens. `auth.ts` calls immediate revocation a hard
 * requirement, and this is the same exit.
 *
 * THE CLIENT NEVER WRITES `rm_act`. It is HttpOnly and it carries a MAC, so the
 * browser can ask for a new one and cannot mint one.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Same-origin, checked twice.
 *
 * The custom header is the primary gate: it is not a CORS-simple header, so a
 * cross-origin form, image or `<script>` cannot produce it and a `fetch` that
 * tries earns a preflight this route never answers. `Origin` is the belt, and
 * it is only asserted when present — same-origin `fetch` in some browsers omits
 * it entirely, so a missing `Origin` is not evidence of anything.
 *
 * Worth stating why a logout endpoint deserves CSRF protection at all: the
 * dangerous direction is not being signed out, it is being kept signed in. A
 * hostile page in another tab POSTing here on a timer would hold an unattended
 * console open indefinitely, defeating the entire control.
 */
function sameOrigin(req: Request): boolean {
  if (req.headers.get(KEEPALIVE_HEADER) !== '1') return false

  const origin = req.headers.get('origin')
  if (!origin) return true

  try {
    return new URL(origin).host === req.headers.get('host')
  } catch {
    return false
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: 'Bad request.' }, { status: 403 })
  }

  const jar = await cookies()

  /**
   * A real session first. Without one there is nothing to keep alive and
   * nothing to end — and answering the same way whether or not `rm_act` is
   * present keeps this from being a probe for whether a given browser holds a
   * session.
   */
  const session = await auth()
  if (!session?.user) {
    return Response.json({ ok: false, code: IDLE_ERROR_CODE }, { status: 401 })
  }

  if (isIdle(jar)) {
    await signOut({ redirect: false })
    jar.delete(ACTIVITY_COOKIE)
    return Response.json({ ok: false, code: IDLE_ERROR_CODE }, { status: 401 })
  }

  /**
   * Seeded here rather than at sign-in, which is what makes "absent" safe to
   * read as "not yet idle" in lib/idle.ts. The console fires one keepalive when
   * the idle guard mounts, so the first authenticated page view stamps the
   * cookie and every later absence is a genuine expiry.
   */
  const now = Date.now()
  const value = signActivity(now, jar)
  if (!value) {
    // A valid Auth.js session with no session cookie to bind to should not be
    // reachable. Refusing is the safe direction: no cookie is issued, so the
    // window simply does not extend.
    return Response.json({ ok: false, code: IDLE_ERROR_CODE }, { status: 401 })
  }

  jar.set(ACTIVITY_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ACTIVITY_MAX_AGE_SECONDS,
  })

  return Response.json({ ok: true, deadline: now + IDLE_MS })
}
