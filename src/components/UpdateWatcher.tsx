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
 * SESSION STORAGE, NOT LOCAL: the "already told you" flag should survive a
 * navigation and die with the tab. Keyed on the commit count so a *further*
 * update — main moving again while you read — announces itself rather than
 * being swallowed by the flag from the previous one.
 *
 * Deliberately `toast.info` and not a warning. Being behind main is normal for
 * most of a day; it is a fact to notice, not a problem to fix immediately, and
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
          status?: { behindMain?: number; commit?: string } | null
        }

        const behind = v.configured && v.status ? (v.status.behindMain ?? 0) : 0
        if (behind <= 0) {
          // Back in sync — clear the flag so the NEXT update announces itself.
          sessionStorage.removeItem(KEY)
          return
        }

        const stamp = `${behind}`
        if (sessionStorage.getItem(KEY) === stamp) return
        if (!armed.current) return
        sessionStorage.setItem(KEY, stamp)

        toast.info(
          `Update available — ${behind} commit${behind > 1 ? 's' : ''} behind main`,
          {
            description:
              'The game server is not running the latest code. Deploy it from Maintenance.',
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
