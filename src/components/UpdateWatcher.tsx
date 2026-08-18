'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

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
 * different: "3 commits behind main" and "3 new commits on dev" are different
 * facts with different remedies.
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
        const v = (await res.json()) as {
          configured?: boolean
          status?: { behindMain?: number; deployedRef?: string } | null
          refUpdate?: { ref: string; behind: number } | null
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
         * A MISMATCHED READING IS NO READING. `refUpdate` is polled on its own
         * cadence, so just after a switch it can still describe the previous
         * branch. Announcing that would attach a count to the wrong name, which
         * is worse than staying quiet for one interval.
         */
        const r = parked && v.refUpdate?.ref === ref ? v.refUpdate : null
        const behind = parked ? (r?.behind ?? 0) : (v.status.behindMain ?? 0)

        // Parked with no usable reading yet: say nothing, and leave the flag
        // alone so whatever was already announced stays announced.
        if (parked && !r) return

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

        toast.info(
          parked
            ? `${ref} has moved — ${behind} new commit${behind > 1 ? 's' : ''}`
            : `Update available — ${behind} commit${behind > 1 ? 's' : ''} behind main`,
          {
            description: parked
              ? `The game server is parked on ${ref} and is not running its newest commit. Deploy it from Maintenance.`
              : 'The game server is not running the latest code. Deploy it from Maintenance.',
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
