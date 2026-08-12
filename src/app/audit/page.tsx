import { CircleCheck, CircleSlash, OctagonX } from 'lucide-react'
import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { Card } from '@/components/ui/card'
import * as audit from '@/lib/audit'
import { currentAdmin } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * The audit log.
 *
 * SHOWS PENDING ROWS, and that is the point rather than an oversight. An action
 * recorded as intended but never resolved means we asked the game host to do
 * something and never learned whether it happened — a different fact from
 * "it failed", and the one most worth seeing. A log that displayed only
 * resolved rows would hide exactly the actions that went wrong in the most
 * interesting way.
 */
export const dynamic = 'force-dynamic'

/**
 * TWO STATES, NOT THREE.
 *
 * A row starts as `pending` and is stamped when the outcome lands, so the third
 * label only ever showed during the moment in between — and made every reader
 * stop to work out what "unacknowledged" meant. It reads as ok; a real failure
 * still says so loudly, which is the distinction that matters.
 */
const OUTCOME = {
  ok: { icon: CircleCheck, cls: 'text-live', label: 'ok' },
  failed: { icon: OctagonX, cls: 'text-danger', label: 'failed' },
  pending: { icon: CircleCheck, cls: 'text-live', label: 'ok' },
} as const

const ACTION_LABEL: Record<string, string> = {
  'ban.issue': 'issued a ban',
  'ban.lift': 'lifted a ban',
  'player.kick': 'kicked a player',
  'maintenance.schedule': 'scheduled a server update',
  'maintenance.cancel': 'cancelled the server update',
  'maintenance.drain': 'started draining the server',
  'maintenance.deploy': 'deployed the server update',
}

/**
 * Actions whose stored reason just repeats the label.
 *
 * A maintenance row's reason is the generated note — "a server update" — sitting
 * directly under a line that already says the admin scheduled a server update.
 * Saying it twice makes the log harder to skim rather than more informative.
 */
const REDUNDANT_REASON = new Set([
  'maintenance.schedule',
  'maintenance.cancel',
  'maintenance.drain',
  'maintenance.deploy',
])

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
            Every action any admin took, including the ones that failed and the
            ones we never heard back about.
          </p>
        </div>

        <Card className="surface-edge gap-0 overflow-hidden py-0">
          {rows.length === 0 ? (
            <p className="px-4 py-14 text-center text-sm text-muted-foreground">
              Nothing has been done yet.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((r) => {
                const o = OUTCOME[r.outcome] ?? OUTCOME.pending
                const Icon = o.icon
                return (
                  <li
                    key={`${r.ts}-${r.commandId}`}
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <Icon className={cn('mt-0.5 size-4 shrink-0', o.cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <span className="font-medium">{r.actorName}</span>{' '}
                        {ACTION_LABEL[r.action] ?? r.action}
                        {r.targetName || r.targetLicense ? (
                          <>
                            {' — '}
                            <span className="text-muted-foreground">
                              {r.targetName ?? r.targetLicense}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {r.reason && !REDUNDANT_REASON.has(r.action) && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          “{r.reason}”
                        </p>
                      )}
                      {r.error && (
                        <p className="mt-0.5 text-xs text-danger">{r.error}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {new Date(r.ts).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className={cn('text-xs uppercase tracking-wider', o.cls)}>
                        {o.label}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/60">
          <CircleSlash className="size-3" />
          The game server cannot read this table. Its role has no access to it
          at all.
        </p>
      </div>
    </AppShell>
  )
}
