'use client'

import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import type { MaintenanceState } from './maintenance'
import { updateInProgress } from './serverPhase'
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

export interface MaintenancePhase {
  state: MaintenanceState | null
  completedAt: number | null
  badge: 'scheduled' | 'draining' | 'updating' | null
  /** 0 = the driver has never read the row. Absence, not "no window". */
  at: number
}

export interface LivePayload {
  view: ReturnType<typeof liveView>
  now: number
  /** Absent from an older payload; every reader treats that as "not known". */
  maintenance?: MaintenancePhase
}

const POLL_MS = 2_000

let data: LivePayload | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

/**
 * Whether the last tick thought an update was in progress.
 *
 * IT LIVES IN THE MODULE, NOT IN A COMPONENT, AND THAT IS THE WHOLE REASON THIS
 * CODE IS HERE RATHER THAN IN THE CHIP. The header chips are rendered inside
 * `AppShell`, which every page renders itself — so navigating REMOUNTS them and
 * resets every `useState` and `useRef` they own. A "have I already announced
 * this" flag held in a component would therefore reset on each navigation, and
 * an admin who clicked through three pages while a deploy finished would be told
 * three times. A module-level variable survives client-side navigation for the
 * same reason `data` below does: the module is loaded once.
 *
 * `null` UNTIL THE FIRST TICK, so opening the console after a deploy has already
 * finished announces nothing. Only an observed FALSE-after-TRUE is a transition;
 * a first reading is not.
 */
let wasUpdating: boolean | null = null

/**
 * Announce the update complete — but only once the server is actually back.
 *
 * THE OLD PLACE FOR THIS WAS `MaintenancePanel`, firing on the window's state
 * going `deploying -> complete`, and it was wrong twice over. It only existed on
 * /maintenance, so an admin anywhere else in the console was never told; and
 * "complete" is the deploy VERB returning, not FXServer answering, so the toast
 * landed while the feed was still dead and the header still said the server was
 * gone. A green "the server is back open" over a red "Feed lost" is the exact
 * false reassurance these chips exist to prevent.
 *
 * SO IT FIRES OFF THE SAME COMPARISON THE CHIP FLIPS ON — `updateInProgress`
 * going true then false — which is what makes the two surfaces agree by
 * construction rather than by both being maintained carefully.
 *
 * IT DOES NOT FIRE ON THE GRACE EXPIRY. `updateInProgress` also goes false when
 * a restart has taken longer than a restart plausibly takes, and that is not a
 * success — the server never came back. The check below is for a push that
 * landed after the deploy finished, which is positive evidence rather than the
 * absence of it, so a deploy that broke the server produces no toast and lets
 * the health chips say what is true.
 */
function announceIfBackFromUpdate(payload: LivePayload): void {
  const m = payload.maintenance
  const now = payload.now
  const updating = updateInProgress({
    state: m?.state,
    completedAt: m?.completedAt,
    lastPushAt: payload.view.lastPushAt,
    now,
  })

  const prev = wasUpdating
  wasUpdating = updating
  if (prev !== true || updating) return

  const back =
    typeof m?.completedAt === 'number' &&
    typeof payload.view.lastPushAt === 'number' &&
    payload.view.lastPushAt > m.completedAt
  if (!back) return

  toast.success('Server update complete — the server is back open.', {
    description: 'It is accepting players again and the live feed is flowing.',
  })
}

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
    announceIfBackFromUpdate(data)
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
