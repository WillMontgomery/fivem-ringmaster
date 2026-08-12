import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { ModerationLog, type KickRow } from '@/components/ModerationLog'
import * as audit from '@/lib/audit'
import * as bans from '@/lib/bans'
import { can } from '@/lib/grants'
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

  const [rows, allBans, canBan] = await Promise.all([
    audit.recent(200),
    bans.all(),
    can(admin.license, 'ban'),
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
    <AppShell
      active="/moderation"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Kick &amp; ban</h1>
          <p className="text-sm text-muted-foreground">
            What moderation has done recently. To act on someone, open their
            profile — the live board and search both link straight to it.
          </p>
        </div>

        {!canBan && (
          <p className="mb-4 rounded-md border border-info/30 bg-info/5 px-4 py-3 text-sm text-info">
            You can see this record but not act on it — lifting a ban needs the{' '}
            <code className="font-mono">ban</code> scope.
          </p>
        )}

        <ModerationLog kicks={kicks} bans={active} canBan={canBan} />
      </div>
    </AppShell>
  )
}
