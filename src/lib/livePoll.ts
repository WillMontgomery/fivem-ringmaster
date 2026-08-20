'use client'

import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import type { MaintenanceState } from './maintenance'
import { deployPhase, type DeployPhase } from './serverPhase'
import type { liveView } from './state'

/**
 * One poller, many readers.
 *
 * The header's chips, the live board and the Maintenance page all need the
 * same fresh state, and they are separate client islands — the chips live in
 * the app shell's header, the others in the page body. Giving each its own
 * fetch loop would double every request and let them disagree about the same
 * instant, which for the deploy phase is not cosmetic: two surfaces sampling
 * `lastPushAt` and `completedAt` a second apart can reach opposite conclusions
 * about whether the server is back.
 *
 * So this is a module-level store: whichever component subscribes first starts
 * the interval, the last one out stops it, and every subscriber re-renders on
 * the same tick with the same object.
 *
 * POLLING RATHER THAN SSE settles the question PLAN.md left open. Two seconds
 * is undemanding, a poll survives proxies and reconnects for free, and the
 * failure mode is "data ages" rather than a silently dead socket that looks
 * connected.
 */

export interface MaintenancePhase {
  state: MaintenanceState | null
  completedAt: number | null
  badge: 'scheduled' | 'draining' | 'updating' | null
  /** 0 = the driver has never read the row. Absence, not "no window". */
  at: number

  /**
   * The deploy verdict fields. Optional because an older payload — a browser
   * tab open across a console deploy — carries none of them, and every reader
   * has to treat that as "not known" rather than as "no error, no epoch,
   * never confirmed", which would read as a fresh unconfirmed deploy.
   */
  deployError?: string | null
  deployBootEpoch?: string | null
  deployConfirmedAt?: number | null
}

export interface LivePayload {
  view: ReturnType<typeof liveView>
  now: number
  /** Absent from an older payload; every reader treats that as "not known". */
  maintenance?: MaintenancePhase

  /**
   * Incidents awaiting review — the sidebar's count.
   *
   * IT RIDES THIS POLL FOR THE REASON THE MAINTENANCE PHASE ABOVE DOES: the
   * console is already asking this endpoint every two seconds, and the badge
   * was previously a DynamoDB scan on the critical path of every navigation.
   * Moving it here takes it off that path without inventing a second timer.
   *
   * THREE STATES, ALL DISTINCT AND ALL LOAD-BEARING.
   *   a number  — that many are waiting (0 = the queue is genuinely empty)
   *   null      — we have not managed to count; the badge shows nothing
   *   undefined — an older payload that predates this field; also "not known"
   * A zero and a failure must never render alike. See `lib/incidents`.
   */
  incidents?: number | null
}

const POLL_MS = 2_000

let data: LivePayload | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

/**
 * WHERE THE DEPLOY IS, off one payload — THE shared reading.
 *
 * EXPORTED BECAUSE THREE SURFACES ASK THE SAME QUESTION and must never answer
 * it differently: the header's Updating chip, the Maintenance page's loading
 * state, and the toast below. They do not each assemble the inputs; they call
 * this, over the object this module already holds, so "are we done" has exactly
 * one definition in the browser.
 *
 * NULL PAYLOAD IS `idle`, NOT A GUESS. Before the first poll the console knows
 * nothing about any deploy, and `idle` is the phase that asserts nothing — the
 * same "not knowing shows less" polarity `deployPhase` is built on.
 */
export function phaseOf(payload: LivePayload | null): DeployPhase {
  if (!payload) return 'idle'
  const m = payload.maintenance
  return deployPhase({
    state: m?.state,
    completedAt: m?.completedAt,
    deployError: m?.deployError,
    deployBootEpoch: m?.deployBootEpoch,
    deployConfirmedAt: m?.deployConfirmedAt,
    bootEpoch: payload.view.bootEpoch,
    lastPushAt: payload.view.lastPushAt,
    now: payload.now,
  })
}

/**
 * The phase the last tick saw.
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
 * finished announces nothing. Only an observed CHANGE is a transition; a first
 * reading is not.
 */
let lastPhase: DeployPhase | null = null

/**
 * Say what happened to the deploy — success or either failure.
 *
 * THE OLD PLACE FOR THIS WAS `MaintenancePanel`, firing on the window's state
 * going `deploying -> complete`, and it was wrong twice over. It only existed on
 * /maintenance, so an admin anywhere else in the console was never told; and
 * "complete" is the deploy VERB returning, not FXServer answering, so the toast
 * landed while the feed was still dead and the header still said the server was
 * gone.
 *
 * IT FIRES OFF THE PHASE THE CHIP AND THE PAGE RENDER FROM, which is what makes
 * the three surfaces agree by construction rather than by all three being
 * maintained carefully. And the success case can no longer be reached by a
 * timeout: `confirming` leaving for `idle` requires positive evidence — a
 * heartbeat from a process that is not the one we restarted — because the
 * grace expiring lands in `unconfirmed` instead, which has its own words.
 *
 * ONLY TRANSITIONS OUT OF AN IN-FLIGHT DEPLOY ARE ANNOUNCED. Arriving at
 * `unconfirmed` because the tab was asleep through the whole window is not news
 * to shout; the Maintenance page still states it plainly for anyone who looks.
 */
function announceDeployOutcome(payload: LivePayload): void {
  const phase = phaseOf(payload)
  const prev = lastPhase
  lastPhase = phase

  if (prev === null || prev === phase) return
  if (prev !== 'deploying' && prev !== 'confirming') return

  if (phase === 'idle') {
    toast.success('Server update complete — the server is back open.', {
      description:
        'br_ringmaster is reporting from the restarted server, so the new code is running.',
    })
    return
  }

  if (phase === 'unconfirmed') {
    toast.error('The server has not come back from the update.', {
      description:
        'The deploy ran, but nothing has been heard from br_ringmaster since. The game server may have failed to start.',
    })
    return
  }

  if (phase === 'failed') {
    toast.error('The update failed.', {
      description:
        'The game host refused the deploy. The server is still running the code it was running before.',
    })
  }
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
     * failure still fails quiet: a missed poll is one tick of staleness on a
     * two-second cadence, and a toast for each would be noise. Note what this
     * costs now that the feed chips are gone — a run of failed polls no longer
     * shows up anywhere, where it used to age the Live chip.
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
    announceDeployOutcome(data)
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
