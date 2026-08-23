import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { MaintenancePanel } from '@/components/MaintenancePanel'
import { PageLoading } from '@/components/PageLoading'
import { can } from '@/lib/grants'
import * as maint from '@/lib/maintenance'
import { ensureDriver } from '@/lib/maintenanceDriver'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'
import { hostView } from '@/lib/telemetry'

/**
 * Scheduled maintenance.
 *
 * Loading this page starts the driver — the timer that advances a window from
 * scheduled to draining to deployed. The same lazy pattern the telemetry poller
 * uses: nothing runs on a console nobody has opened.
 */
export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  ensureDriver()

  const now = Date.now()

  /**
   * THE WINDOW IS READ HERE AND THE SCOPE CHECK IS NOT, because the window
   * decides the sidebar's maintenance badge — shell state — and the scope check
   * only decides whether the panel's buttons are live. So the badge is right
   * from the first paint and the grant lookup happens under the boundary. See
   * `PageLoading`.
   */
  const w = await maint.current()
  const view = liveView(now)

  /**
   * Read AFTER `ensureDriver()`, which starts the telemetry poller. On a
   * console that has just booted these are still null on the first render and
   * the panel's own five-second poll fills them in — which is why the panel
   * treats null as "the host has not said" rather than as "main". A page that
   * guessed `main` for one render would flash the ordinary update card over a
   * parked server, which is the one lie this page must not tell.
   *
   * `refUpdate` is null for longer than `deployedRef` is, and that is expected:
   * it comes from a `branches` call the poller makes on a two-minute cadence
   * rather than from the fifteen-second `status`. The panel renders "we do not
   * know yet" for it, which is true, instead of a zero that would read as "your
   * branch has not moved".
   *
   * `behindMain` IS NULL ON THAT FIRST RENDER TOO, and it is now ALLOWED to be.
   * It used to arrive as `updateAvailable ?? 0` off the maintenance row, which
   * cannot distinguish "the poller has not answered" from "level with main" —
   * so a console that had just booted rendered the empty state, telling an
   * operator there was nothing to deploy on the strength of never having asked.
   * `behindMainNow` returns null there, and null keeps the scheduling box on the
   * page. See `nothingToDeploy`.
   *
   * `updateTarget` is the pair of commits an update would move between, on
   * whichever ref the box is on. Null for longer still — it rides the same
   * two-minute `branches` cadence as `refUpdate` — and the panel simply omits
   * the arrow until it lands rather than guessing at either end.
   *
   * `runningSha` IS THE COMMIT THE BOX IS ON, off the same fifteen-second
   * `status` read as `behindMain` and `deployedRef`. It arrives and goes stale
   * on exactly their cadence, which is the point of taking it from here rather
   * than off the maintenance row: the row's `deployLandedSha` is a record of one
   * past deploy and nothing refreshes it. Null on the first render, like the
   * rest, and the panel renders no commit until it lands.
   */
  const { status, refUpdate, updateTarget } = hostView()
  const deployedRef = status?.deployedRef ?? null
  const behindMain = maint.behindMainNow(status)
  const runningSha = maint.runningShaNow(status)

  return (
    <AppShell
      active="/maintenance"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      badges={{ maintenance: maint.badgeState(w, now) }}
      feed={{
        lastPushAt: view.lastPushAt,
        bootEpoch: view.bootEpoch,
        now,
        live: true,
      }}
    >
      <Suspense fallback={<PageLoading />}>
        <Body
          w={w}
          license={admin.license}
          players={view.counts.connected}
          deployedRef={deployedRef}
          refUpdate={refUpdate}
          behindMain={behindMain}
          updateTarget={updateTarget}
          runningSha={runningSha}
          bootEpoch={view.bootEpoch}
          lastPushAt={view.lastPushAt}
        />
      </Suspense>
    </AppShell>
  )
}

/** The grant lookup, below the boundary. See `PageLoading` for the split. */
async function Body({
  w,
  license,
  players,
  deployedRef,
  refUpdate,
  behindMain,
  updateTarget,
  runningSha,
  bootEpoch,
  lastPushAt,
}: {
  w: Awaited<ReturnType<typeof maint.current>>
  license: string | null
  players: number
  deployedRef: string | null
  refUpdate: ReturnType<typeof hostView>['refUpdate']
  behindMain: number | null
  updateTarget: ReturnType<typeof hostView>['updateTarget']
  runningSha: string | null
  bootEpoch: string | null
  lastPushAt: number | null
}) {
  const canRun = await can(license, 'process')

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
        <p className="text-sm text-muted-foreground">
          Take the server down gently: stop new players joining, let the running
          matches finish, then deploy the latest code and restart.
        </p>
      </div>

      <MaintenancePanel
        initial={w}
        initialPlayers={players}
        canRun={canRun}
        initialDeployedRef={deployedRef}
        initialRefUpdate={refUpdate}
        initialBehindMain={behindMain}
        initialUpdateTarget={updateTarget}
        initialRunningSha={runningSha}
        /*
          THE LIVE FEED AS THE SERVER SEES IT, so the completion gate has an
          answer on first paint. Without it a reload straight after a
          successful deploy shows "waiting for the server" for the two seconds
          until the first poll lands — the page claiming to be waiting on a
          server it is already hearing from. In-memory reads, already taken
          above for the player count.
        */
        initialBootEpoch={bootEpoch}
        initialLastPushAt={lastPushAt}
      />
    </div>
  )
}
