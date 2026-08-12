import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { HostBoard } from '@/components/HostBoard'
import { currentAdmin } from '@/lib/session'
import { ensurePolling, hostView } from '@/lib/telemetry'
import { liveView } from '@/lib/state'

/**
 * Host — CPU, memory, network and process status for the game box.
 *
 * Kicks the poll timer on first load so the graphs have a sample by the time
 * the client's first fetch lands, rather than a blank chart for one interval.
 */
export default async function HostPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  ensurePolling()
  const now = Date.now()
  const feed = liveView(now)

  return (
    <AppShell
      active="/host"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      feed={{ lastPushAt: feed.lastPushAt, bootEpoch: feed.bootEpoch, now, live: true }}
    >
      <div>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Host</h1>
          <p className="text-sm text-muted-foreground">
            The game server box &mdash; whether FXServer is running, which commit
            it is on, and how hard the machine is working.
          </p>
        </div>
        <HostBoard initial={hostView()} />
      </div>
    </AppShell>
  )
}
