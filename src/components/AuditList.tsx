'use client'

import { OctagonX } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { LocalTime } from '@/components/LocalTime'
import { Pager } from '@/components/Pager'
import { Card } from '@/components/ui/card'
import type { AuditRow } from '@/lib/audit'
import { labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

/**
 * Ten a page, matching /moderation.
 *
 * THE SAME ROWS WERE PAGINATED IN ONE PLACE AND NOT THE OTHER. `ModerationLog`
 * takes `audit.recent(200)`, filters it to kicks, and pages it at ten; this file
 * took `audit.recent(100)` and rendered all hundred in one list. So the console
 * paginated a filtered SUBSET of the audit log while showing the raw log whole
 * — on the page whose own heading is "every action any admin took".
 */
const PER_PAGE = 10

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
 * Every time here goes through `LocalTime` with the zone the reader stated, and
 * shows the UTC instant VISIBLY beside it for anyone reconciling against a
 * game-server log.
 *
 * IT USED TO FORMAT ITS OWN TIMES, importing `formatInstant` and `utcIso`
 * directly rather than using `LocalTime` like everything else, and putting the
 * UTC on a `title` attribute. That is how the two drifted: `lib/time.ts` claimed
 * "EVERY DISPLAYED TIME KEEPS ONE" while this file was the only place still
 * doing it by hand. Folding it into `LocalTime` means the next change to how a
 * timestamp reads happens once. This is also the log-correlation surface, so it
 * is the first place the UTC became visible text rather than hover text — and
 * the worst possible place for a popup, at ten rows a page.
 */

const ACTION_LABEL: Record<string, string> = {
  'ban.issue': 'issued a ban',
  'ban.lift': 'lifted a ban',
  'player.kick': 'kicked a player',
  /**
   * #192. THE ONE ROW WHOSE SUBJECT NEVER FINDS OUT.
   *
   * A kick and a ban announce themselves to the person they happen to; this one
   * cannot, or the tool stops working. That is precisely why it is here — "an
   * admin watching a player who does not know they are being watched is exactly
   * the class of action `ringmaster-audit` exists to record". This page is the
   * only place it is ever seen.
   *
   * THE ROW COVERS THE START AND NOT THE END. Nothing in the console stops a
   * session: the admin closes it from the pause menu, or the target disconnects
   * and it closes itself. Both ends reach the game's own event channel as
   * `admin_spectate`; neither is a command anybody issued, so neither writes a
   * row here.
   */
  'player.spectate': 'spectated a player',
  'maintenance.schedule': 'scheduled a server update',
  'maintenance.cancel': 'cancelled the server update',
  'maintenance.drain': 'started draining the server',
  'maintenance.deploy': 'deployed the server update',
  'incident.resolve': 'closed an incident',

  /**
   * THE TWO ROWS NOBODY TOOK. Every other label in this map is an admin doing
   * something; these are the console refusing one, and the wording keeps that
   * distinction rather than blurring it into "tried to". A `discord.revoked`
   * row means the write did not happen and the session was ended in the same
   * breath — and if its outcome is `failed`, the sign-out itself did not work,
   * which the red failure treatment above already makes impossible to skim
   * past. See lib/discordRole.ts.
   */
  'discord.revoked': 'was signed out — their Discord admin role is gone',
  'discord.unresolved': 'acted without a Discord role re-check',
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

/**
 * `prefs` USED TO BE A PROP HERE and is now read from context by `LocalTime`.
 * Threading it in alongside the provider that already holds it gave the zone two
 * sources of truth in one tree — the exact hazard `PrefsProvider`'s own comment
 * warns about, where somebody passes prefs they built locally and reintroduces
 * the ambient-zone bug one component at a time.
 */
export function AuditList({ rows }: { rows: AuditRow[] }) {
  const [page, setPage] = useState(0)

  // Clamped rather than trusted, the same way ModerationLog does it: a refresh
  // that shrinks the list under the current page would otherwise render an
  // empty page above a control insisting there is more.
  const pages = Math.ceil(rows.length / PER_PAGE)
  const current = Math.min(page, Math.max(0, pages - 1))
  const slice = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE)

  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      {rows.length === 0 ? (
        <p className="px-4 py-14 text-center text-sm text-muted-foreground">
          Nothing has been done yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {slice.map((r) => {
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
                    {labelFor(ACTION_LABEL, r.action)}
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
                  <LocalTime
                    ms={r.ts}
                    withYear={false}
                    utc
                    className="block text-xs tabular-nums text-muted-foreground"
                  />
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

      <Pager
        page={current}
        perPage={PER_PAGE}
        total={rows.length}
        onPage={setPage}
        label="Audit log pages"
        className="border-t px-4 py-3"
      />
    </Card>
  )
}
