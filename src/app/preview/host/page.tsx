import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { HostCharts } from '@/components/HostCharts'
import { HOST_WINDOWS } from '@/lib/__fixtures__/hostSamples'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { cn } from '@/lib/utils'

/**
 * The host graphs, without a game server. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS, and it is the same argument /preview/anticheat makes: the
 * states these charts have to get right are the ones you cannot summon. Seeing
 * the empty case meant catching a console in the fifteen seconds before its
 * first sample; seeing the one-sample case meant catching it in the fifteen
 * after. Both are states an operator hits every single time they open the page
 * on a cold console, and neither was reviewable, which is exactly how an area
 * chart comes to draw a flat line at zero over a host nobody has heard from.
 *
 * `?state=` picks the window — see HOST_WINDOWS for what each one is.
 *
 * IT RENDERS `HostCharts` DIRECTLY RATHER THAN `HostBoard`. The board owns a
 * five-second poll against /api/host, which is session-guarded and would 401
 * here forever; more to the point, the charts are what is under review and the
 * status cards above them are not. Feeding the component its props is the whole
 * harness.
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewHostPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const key = state && state in HOST_WINDOWS ? state : 'full'
  const samples = HOST_WINDOWS[key]!

  return (
    <AppShell
      active="/host"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: Date.now() - 1_200, bootEpoch: null, now: Date.now() }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Host graphs</h1>

          <nav className="flex gap-0.5 rounded-lg border border-border bg-card/60 p-1">
            {Object.keys(HOST_WINDOWS).map((k) => (
              <a
                key={k}
                href={`/preview/host?state=${k}`}
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
        </div>

        <div className="space-y-4">
          <HostCharts samples={samples} />
        </div>
      </div>
    </AppShell>
  )
}
