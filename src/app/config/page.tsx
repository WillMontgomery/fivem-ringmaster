import { AppShell } from '@/components/AppShell'
import { ConfigBoard } from '@/components/ConfigBoard'
import { ensurePolling, hostView } from '@/lib/telemetry'

/**
 * Live config.
 *
 * THE ANSWER IS DERIVED, NEVER STORED. `hostView().status.deployedRef` is the
 * same reading the off-main banner and the maintenance panel are drawn from,
 * recomputed from the host on the poller that is already running. The
 * branch-switch design deliberately keeps no persisted flag for this because a
 * schedule or cancel cycle wipes one (`docs/branch-switch.md` in the game
 * repo), and a second source of truth here would be that flag by another name.
 *
 * The board itself takes the ref as a prop and asks nothing, so `/preview/
 * config` can render both of its shapes without a game host — see ConfigBoard.
 */
export const dynamic = 'force-dynamic'

export default function Page() {
  // Idempotent, and no-ops when the SSH channel is unconfigured. The shell
  // starts it too; this is here so the page is right when rendered first.
  ensurePolling()

  return (
    <AppShell active="/config">
      <ConfigBoard deployedRef={hostView().status?.deployedRef ?? null} />
    </AppShell>
  )
}
