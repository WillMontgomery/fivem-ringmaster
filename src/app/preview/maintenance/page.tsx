import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { MaintenancePanel } from '@/components/MaintenancePanel'
import { DEMO_USER } from '@/lib/demo'
import { AUTO_AFTER_MS, type MaintenanceWindow } from '@/lib/maintenance'
import type { RefUpdate } from '@/lib/ssh'
import { cn } from '@/lib/utils'

/**
 * The maintenance page, without a game host. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS: this panel has more shapes than any other page in the console
 * — on main with an update, on main with nothing to do, parked on a branch,
 * a window draining, a window that switches branch — and every one of them
 * needs a live game box in a particular state to see. That is how
 * WillMontgomery/fivem-br-gamemode#146 shipped: the parked-on-a-branch shape
 * had no schedule button at all, which is obvious in two seconds of looking and
 * invisible in a type check. `tsc` and `next build` both pass on a page that
 * renders nothing, and they both passed on this one.
 *
 * `?state=` picks the case:
 *   parked         on `dev`, host has not said how far behind `dev` it is
 *   parked-behind  on `dev`, THREE NEW COMMITS ON `dev` — the discovered update
 *   parked-level   on `dev`, level with it — nothing new, button still offered
 *   parked-live    on `dev`, a plain update scheduled and draining
 *   parked-switch  on `dev`, a window that switches to another branch
 *   main-update    on main, three commits behind — the ordinary case
 *   main-current   on main, nothing to deploy
 *   unknown        the host has not said which ref it is on
 *
 * THE THREE PARKED SHAPES ARE THE POINT OF THE NEW ONES. "Behind its branch",
 * "level with its branch" and "we have not been told" are three different
 * sentences on the same card, and only the first is an update waiting. They are
 * indistinguishable in a type check and each needs a live game box in a
 * particular state to see, which is the same argument that produced this file.
 *
 * The panel is passed `frozen` so it holds the fixture instead of polling the
 * real console out from under it. See the prop's own comment.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const NOW = Date.now()

/** The fields every window carries, so each view below states only what it varies. */
const BASE: MaintenanceWindow = {
  id: 'current',
  state: 'complete',
  createdAt: NOW - 40 * 60_000,
  createdBy: null,
  createdByName: 'system',
  note: '',
  drainStartsAt: 0,
  deployMode: 'when-empty',
  deployAt: null,
  updateAvailable: 0,
  updateFirstSeenAt: null,
}

/** A window an admin scheduled a few minutes ago and is now watching drain. */
const DRAINING: MaintenanceWindow = {
  ...BASE,
  state: 'draining',
  createdAt: NOW - 6 * 60_000,
  createdBy: 'license:abc123',
  createdByName: 'Will',
  note: 'a server update',
  drainStartsAt: NOW - 5 * 60_000,
  drainStartedAt: NOW - 5 * 60_000,
}

interface View {
  /** What the host says it is running. `null` is a host that has not answered. */
  deployedRef: string | null
  /**
   * How far behind its own branch the box is. `null` is "not known", which is
   * a state in its own right and NOT the same as zero — see the panel's prop.
   */
  refUpdate: RefUpdate | null
  window: MaintenanceWindow | null
  players: number
}

/**
 * A reading of the parked branch, as the telemetry poller would hold one.
 *
 * The shas are fixtures and deliberately look like shas: this object is what a
 * `branches` answer collapses to, and a reviewer comparing this harness against
 * the real page should be able to tell at a glance that nothing here was
 * invented in a different shape from the real thing.
 */
const refAt = (ref: string, behind: number): RefUpdate => ({
  ref,
  behind,
  tipSha: '9c1e77a4b02d5f38e6ab41cc7d90e2f5138ba604',
  deployedSha: '4f2b9c1de8a7365019bd4ac2e5f80917bb3c6d24',
  stale: false,
  at: NOW - 30_000,
})

const views: Record<string, View> = {
  /**
   * THE BUG STATE, AND STILL A REACHABLE ONE. Parked on `dev` with no reading
   * of the branch yet — a console that has just booted, a host that is not
   * answering, or a branch deleted from the remote. `updateAvailable` is held
   * at zero by the driver because distance-from-main is not what a parked box
   * is tracking. Before #146 this rendered the off-main banner and then nothing
   * at all; it must now render the card, the button, and no commit count.
   */
  parked: { deployedRef: 'dev', refUpdate: null, window: BASE, players: 7 },

  /**
   * THE STATE THIS FEATURE EXISTS FOR. Somebody pushed three commits to the
   * branch the live server is running, and the console found them without being
   * asked. Note `updateAvailable` is still zero: the distance from main is
   * untouched and this number is a different one, which is why the badge here
   * has to name `dev` and the main card's has to name main.
   */
  'parked-behind': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    window: BASE,
    players: 7,
  },

  /**
   * Parked and level with the branch. The card and its button stay — a deploy
   * here still re-syncs resources — but the page must not imply an update is
   * waiting, and must not be confused with the `parked` shape above.
   */
  'parked-level': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 0),
    window: BASE,
    players: 7,
  },

  /** A plain update of the parked branch, mid-drain. No `targetRef`: not a switch. */
  'parked-live': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    window: DRAINING,
    players: 3,
  },

  /** A branch switch, which is the pinned-sha path and reads differently. */
  'parked-switch': {
    deployedRef: 'dev',
    refUpdate: refAt('dev', 3),
    window: {
      ...DRAINING,
      targetRef: 'feature/loot-v2',
      targetSha: '4f2b9c1de8a7365019bd4ac2e5f80917bb3c6d24',
    },
    players: 3,
  },

  /** The ordinary case: on main, behind, with the 72-hour clock running. */
  'main-update': {
    deployedRef: 'main',
    refUpdate: null,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
    },
    players: 12,
  },

  /** On main, level with it — the empty state. */
  'main-current': {
    deployedRef: 'main',
    refUpdate: null,
    window: BASE,
    players: 12,
  },

  /**
   * A dispatcher too old to report its ref. Deliberately in the set: "unknown"
   * must keep behaving exactly like main here, which is the opposite polarity
   * to the automation gate, and it is the regression that would be easiest to
   * cause while fixing the parked case.
   */
  unknown: {
    deployedRef: null,
    refUpdate: null,
    window: {
      ...BASE,
      updateAvailable: 3,
      updateFirstSeenAt: NOW - 20 * 60 * 60_000,
    },
    players: 12,
  },
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const key = state && state in views ? state : 'parked'
  const view = views[key]!

  const deadline = view.window?.updateFirstSeenAt
    ? view.window.updateFirstSeenAt + AUTO_AFTER_MS
    : null

  return (
    <AppShell
      active="/maintenance"
      user={DEMO_USER}
      badges={{
        maintenance:
          view.window?.state === 'draining'
            ? 'draining'
            : view.window?.state === 'scheduled'
              ? 'scheduled'
              : null,
      }}
      feed={{ lastPushAt: NOW - 1_200, bootEpoch: 'preview', now: NOW }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Maintenance
            </h1>
            <p className="text-sm text-muted-foreground">
              Take the server down gently: stop new players joining, let the
              running matches finish, then deploy the latest code and restart.
            </p>
          </div>
        </div>

        <nav className="mb-5 flex flex-wrap gap-0.5 rounded-lg border border-border bg-card/60 p-1">
          {Object.keys(views).map((k) => (
            <a
              key={k}
              href={`/preview/maintenance?state=${k}`}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs uppercase tracking-wider transition-colors',
                k === key
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k}
            </a>
          ))}
        </nav>

        <MaintenancePanel
          initial={view.window}
          initialPlayers={view.players}
          canRun
          initialDeployedRef={view.deployedRef}
          initialRefUpdate={view.refUpdate}
          frozen
        />

        {/*
          THE FOOTER STATES BOTH DISTANCES SEPARATELY, because the whole failure
          mode this harness is here to catch is the two being read as one. If
          the card above ever shows a count that matches neither line here, that
          is the bug.
        */}
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground/60">
          Design harness — fixtures only, nothing is read from a game host and
          the panel does not poll. Deployed ref{' '}
          <code className="font-mono">{view.deployedRef ?? '(not reported)'}</code>
          , {view.window?.updateAvailable ?? 0} behind main, behind its own
          branch{' '}
          {view.refUpdate
            ? `${view.refUpdate.behind} (${view.refUpdate.ref})`
            : '(not known)'}
          {deadline ? ', automatic deadline set' : ', no automatic deadline'}.
          Not reachable in production.
        </p>
      </div>
    </AppShell>
  )
}
