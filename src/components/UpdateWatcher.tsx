'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { behindMainNow, refBehindNow, UPDATE_AVAILABLE } from '@/lib/maintenance'
// TYPE-ONLY. See the note on the same import in UpdateBadge.
import type { RefUpdate } from '@/lib/ssh'

/**
 * Announces an available update, once.
 *
 * TWO MOMENTS MATTER and they are different: an update that was already
 * waiting when you signed in, and one that lands while you are looking at the
 * console. Both deserve the same informational toast; neither deserves it
 * twice.
 *
 * IT ANNOUNCES WHICHEVER REF THE BOX IS ON. Parked on a branch, "behind main"
 * is a large permanent number nobody is acting on, and this used to announce it
 * anyway — a toast on a box deliberately running `dev` telling its operator
 * that the server "is not running the latest code", where deploying from
 * Maintenance would not have closed that gap at all. What it says now is that
 * the branch they are pushing to has moved, which is the update they are
 * actually waiting for, and it names it. The two sentences are deliberately
 * different: "Update available" and "dev has moved" are different facts with
 * different remedies.
 *
 * AND NEITHER SENTENCE COUNTS ANYTHING, since #26. A toast is the one surface
 * where a commit count could never have been checked — there is nothing to
 * click, and it is gone in ten seconds — so it was pure assertion. The count
 * survives internally as the change detector behind the session stamp, which is
 * a job it is good at and one nobody reads.
 *
 * SESSION STORAGE, NOT LOCAL: the "already told you" flag should survive a
 * navigation and die with the tab. Keyed on the REF AND the commit count, so a
 * further update — the branch moving again while you read — announces itself
 * rather than being swallowed by the flag from the previous one, and so a
 * switch to a different branch is never silenced by the old branch's count.
 *
 * Deliberately `toast.info` and not a warning. Being behind is normal for most
 * of a day; it is a fact to notice, not a problem to fix immediately, and
 * colouring it amber would spend the alarm budget that a real degradation
 * needs.
 */

const KEY = 'ringmaster.updateAnnounced'
const POLL_MS = 60_000

export function UpdateWatcher() {
  const router = useRouter()
  // Guards against React 18 double-mounting in dev firing two toasts.
  const armed = useRef(true)

  useEffect(() => {
    let alive = true

    const check = async () => {
      try {
        const res = await fetch('/api/host', { cache: 'no-store' })
        if (!res.ok || !alive) return
        // `RefUpdate` in full rather than a subset — the hand-written shape here
        // dropped `stale`, so a zero the game host could not stand behind was
        // read as a real zero and CLEARED the "already announced" flag.
        const v = (await res.json()) as {
          configured?: boolean
          status?: { behindMain?: number; deployedRef?: string } | null
          refUpdate?: RefUpdate | null
        }
        if (!v.configured || !v.status) return

        /**
         * Same polarity rule as the header chip and for the same reason: a
         * dispatcher too old to name its ref keeps behaving exactly as it
         * always has, which is the main-branch case.
         */
        const ref = v.status.deployedRef
        const parked = typeof ref === 'string' && ref !== 'main'

        /**
         * A MISMATCHED READING IS NO READING, AND NEITHER IS AN UNPOLLED ONE.
         *
         * Both derivations return `number | null` and null means "we have not
         * been told" — for the parked side because `refUpdate` may be missing,
         * stale-zero, or still describing the previous branch; for main because
         * the telemetry poller has not answered yet. This used to read
         * `v.status.behindMain ?? 0` on the main side, which turned an unanswered
         * host into a confident zero — and a zero here does not merely stay
         * quiet, it CLEARS the "already announced" flag below. So a console that
         * dropped one poll would re-announce an update it had already announced,
         * on the strength of a number nobody had measured.
         */
        const behind = parked
          ? refBehindNow(ref, v.refUpdate)
          : behindMainNow(v.status)

        // No usable reading: say nothing, and leave the flag alone so whatever
        // was already announced stays announced.
        if (behind === null) return

        const stamp = `${parked ? ref : 'main'}:${behind}`
        if (behind <= 0) {
          // Level with the ref we are tracking — clear the flag so the NEXT
          // update announces itself.
          sessionStorage.removeItem(KEY)
          return
        }

        if (sessionStorage.getItem(KEY) === stamp) return
        if (!armed.current) return
        sessionStorage.setItem(KEY, stamp)

        /**
         * NO COUNT IN THE WORDS, THOUGH THE COUNT STILL DRIVES THE STAMP.
         *
         * The owner's rule from #26 — "just 'update available'" — is about what
         * a reader is told: the number does not change the decision and there is
         * nowhere in a toast to make it checkable. `stamp` above is a different
         * job: it is how this component notices that the branch has moved AGAIN
         * while somebody was reading, and a count is a perfectly good change
         * detector precisely because it is not being shown.
         */
        toast.info(
          parked ? `${ref} has moved` : UPDATE_AVAILABLE,
          {
            description: parked
              ? `The game server is parked on ${ref} and is not running its newest commit. Deploy it from Maintenance, where you can read the commit it would move to.`
              : 'The game server is not running the latest code. Deploy it from Maintenance, where you can read the commit it would move to.',
            action: {
              label: 'Maintenance',
              onClick: () => router.push('/maintenance'),
            },
            duration: 10_000,
          },
        )
      } catch {
        /* a missed check is not worth telling anyone about */
      }
    }

    void check()
    const t = setInterval(check, POLL_MS)
    return () => {
      alive = false
      armed.current = false
      clearInterval(t)
    }
  }, [router])

  return null
}
