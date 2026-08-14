import { notFound } from 'next/navigation'

import { AnticheatBoard, type AnticheatConfig } from '@/components/AnticheatBoard'
import { AppShell } from '@/components/AppShell'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'

/**
 * The anticheat page, without a game server. DEVELOPMENT ONLY.
 *
 * WHY IT EXISTS: the anticheat page is an explainer, and an explainer is judged
 * by reading it. Judging it required a live game host pushing a snapshot, which
 * meant the one page whose whole job is to be legible was the one page nobody
 * could look at. Same reasoning as /preview and as the gamemode's NUI harness.
 *
 * `?state=` picks the case:
 *   current   a server on the shipping build — the normal view
 *   stale     a server still enforcing on its own, so the out-of-date copy shows
 *   unknown   no settings reported at all, which is what a cold console sees
 *
 * The 404 in production is not decoration. This renders admin chrome with no
 * auth, so it must not exist on a deployed box. The check is on NODE_ENV, which
 * Next inlines at build time, so the branch is eliminated from the production
 * bundle rather than merely unreachable.
 */
export default function PreviewAnticheatPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview searchParams={searchParams} />
}

/**
 * Mirrors br_core's own defaults (BR.Config.Combat) rather than round numbers,
 * so the page is reviewed against the copy an admin will actually read.
 */
const CURRENT: AnticheatConfig = {
  action: 'incident',
  limit: 8,
  windowMs: 10_000,
  selfLimit: 2,
  selfWindow: 5_000,
}

const views: Record<string, AnticheatConfig | null> = {
  current: CURRENT,
  stale: { ...CURRENT, action: 'kick' },
  unknown: null,
}

async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const key = state ?? 'current'
  const config = key in views ? (views[key] ?? null) : CURRENT

  return (
    <AppShell
      active="/anticheat"
      user={DEMO_USER}
      badges={DEMO_BADGES}
      feed={{ lastPushAt: Date.now() - 1_200, bootEpoch: 'preview', now: Date.now() }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Anticheat</h1>
          <p className="text-sm text-muted-foreground">
            Every hit is checked against what the server believes. What it
            catches, what happens next, why there is less to catch than you
            might expect — and, importantly, what it cannot see at all.
          </p>
        </div>

        <AnticheatBoard config={config} />
      </div>
    </AppShell>
  )
}
