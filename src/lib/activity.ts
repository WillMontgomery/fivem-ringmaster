import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { env } from './env'
import { ACTIVITY_COOKIE, IDLE_MS } from './idle'
import type { CookieJar } from './prefs'

/**
 * The server half of the idle timeout: minting and checking the activity
 * cookie.
 *
 * SERVER ONLY. It imports `node:crypto` and reads `AUTH_SECRET`, so nothing
 * with `'use client'` may import it — the constants a client needs live in
 * `lib/idle.ts`, which has no Node imports for exactly this reason.
 *
 * THE COOKIE IS `<epochMs>.<mac>`, HttpOnly, and issued only by the keepalive
 * route. What each property actually buys, stated honestly:
 *
 *   HttpOnly       stops page JavaScript from reading or writing it. It does
 *                  NOT stop somebody editing it in devtools.
 *   the MAC        stops anyone editing it anywhere — devtools, curl, a hostile
 *                  subdomain setting a cookie on the parent domain.
 *   the binding    stops a value captured from one sign-in being replayed into
 *                  the next one on the same browser.
 *
 * What none of them buy is protection against the session holder deciding to
 * stay signed in; see the note in `lib/idle.ts`. The guarantee this file
 * delivers is narrower and worth stating plainly: the server's opinion of when
 * a session went idle is computed from a value the server signed, so a stale,
 * garbled or borrowed cookie can never move the deadline forward.
 */

/**
 * Auth.js's session cookie, both spellings — the same pair `middleware.ts`
 * hardcodes, for the same reason: the `__Secure-` prefix appears on every
 * deployment and no dev machine.
 */
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

/**
 * A key derived from AUTH_SECRET rather than AUTH_SECRET itself.
 *
 * Auth.js already uses that secret for its own cookie signing and encryption.
 * Using one key for two unrelated purposes is the setup where a weakness or a
 * confusion in one protocol becomes a forgery in the other, and separating them
 * costs one HMAC at module scope. The label is versioned so that changing the
 * scheme later invalidates old cookies by construction rather than by somebody
 * remembering to.
 */
let cachedKey: Buffer | null = null
function activityKey(): Buffer {
  if (!cachedKey) {
    cachedKey = createHmac('sha256', env().AUTH_SECRET)
      .update('ringmaster.activity.v1')
      .digest()
  }
  return cachedKey
}

/**
 * A stable, non-reversible handle on the current session.
 *
 * BINDING THE ACTIVITY COOKIE TO THE SESSION is what stops an `rm_act` value
 * captured from one sign-in being pasted into the next. Without it a cookie
 * harvested once is a permanently valid "I was active at time T" for any future
 * session on that browser. Hashed rather than stored raw so the value is never
 * a second copy of the session token sitting in another cookie.
 */
function sessionFingerprint(jar: CookieJar): string | null {
  for (const name of SESSION_COOKIES) {
    const token = jar.get(name)?.value
    if (token) return createHash('sha256').update(token).digest('hex')
  }
  return null
}

/**
 * Does this browser carry a session cookie at all?
 *
 * NOT A SECURITY CHECK, and it must never be used as one — it is the same
 * unvalidated cookie sniff `middleware.ts` documents at length as "a fast path,
 * not the boundary". A forged cookie passes it. The boundary is still
 * `currentAdmin()` and `authorize()`.
 *
 * IT EXISTS TO DECIDE WHAT TO MOUNT. `AppShell` takes its user as a prop, and
 * the design harness under `/preview` passes a fixture — `DEMO_USER`, a real
 * object for a person who is not signed in to anything. Keying the idle guard
 * off that prop mounts it on the harness, where its first keepalive 401s and
 * redirects the wireframes to the login page. Asking whether a session cookie
 * exists distinguishes the two correctly and costs nothing.
 */
export function hasSessionCookie(jar: CookieJar): boolean {
  return SESSION_COOKIES.some((name) => jar.get(name)?.value)
}

/** `<epochMs>.<mac>` — the whole cookie value, or null with no session. */
export function signActivity(atMs: number, jar: CookieJar): string | null {
  const fingerprint = sessionFingerprint(jar)
  if (!fingerprint) return null

  const stamp = String(Math.floor(atMs))
  const mac = createHmac('sha256', activityKey())
    .update(`${stamp}.${fingerprint}`)
    .digest('hex')

  return `${stamp}.${mac}`
}

/**
 * The verified last-activity instant, or null.
 *
 * Null covers three different failures on purpose — absent, malformed, and
 * failed authentication. The callers do not benefit from telling them apart,
 * and a caller that branched on the difference would be reading a distinction
 * an attacker chose.
 */
export function readActivity(jar: CookieJar): number | null {
  const raw = jar.get(ACTIVITY_COOKIE)?.value
  if (!raw || raw.length > 256) return null

  const dot = raw.indexOf('.')
  if (dot <= 0) return null

  const stamp = raw.slice(0, dot)
  const mac = raw.slice(dot + 1)
  if (!/^\d{1,15}$/.test(stamp) || !/^[0-9a-f]{64}$/.test(mac)) return null

  const fingerprint = sessionFingerprint(jar)
  if (!fingerprint) return null

  let expected: string
  try {
    expected = createHmac('sha256', activityKey())
      .update(`${stamp}.${fingerprint}`)
      .digest('hex')
  } catch {
    // AUTH_SECRET missing or unreadable. Fail closed: an unverifiable cookie is
    // treated as no cookie. The app cannot serve a signed-in page without that
    // secret anyway, so this direction costs nothing and the other one would
    // accept anything.
    return null
  }

  // Constant-time, because comparing a MAC byte at a time is the textbook way
  // to turn "cannot forge" into "can forge in a few thousand requests".
  const a = Buffer.from(mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const at = Number(stamp)
  return Number.isFinite(at) ? at : null
}

/** When this session goes stale, or null when no verified activity is on record. */
export function activityDeadline(jar: CookieJar): number | null {
  const at = readActivity(jar)
  return at === null ? null : at + IDLE_MS
}

/**
 * Has this session been idle too long?
 *
 * ABSENT IS NOT IDLE, and the trade is worth being explicit about. The cookie
 * does not exist for the first request after a sign-in, so treating absent as
 * expired would bounce every fresh login straight back to the login page. It is
 * seeded by the first keepalive the console fires on mount.
 *
 * The cost is that deleting the cookie buys a fresh window. That is not a real
 * weakening: anyone who can delete a cookie can also call the keepalive route
 * in a loop, and neither is available to the unattended browser this feature
 * exists to close. Pretending the timeout survives an adversary with devtools
 * would be the mistake — the honest guarantee is that a console nobody touches
 * stops working after two hours.
 */
export function isIdle(jar: CookieJar): boolean {
  const at = readActivity(jar)

  if (at === null) {
    // Distinguish "never seeded" from "present but unverifiable". A cookie that
    // is there and fails its MAC is a tampered or replayed value, and treating
    // that as a fresh window would make forgery strictly better than deletion.
    return jar.get(ACTIVITY_COOKIE) !== undefined
  }

  /**
   * A timestamp from the future is rejected rather than trusted. It cannot
   * arise from our own signing, so it means either clock skew across a restart
   * or a value that authenticated under a key somebody else holds — and "far
   * future" is the shape a forged extension would take. A minute of tolerance
   * absorbs ordinary skew between the process that signed it and the one
   * reading it.
   */
  const now = Date.now()
  if (at > now + 60_000) return true

  return now - at >= IDLE_MS
}
