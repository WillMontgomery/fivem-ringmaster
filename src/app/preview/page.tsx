import { notFound } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

import { LiveBoard } from '@/components/LiveBoard'
import { cn } from '@/lib/utils'

import { synthSnapshot } from '@/lib/__fixtures__/synth'

/**
 * The design harness. DEVELOPMENT ONLY.
 *
 * Renders the live board from the committed fixture, so the whole surface can
 * be reviewed before the game half exists and without a Discord login. The
 * gamemode's NUI has the same thing for the same reason: a UI you can only see
 * by playing a match is a UI nobody iterates on.
 *
 * THE 404 IN PRODUCTION IS NOT DECORATION. This route deliberately sits
 * outside the session middleware's reach conceptually — it renders admin
 * chrome with no auth at all — so it must not exist on a deployed box. The
 * check is on NODE_ENV, which Next inlines at build time, so the branch is
 * eliminated from the production bundle rather than merely unreachable.
 */
export default function PreviewPage({
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

  // Synthesised and then parsed through the real schema. If the shape drifts
  // from the contract, this page fails exactly where ingest would.
  const env = synthSnapshot()

  const base = {
    online: true,
    ageMs: 1_200,
    lastPushAt: 0, // replaced per-view below; the chip needs an absolute stamp
    bootEpoch: env.server.bootEpoch,
    counts: env.snapshot.counts,
    truncated: env.snapshot.truncated,
    // The harness renders chrome, not the Anticheat page; null is the honest
    // stand-in rather than an invented threshold.
    anticheat: null,
    matches: env.snapshot.matches,
    players: env.snapshot.players,
    snapshotClock: { wallMs: env.server.wallMs, gameMs: env.server.gameMs },
    stats: {
      snapshots: 412,
      snapshotsStale: 3,
      eventsApplied: 57,
      eventsDuplicate: 12,
    },
  }

  // The states worth being able to look at deliberately, because each is a
  // real thing an operator will see and each has to read correctly.
  const views = {
    live: base,
    stale: { ...base, ageMs: 14_000 },
    lost: { ...base, ageMs: 91_000 },
    truncated: { ...base, truncated: true },
    offline: {
      ...base,
      online: false,
      ageMs: null,
      lastPushAt: null,
      bootEpoch: null,
      counts: { connected: 0, inMatch: 0 },
      matches: [],
      players: [],
    },
  }

  const now = Date.now()
  const key = (state ?? 'live') as keyof typeof views
  const view = views[key] ?? views.live

  return (
    <AppShell
      active="/"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{
        lastPushAt: view.ageMs === null ? null : now - view.ageMs,
        bootEpoch: view.bootEpoch,
        now,
      }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Live players
            </h1>
            <p className="text-sm text-muted-foreground">
              Everyone on the server right now, by match and squad.
            </p>
          </div>

          <nav className="flex gap-0.5 rounded-lg border border-border bg-card/60 p-1">
            {Object.keys(views).map((k) => (
              <a
                key={k}
                href={`/preview?state=${k}`}
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

        <LiveBoard view={view} now={now} />

        <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground/60">
          Design harness — rendered from{' '}
          <code className="font-mono">
            src/lib/__fixtures__/ingest-snapshot.json
          </code>
          , the same committed artifact{' '}
          <code className="font-mono">br_ringmaster</code> is built against. Not
          reachable in production.
        </p>
      </div>
    </AppShell>
  )
}
