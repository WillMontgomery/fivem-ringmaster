import { OctagonX } from 'lucide-react'
import Link from 'next/link'

import { Card } from '@/components/ui/card'
import type { AuditRow } from '@/lib/audit'
import type { Prefs } from '@/lib/prefs'
import { formatInstant, utcIso } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * The audit log's rows.
 *
 * A COMPONENT OVER A ROW ARRAY, so the same tree renders from DynamoDB and
 * from a fixture — `/preview/audit` shows every outcome side by side, which is
 * otherwise a state you can only produce by making a real kick fail against a
 * real game host.
 *
 * ONE LABEL, NOT THREE (#19). The record has three outcomes and keeps them:
 * `pending` is an action we dispatched and never heard back about, which is a
 * real and different fact from `failed`, and `lib/audit.ts` exists to preserve
 * exactly that distinction. What changed is only what a reader is shown.
 *
 * "OK" ON EVERY ROW IS NOT INFORMATION. Almost everything succeeds, so a green
 * tick beside almost every line trains the eye to skip the column — which is
 * the column where the one failure lives. And the third label,
 * "unacknowledged", stopped every reader to work out what it meant, for a state
 * that usually resolves to ok a second later.
 *
 * So: failure says so, loudly, in red, with the error underneath it. Everything
 * else says nothing at all, and the row is read for what the admin did.
 *
 * ITS TIMESTAMPS WERE WRONG ONCE, and this is where the preferences feature
 * came from. This renders on the SERVER, so the `toLocaleString(undefined, …)`
 * it used to use resolved `undefined` to the Node process's timezone — the
 * container's, not the reader's — and RSC output is serialised once and never
 * re-executed in the browser, so there was nothing to correct it after mount.
 * Every time here goes through `formatInstant` with the zone the reader stated
 * and carries the UTC instant on `title` for anyone reconciling against a
 * game-server log.
 */

const ACTION_LABEL: Record<string, string> = {
  'ban.issue': 'issued a ban',
  'ban.lift': 'lifted a ban',
  'player.kick': 'kicked a player',
  'maintenance.schedule': 'scheduled a server update',
  'maintenance.cancel': 'cancelled the server update',
  'maintenance.drain': 'started draining the server',
  'maintenance.deploy': 'deployed the server update',
  'incident.resolve': 'closed an incident',
}

/**
 * Actions whose stored reason just repeats the label.
 *
 * A maintenance row's reason is the generated note — "a server update" —
 * sitting directly under a line that already says the admin scheduled a server
 * update. Saying it twice makes the log harder to skim, not more informative.
 */
const REDUNDANT_REASON = new Set([
  'maintenance.schedule',
  'maintenance.cancel',
  'maintenance.drain',
  'maintenance.deploy',
])

/** A name that links to its profile, when we have a license to link to. */
function PersonLink({
  name,
  license,
  className,
}: {
  name: string | null
  license: string | null
  className?: string
}) {
  const label = name ?? 'Unknown'
  if (!license) return <span className={className}>{label}</span>
  return (
    <Link
      href={`/players/${encodeURIComponent(license)}`}
      className={cn(
        'underline-offset-4 transition-colors hover:text-primary hover:underline',
        className,
      )}
    >
      {label}
    </Link>
  )
}

export function AuditList({
  rows,
  prefs,
}: {
  rows: AuditRow[]
  prefs: Prefs
}) {
  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      {rows.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-muted-foreground">
          Nothing has been done yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => {
            const bad = r.outcome === 'failed'
            return (
              <li
                key={`${r.ts}-${r.commandId}`}
                className="flex items-start gap-3 px-4 py-3"
              >
                {/*
                  The marker column is reserved on every row and painted only on
                  the failed ones. Dropping it entirely for the ordinary case
                  would ragged-edge the whole list against the few rows that keep
                  it, which reads as a rendering fault rather than a distinction.
                */}
                <OctagonX
                  aria-hidden={!bad}
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-danger',
                    !bad && 'invisible',
                  )}
                />
                <div className="min-w-0 flex-1">
                  {/* Both names link to their profile. Admins are players too,
                      and "who is this that keeps doing X" is answered fastest
                      by clicking them rather than searching. */}
                  <div className="text-sm">
                    <PersonLink
                      name={r.actorName}
                      license={r.actorLicense}
                      className="font-medium"
                    />{' '}
                    {ACTION_LABEL[r.action] ?? r.action}
                    {r.targetName || r.targetLicense ? (
                      <>
                        {' — '}
                        <PersonLink
                          name={r.targetName ?? r.targetLicense ?? null}
                          license={r.targetLicense ?? null}
                          className="text-muted-foreground"
                        />
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
                  <div
                    className="text-xs tabular-nums text-muted-foreground"
                    title={utcIso(r.ts)}
                  >
                    {formatInstant(r.ts, prefs, { withYear: false })}
                  </div>
                  {bad && (
                    <div className="text-xs uppercase tracking-wider text-danger">
                      failed
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
