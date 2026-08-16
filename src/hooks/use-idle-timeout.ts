'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import {
  IDLE_MS,
  KEEPALIVE_HEADER,
  KEEPALIVE_PATH,
  WARN_BEFORE_MS,
} from '@/lib/idle'

/**
 * The client half of the idle timeout: what counts as being there.
 *
 * ACTIVITY IS A POINTER OR A KEY, NEVER AN HTTP REQUEST, and everything else in
 * this file follows from that. The console polls `/api/state` every two
 * seconds, `/api/host` every five and `/api/host` again every sixty from the
 * update watcher. If any of those refreshed the deadline — which is what
 * "refresh the cookie on each authenticated request" would mean, and it is the
 * obvious implementation — then a tab left open overnight would refresh it
 * about seventeen thousand times and no session would ever expire. The feature
 * would build clean, deploy, and be a no-op. So the poll traffic deliberately
 * does not touch the deadline, and only these three signals do.
 *
 * ONE ROUND TRIP A MINUTE, AT MOST. Without the debounce, moving a mouse across
 * the window is a request per pointer event. The window is two hours; a minute
 * of granularity on the deadline is not worth measuring.
 *
 * THE DEADLINE IS SHARED ACROSS TABS through localStorage rather than held per
 * tab. A per-tab timer signs you out of the tab you are typing in because a
 * different tab has been quiet, which reads as a bug however correct the
 * arithmetic is. The `storage` event delivers the update to the other tabs the
 * moment it is written, with no polling.
 *
 * THE SHARED VALUE IS NOT AUTHORITY, and the split matters. localStorage is
 * writable by anything running in the page, so this drives the countdown and
 * nothing else. The value the server acts on is an HttpOnly, MAC-authenticated
 * cookie the browser cannot mint (see lib/idle.ts). Deliberately kept out of a
 * cookie so that no future server-side reader can mistake it for the real one —
 * it never reaches the server at all.
 */

/** Shared with other tabs. Advisory; see the note above. */
const DEADLINE_KEY = 'ringmaster.idleDeadline'

/** At most one keepalive per minute, however much the mouse moves. */
const KEEPALIVE_THROTTLE_MS = 60_000

/**
 * How often the deadline is re-checked.
 *
 * A REPEATING INTERVAL, NOT A SINGLE `setTimeout` ARMED FOR THE DEADLINE. A
 * laptop that suspends for three hours resumes with a timer that should have
 * fired long ago, and browsers do not agree on what a pending timeout does
 * across a sleep. Re-reading the clock on a short interval is correct whatever
 * happened in between.
 */
const TICK_MS = 30_000

function readSharedDeadline(): number | null {
  try {
    const raw = localStorage.getItem(DEADLINE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function writeSharedDeadline(at: number): void {
  try {
    localStorage.setItem(DEADLINE_KEY, String(at))
  } catch {
    // Private browsing, or storage disabled. The tab keeps its own deadline in
    // memory and the server still enforces the real one; only the cross-tab
    // sync is lost. Not worth an error for.
  }
}

/**
 * Watch for inactivity and end the session when it runs out.
 *
 * @param initialDeadline the deadline the server computed for this request, or
 *   null when no activity has been recorded yet. Seeded from a server value
 *   rather than `Date.now()` during render — the rule `LiveBoard` already
 *   documents, and a second-granularity countdown is exactly the case where
 *   ignoring it mismatches on essentially every load.
 */
export function useIdleTimeout(initialDeadline: number | null): void {
  const deadline = useRef<number | null>(initialDeadline)
  const lastPing = useRef(0)
  /** The deadline we have already warned about, so one window warns once. */
  const warnedFor = useRef<number | null>(null)
  /** Guards React's dev double-mount, which otherwise fires two toasts. */
  const armed = useRef(true)
  const endingRef = useRef(false)

  useEffect(() => {
    armed.current = true

    /**
     * Leave for the login page.
     *
     * A FULL NAVIGATION, not a client-side route change, because every cached
     * server component, every poller and every piece of module-level state in
     * this tab is about to be wrong. The reason travels as a query param so the
     * login page can say what happened instead of showing a bare sign-in form
     * to somebody who was working thirty seconds ago.
     */
    const end = () => {
      if (endingRef.current) return
      endingRef.current = true
      try {
        localStorage.removeItem(DEADLINE_KEY)
      } catch {
        /* see writeSharedDeadline */
      }
      window.location.replace('/login?reason=idle')
    }

    /**
     * Ask the server to re-stamp the window.
     *
     * The server decides, not us: if it considers the session already stale it
     * deletes the session record and answers 401, and we leave. That ordering
     * is what makes a resumed-from-sleep tab safe — the client's opinion about
     * how long it has been never overrides the server's.
     */
    const keepalive = async (force = false) => {
      const now = Date.now()
      if (!force && now - lastPing.current < KEEPALIVE_THROTTLE_MS) return
      lastPing.current = now

      try {
        const res = await fetch(KEEPALIVE_PATH, {
          method: 'POST',
          cache: 'no-store',
          headers: { [KEEPALIVE_HEADER]: '1' },
        })

        if (res.status === 401) {
          end()
          return
        }
        if (!res.ok) return

        const body = (await res.json()) as { deadline?: number }
        const next =
          typeof body.deadline === 'number' && Number.isFinite(body.deadline)
            ? body.deadline
            : now + IDLE_MS

        deadline.current = next
        warnedFor.current = null
        writeSharedDeadline(next)
        toast.dismiss('idle-warning')
      } catch {
        /**
         * Offline, or the box is restarting. Deliberately does not extend the
         * deadline: a failed keepalive is not evidence the session is alive.
         * The local countdown keeps running and will sign this tab out on time,
         * which is the safe direction to be wrong in.
         */
      }
    }

    const warn = () => {
      toast.warning('Signing you out soon', {
        id: 'idle-warning',
        description:
          'The console has been idle. You will be signed out in a few minutes.',
        duration: WARN_BEFORE_MS,
        action: {
          label: 'Stay signed in',
          onClick: () => void keepalive(true),
        },
        cancel: {
          label: 'Sign out now',
          onClick: () => end(),
        },
      })
    }

    /**
     * The clock check. Runs on a timer, on tab focus, and once on mount.
     *
     * EXPIRY IS TESTED BEFORE ACTIVITY IS RECORDED, everywhere, and the
     * ordering is the whole reason a suspended laptop behaves. Coming back to a
     * tab after three hours fires `visibilitychange`, which is an activity
     * signal — handled the other way round, waking the machine would extend a
     * window that ran out while it slept.
     */
    const check = () => {
      const at = deadline.current
      if (at === null) return false

      const now = Date.now()
      if (now >= at) {
        end()
        return true
      }

      if (now >= at - WARN_BEFORE_MS && warnedFor.current !== at && armed.current) {
        warnedFor.current = at
        warn()
      }
      return false
    }

    /**
     * A HUMAN DID SOMETHING. `pointerdown` covers mouse, touch and pen in one
     * event; `keydown` covers the person typing a ban reason without ever
     * touching the mouse — the case a pointer-only detector signs out mid
     * sentence.
     *
     * Note that this includes clicks on the warning toast itself. That is
     * deliberate: a click is proof somebody is at the keyboard, which is the
     * only question this feature asks, and carving out one particular click
     * would be both inconsistent with every other click on the page and
     * unenforceable — the event bubbles to the document either way. "Stay
     * signed in" remains the affordance for extending on purpose.
     */
    const onActivity = () => {
      if (check()) return
      void keepalive()
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (check()) return
      void keepalive()
    }

    /**
     * Another tab extended (or ended) the session. Adopting its deadline is
     * what keeps a quiet tab from signing out a busy one.
     */
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEADLINE_KEY) return
      if (e.newValue === null) {
        end()
        return
      }
      const next = Number(e.newValue)
      if (!Number.isFinite(next) || next <= 0) return
      deadline.current = next
      warnedFor.current = null
      toast.dismiss('idle-warning')
    }

    // A deadline another tab already established beats the one this request
    // rendered with, which may be a minute old by the time this mounts.
    const shared = readSharedDeadline()
    if (shared !== null && (deadline.current === null || shared > deadline.current)) {
      deadline.current = shared
    }

    document.addEventListener('pointerdown', onActivity, { passive: true })
    document.addEventListener('keydown', onActivity, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)

    const timer = setInterval(check, TICK_MS)

    /**
     * Seed on mount. `rm_act` does not exist for the first request after a
     * sign-in, and lib/idle.ts reads absent as "not yet idle" precisely because
     * this call is coming — without it the cookie would never appear and the
     * timeout would never start.
     */
    if (!check()) void keepalive(true)

    return () => {
      armed.current = false
      clearInterval(timer)
      document.removeEventListener('pointerdown', onActivity)
      document.removeEventListener('keydown', onActivity)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return
}
