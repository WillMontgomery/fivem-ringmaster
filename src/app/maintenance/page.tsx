import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { MaintenancePanel } from '@/components/MaintenancePanel'
import { can } from '@/lib/grants'
import * as maint from '@/lib/maintenance'
import { ensureDriver } from '@/lib/maintenanceDriver'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

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
  const [w, canRun] = await Promise.all([
    maint.current(),
    can(admin.license, 'process'),
  ])
  const view = liveView(now)

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
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance</h1>
          <p className="text-sm text-muted-foreground">
            Take the server down gently: stop new players joining, let the
            running matches finish, then deploy the latest code and restart.
          </p>
        </div>

        <MaintenancePanel
          initial={w}
          initialPlayers={view.counts.connected}
          canRun={canRun}
        />
      </div>
    </AppShell>
  )
}
