import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { ModerationLog, type KickRow } from '@/components/ModerationLog'
import { PageLoading } from '@/components/PageLoading'
import * as audit from '@/lib/audit'
import * as bans from '@/lib/bans'
import { currentAdmin } from '@/lib/session'

/**
 * Kick & ban — the log, not the form.
 *
 * ISSUING MOVED TO THE PLAYER PROFILE, where the license is already in hand.
 * This page used to carry a paste-a-license form, which is right when you are
 * working from a Discord report and wrong the rest of the time: copying an
 * identifier between panels is how the wrong player gets banned. What is left
 * is what the page is actually opened to answer — what has been happening, and
 * to whom.
 *
 * KICKS COME FROM THE AUDIT LOG rather than a table of their own. A kick has no
 * durable state to store: it happened, to someone, for a reason, and the audit
 * row already records all three. Giving it a second home would mean two records
 * of the same act that can disagree.
 */
export const dynamic = 'force-dynamic'

export default async function ModerationPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  return (
    <AppShell
      active="/moderation"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
    >
      <Suspense fallback={<PageLoading />}>
        <Body />
      </Suspense>
    </AppShell>
  )
}

/**
 * The two reads, below the boundary. See `PageLoading` for why it is split.
 *
 * IT WAS THREE. The third was `can(license, 'ban')`, which decided whether the
 * Lift buttons were live and whether a banner appeared above the log explaining
 * that they were not. Scopes are gone — everyone who can open this page can lift
 * a ban — so the read, the prop and the banner all went with them.
 */
async function Body() {
  const [rows, allBans] = await Promise.all([
    audit.recent(200),
    bans.all(),
  ])

  const now = Date.now()

  const kicks: KickRow[] = rows
    .filter((r) => r.action === 'player.kick')
    .map((r) => ({
      ts: r.ts,
      actorName: r.actorName,
      actorLicense: r.actorLicense,
      targetName: r.targetName ?? null,
      targetLicense: r.targetLicense ?? null,
      reason: r.reason ?? null,
      outcome: r.outcome,
    }))

  // Active only. Lifted and expired bans are history, and history belongs in
  // the audit log — a list called "active bans" that contains inactive ones is
  // the sort of thing an admin stops trusting after being wrong once.
  const active = allBans.filter((b) => bans.isActive(b, now))

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Kick &amp; ban</h1>
        <p className="text-sm text-muted-foreground">
          What moderation has done recently. To act on someone, open their
          profile — the live board and search both link straight to it.
        </p>
      </div>

      <ModerationLog kicks={kicks} bans={active} />
    </div>
  )
}
