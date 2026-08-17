import { CircleSlash } from 'lucide-react'
import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { AuditList } from '@/components/AuditList'
import * as audit from '@/lib/audit'
import { currentAdmin } from '@/lib/session'

/**
 * The audit log.
 *
 * SHOWS PENDING ROWS, and that is the point rather than an oversight. An action
 * recorded as intended but never resolved means we asked the game host to do
 * something and never learned whether it happened — a different fact from
 * "it failed", and the one most worth seeing. A log that displayed only
 * resolved rows would hide exactly the actions that went wrong in the most
 * interesting way. The row is still here; it simply no longer wears a label
 * (#19) — see AuditList, which holds the rendering and its reasoning.
 */
export const dynamic = 'force-dynamic'

export default async function AuditPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const rows = await audit.recent(100)

  return (
    <AppShell
      active="/audit"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every action any admin took. Anything marked{' '}
            <span className="text-danger">failed</span> did not happen.
          </p>
        </div>

        <AuditList rows={rows} />

        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <CircleSlash className="size-3" />
          The game server cannot read this table. Its role has no access to it
          at all.
        </p>
      </div>
    </AppShell>
  )
}
