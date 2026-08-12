import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { ModerationBoard } from '@/components/ModerationBoard'
import * as bans from '@/lib/bans'
import { can } from '@/lib/grants'
import { currentAdmin } from '@/lib/session'

/**
 * Kick & ban.
 *
 * SLICE 2, BAN HALF. Kicking a connected player needs the live command channel
 * to the game host, which is the next piece; issuing and lifting bans needs
 * only this console and DynamoDB, so it ships first and is useful on its own.
 *
 * `canBan` decides whether the form is drawn. That is a COURTESY, not the
 * boundary — /api/bans re-checks the scope server-side on every call, because
 * a hidden button is hidden only from someone using the browser.
 */
export default async function ModerationPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const [rows, canBan] = await Promise.all([
    bans.all(),
    can(admin.license, 'ban'),
  ])

  return (
    <AppShell
      active="/moderation"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
    >
      <div className="max-w-5xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Kick &amp; ban</h1>
          <p className="text-sm text-muted-foreground">
            Bans are recorded against a license and checked when that player
            connects. Lifting one keeps the record.
          </p>
        </div>

        {!canBan && (
          <p className="mb-4 rounded-md border border-info/30 bg-info/5 px-4 py-3 text-[13px] text-info">
            You can see bans but not issue them — that needs the{' '}
            <code className="font-mono">ban</code> scope.
          </p>
        )}

        <ModerationBoard initial={rows} canBan={canBan} />
      </div>
    </AppShell>
  )
}
