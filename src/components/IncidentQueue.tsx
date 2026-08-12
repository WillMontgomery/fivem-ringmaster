'use client'

import { FileWarning, Flag, Users } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Incident, IncidentCategory, IncidentKind } from '@/lib/incidents'
import { cn } from '@/lib/utils'

/**
 * The queue, and the history behind it.
 *
 * OLDEST FIRST IN THE QUEUE, newest first in history. A queue is worked
 * through: the incident most at risk of being forgotten is the one that has
 * been waiting longest. History is browsed, and there the recent thing is the
 * interesting one.
 */

const KIND_ICON: Record<IncidentKind, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  report: Flag,
  identifier_reuse: Users,
  anticheat: FileWarning,
}

const KIND_TONE: Record<IncidentKind, string> = {
  report: 'bg-info/10 text-info ring-info/25',
  identifier_reuse: 'bg-warn/10 text-warn ring-warn/25',
  anticheat: 'bg-danger/10 text-danger ring-danger/25',
}

function when(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z'
}

function waiting(ms: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ms) / 60_000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function Row({
  i,
  now,
  categoryLabel,
}: {
  i: Incident
  now: number
  categoryLabel: Record<IncidentCategory, string>
}) {
  const Icon = KIND_ICON[i.kind] ?? Flag

  return (
    <Link
      href={`/incidents/${i.incidentId}`}
      className="flex items-start gap-3 border-t border-border/60 px-4 py-3 transition-colors first:border-t-0 hover:bg-card/60"
    >
      <div
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
          KIND_TONE[i.kind],
        )}
      >
        <Icon className="size-3.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{i.subjectName}</span>
          <Badge
            variant="outline"
            className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
          >
            {categoryLabel[i.category] ?? i.category}
          </Badge>
          {i.state === 'resolved' && (
            <Badge
              variant="outline"
              className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
            >
              resolved
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{i.summary}</p>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          {when(i.openedAt)}
          {i.reporterName ? ` · reported by ${i.reporterName}` : ' · filed by the system'}
        </p>
      </div>

      {i.state === 'pending_review' && (
        <span
          className={cn(
            'shrink-0 font-mono text-xs',
            now - i.openedAt > 24 * 3600_000 ? 'text-warn' : 'text-muted-foreground',
          )}
          title="How long this has been waiting"
        >
          {waiting(i.openedAt, now)}
        </span>
      )}
    </Link>
  )
}

const PER_PAGE = 20

type Tab = 'pending' | 'resolved' | 'all'

const EMPTY: Record<Tab, string> = {
  pending: 'Nothing waiting for review.',
  resolved: 'Nothing has been resolved yet.',
  all: 'No incidents have been filed.',
}

export function IncidentQueue({
  pending,
  history,
  now,
  categoryLabel,
}: {
  pending: Incident[]
  history: Incident[]
  now: number
  categoryLabel: Record<IncidentCategory, string>
}) {
  const [tab, setTab] = useState<Tab>('pending')
  const [page, setPage] = useState(0)

  const resolved = history.filter((i) => i.state === 'resolved')
  const rows = tab === 'pending' ? pending : tab === 'resolved' ? resolved : history

  const pages = Math.ceil(rows.length / PER_PAGE)
  // A tab switch can land on a page that does not exist in the new list.
  const current = Math.min(page, Math.max(0, pages - 1))
  const slice = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE)

  const go = (t: Tab) => {
    setTab(t)
    // Back to the top on a tab change. Staying on page 3 of a different list is
    // disorienting in exactly the way that makes people think a filter broke.
    setPage(0)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Things the server could not decide on its own.
        </p>
      </div>

      <div className="flex gap-1">
        {(
          [
            ['pending', `Pending review${pending.length ? ` (${pending.length})` : ''}`],
            ['resolved', 'Resolved'],
            ['all', 'Everything'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              tab === id
                ? 'bg-card text-foreground ring-1 ring-inset ring-border'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Card className="surface-edge animate-rise gap-0 overflow-hidden py-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground/70">{EMPTY[tab]}</p>
        ) : (
          <>
            <div>
              {slice.map((i) => (
                <Row key={i.incidentId} i={i} now={now} categoryLabel={categoryLabel} />
              ))}
            </div>

            {/* Hidden entirely on a single page — pagination controls under a
                six-row list are furniture. */}
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {current * PER_PAGE + 1}–
                  {Math.min((current + 1) * PER_PAGE, rows.length)} of {rows.length}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={current === 0}
                    onClick={() => setPage(current - 1)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={current >= pages - 1}
                    onClick={() => setPage(current + 1)}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
