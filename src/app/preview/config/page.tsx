import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { ConfigBoard } from '@/components/ConfigBoard'
import {
  CONFIG_REPORT,
  CONFIG_REPORT_NO_LUA,
  CONFIG_REPORT_STALE,
} from '@/lib/__fixtures__/hostConfig'
import { DEMO_USER } from '@/lib/demo'
import type { HostConfig } from '@/lib/ssh'
import { cn } from '@/lib/utils'

/**
 * Live config, without a game host. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS: this page has two shapes and BOTH of them need a real game box
 * in a particular state to see — one parked on a branch, one on main. That is
 * the same trap `/preview/maintenance` was built for after a shape with no
 * schedule button at all shipped through a green `tsc` and a green `next build`
 * (WillMontgomery/fivem-br-gamemode#146). Neither tool has an opinion about a
 * page that renders the wrong half.
 *
 * The sidebar is part of what is being checked, not scenery: `Live config`
 * should be ABSENT from the nav on `main` and on `unknown`, and present on
 * `parked`, and the off-main banner should follow the same fact. `hostRef` is
 * the harness-only prop that lets the shell be shown that fact; see its comment
 * in AppShell for why it is not a second source of truth.
 *
 * `?state=` picks the case:
 *   parked   on `dev` — the page opens, and the nav entry appears
 *   main     on main — the page explains itself, and the nav entry is gone
 *   unknown  the host has not answered; must behave exactly like main
 *   stale    parked, but the config files changed after FXServer started
 *   nolua    parked, convars readable, the gamemode half unavailable
 *   error    parked, and the SSH round trip failed outright
 *
 * THE LAST THREE ARE THE POINT OF THIS FILE NOW (#21). The populated report
 * needs a game box parked on a branch to see at all; `stale` needs one where
 * somebody has edited a config file and not redeployed; `nolua` needs one with
 * no Lua interpreter installed. Nobody is going to arrange those three states
 * on a live server to check a layout, so without fixtures they would be looked
 * at for the first time when they happened.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

const views: Record<
  string,
  { deployedRef: string | null; report?: HostConfig; error?: string }
> = {
  parked: { deployedRef: 'dev', report: CONFIG_REPORT },
  main: { deployedRef: 'main' },
  unknown: { deployedRef: null },
  stale: { deployedRef: 'dev', report: CONFIG_REPORT_STALE },
  nolua: { deployedRef: 'dev', report: CONFIG_REPORT_NO_LUA },
  error: {
    deployedRef: 'dev',
    error: "ssh: connect to host 10.0.0.20 port 22: Connection timed out",
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

  return (
    <AppShell active="/config" user={DEMO_USER} hostRef={view.deployedRef}>
      <div className="mx-auto max-w-6xl">
        <nav className="mb-5 flex flex-wrap gap-0.5 rounded-lg border border-border bg-card/60 p-1">
          {Object.keys(views).map((k) => (
            <a
              key={k}
              href={`/preview/config?state=${k}`}
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

        <ConfigBoard
          deployedRef={view.deployedRef}
          report={view.report ?? null}
          error={view.error ?? null}
        />

        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground/60">
          Design harness — fixtures only, nothing is read from a game host.
          Deployed ref{' '}
          <code className="font-mono">{view.deployedRef ?? '(not reported)'}</code>
          . Check the sidebar as well as the page: Live config belongs in the
          nav only when parked off <code className="font-mono">main</code>. The
          fixture is real{' '}
          <code className="font-mono">configreport</code> output — no value on
          this page was typed by hand. Not reachable in production.
        </p>
      </div>
    </AppShell>
  )
}
