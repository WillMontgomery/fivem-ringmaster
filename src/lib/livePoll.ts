'use client'

import { useSyncExternalStore } from 'react'

import type { liveView } from './state'

/**
 * One poller, many readers.
 *
 * The header's feed chip and the live board both need the same fresh state,
 * and they are separate client islands — the chip lives in the app shell's
 * header, the board in the page body. Giving each its own fetch loop would
 * double every request and let the two disagree about how old the data is,
 * which is precisely the thing the chip exists to be honest about.
 *
 * So this is a module-level store: whichever component subscribes first starts
 * the interval, the last one out stops it, and every subscriber re-renders on
 * the same tick with the same object.
 *
 * POLLING RATHER THAN SSE settles the question PLAN.md left open. Two seconds
 * is undemanding, a poll survives proxies and reconnects for free, and the
 * failure mode is "data ages" — which the chip already displays — rather than
 * a silently dead socket that looks connected.
 */

export interface LivePayload {
  view: ReturnType<typeof liveView>
  now: number
}

const POLL_MS = 2_000

let data: LivePayload | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

async function tick(): Promise<void> {
  // A hidden tab keeps its session but stops asking. An admin with the
  // console open in a background tab all day should not be a request every
  // two seconds for nothing — the first tick after refocus catches up.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
    return

  try {
    const res = await fetch('/api/state', { cache: 'no-store' })

    /**
     * A 401 USED TO BE SWALLOWED IN SILENCE, and the failure mode was that the
     * board simply stopped updating — no message, no stale marker, nothing
     * saying the session had ended. An admin could watch a frozen player list
     * for an hour believing it.
     *
     * `code: 'idle'` is the one case worth acting on rather than reporting: the
     * session is over and there is a page that explains why. Every other
     * failure still fails quiet, because the feed chip ages honestly and that
     * IS the error display for a missed poll.
     *
     * NOTE THAT SUCCEEDING HERE DOES NOT EXTEND THE SESSION. This runs every
     * two seconds; if it counted as activity nothing would ever time out. See
     * lib/idle.ts.
     */
    if (res.status === 401) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (body?.code === 'idle' && typeof window !== 'undefined') {
        window.location.replace('/login?reason=idle')
      }
      return
    }
    if (!res.ok) return

    data = (await res.json()) as LivePayload
    listeners.forEach((l) => l())
  } catch {
    // Transient network failure. The chip ages honestly in the meantime,
    // which IS the error display — no toast spam for a missed poll.
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!timer) {
    timer = setInterval(() => void tick(), POLL_MS)
    void tick()
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const noSubscribe = () => () => {}

/**
 * The latest payload, or null before the first tick — callers fall back to
 * their server-rendered props, so first paint is never blank.
 *
 * `enabled: false` subscribes to nothing; the preview harness uses that so a
 * fixture page does not fetch real state over the top of itself.
 */
export function useLiveState(enabled: boolean): LivePayload | null {
  return useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    () => data,
    () => null,
  )
}
