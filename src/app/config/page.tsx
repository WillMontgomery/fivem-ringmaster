import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { ConfigBoard } from '@/components/ConfigBoard'
import { PageLoading } from '@/components/PageLoading'
import { currentAdmin } from '@/lib/session'
import { isParkedOffMain, readConfig, sshConfigured, type HostConfig } from '@/lib/ssh'
import { ensurePolling, hostView } from '@/lib/telemetry'

/**
 * Live config.
 *
 * THE BRANCH ANSWER IS DERIVED, NEVER STORED. `hostView().status.deployedRef`
 * is the same reading the off-main banner and the maintenance panel are drawn
 * from, recomputed from the host on the poller that is already running. The
 * branch-switch design deliberately keeps no persisted flag for this because a
 * schedule or cancel cycle wipes one (`docs/branch-switch.md` in the game
 * repo), and a second source of truth here would be that flag by another name.
 *
 * THE REPORT IS FETCHED HERE AND PASSED DOWN, so `ConfigBoard` asks nothing and
 * `/preview/config` can render every one of its shapes from a fixture. Same
 * split the board already used for the ref.
 *
 * IT IS FETCHED ON THE PAGE RATHER THAN THROUGH AN API ROUTE AND A POLLER,
 * unlike host telemetry, because config is not a live quantity: it changes when
 * somebody edits a file and redeploys. A fifteen-second poll would spend an SSH
 * round trip per tick to redraw an identical page. Reloading is the refresh.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  /**
   * ADDED WITH THE REAL DATA. The placeholder this replaced rendered no data at
   * all and leaned on the middleware bounce, which is explicitly a fast path
   * and not the boundary (see `src/middleware.ts` — a forged cookie sails
   * through it). This page now shows a live read off the game box, so it does
   * what every other data page does and checks the session itself.
   */
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  return (
    <AppShell active="/config" user={{ name: admin.name, avatarUrl: admin.avatarUrl }}>
      <Suspense fallback={<PageLoading />}>
        <Body />
      </Suspense>
    </AppShell>
  )
}

/**
 * The SSH read, below the boundary. See `PageLoading` for why it is split.
 *
 * THE PAGE THIS MATTERS MOST TO. Everything else here waits on DynamoDB in the
 * same region; this one waits on an SSH round trip to the game box, which is
 * the slowest thing the console does and the one a reader is most likely to
 * think has hung.
 */
async function Body() {
  // Idempotent, and no-ops when the SSH channel is unconfigured. The shell
  // starts it too; this is here so the page is right when rendered first.
  ensurePolling()

  const deployedRef = hostView().status?.deployedRef ?? null

  /**
   * THE SSH CALL IS SKIPPED WHEN THE PAGE IS NOT GOING TO SHOW IT.
   *
   * On a box running main this page renders one card explaining why it is
   * closed, and fetching a report to throw away would put a round trip to the
   * game host behind every stray click on an old bookmark. The condition is the
   * board's own — `isParkedOffMain`, the spelling that treats "the host has not
   * answered" as main — so the two cannot disagree about which shape is being
   * drawn.
   */
  let report: HostConfig | null = null
  let error: string | null = null

  if (isParkedOffMain({ deployedRef: deployedRef ?? undefined })) {
    if (!sshConfigured()) {
      error = 'The command channel to the game server is not configured.'
    } else {
      try {
        report = await readConfig()
      } catch (e) {
        /**
         * An SSH failure here is ordinary — a cold link, a box mid-reboot — and
         * the message is the useful half. It is shown rather than swallowed,
         * for the same reason `/api/host/branches` reports 502 with the text:
         * "could not reach the game server" and "something went wrong" call for
         * completely different next actions.
         *
         * A dispatcher too old to know the verb answers `unknown verb
         * 'configreport'` on stderr and exits 2, which arrives here as an
         * Error — so an un-deployed game host says so instead of showing a
         * blank page.
         */
        error = e instanceof Error ? e.message : String(e)
      }
    }
  }

  return <ConfigBoard deployedRef={deployedRef} report={report} error={error} />
}
