'use client'

import { FileWarning, Flag, Users } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { LocalTime } from '@/components/LocalTime'
import { Pager } from '@/components/Pager'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
          <LocalTime ms={i.openedAt} />
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

/**
 * One tab's list, and the pagination under it.
 *
 * THE PAGE LIVES IN HERE NOW, one per tab, and that is what preserves the
 * reset. It used to be a single `page` in the parent that a `go(t)` handler
 * zeroed on every tab change, because staying on page 3 of a list you just
 * swapped out reads as a broken filter. Base UI tabs default to
 * `keepMounted={false}`, so switching tabs unmounts this panel and takes its
 * page with it — the same reset, now falling out of the structure instead of
 * being remembered by hand. If `keepMounted` is ever set on these panels, the
 * explicit reset has to come back with it.
 */
function QueuePanel({
  rows,
  empty,
  now,
  categoryLabel,
}: {
  rows: Incident[]
  empty: string
  now: number
  categoryLabel: Record<IncidentCategory, string>
}) {
  const [page, setPage] = useState(0)

  const pages = Math.ceil(rows.length / PER_PAGE)
  // Guard against a list that shrank under the page we are on — resolving an
  // incident moves a row out of `pending` while this is mounted.
  const current = Math.min(page, Math.max(0, pages - 1))
  const slice = rows.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE)

  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground/70">{empty}</p>
      ) : (
        <>
          <div>
            {slice.map((i) => (
              <Row key={i.incidentId} i={i} now={now} categoryLabel={categoryLabel} />
            ))}
          </div>

          <Pager
            page={current}
            perPage={PER_PAGE}
            total={rows.length}
            onPage={setPage}
            className="border-t border-border px-4 py-3"
          />
        </>
      )}
    </Card>
  )
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
  const resolved = history.filter((i) => i.state === 'resolved')

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Things the server could not decide on its own.
        </p>
      </div>

      {/*
        REAL TABS, and uncontrolled — unlike the profile page's incidents panel,
        nothing outside these panels reads which one is open, so there is no
        state left to hold.

        THE COUNT RULE IS UNCHANGED and is deliberately not the profile page's.
        "Pending review (7)" earns its number because a queue depth is the one
        figure this screen exists to show; it disappears at zero because
        "Pending review (0)" is a worse way of saying the panel below already
        says "Nothing waiting for review." The other two tabs never carry one —
        the size of "Everything" is not a thing anybody is waiting on.

        `animate-rise` moved off the card and onto the root so it plays once on
        arrival. Left on the card it would replay in full on every tab click,
        now that the card unmounts.
      */}
      <Tabs defaultValue="pending" className="animate-rise gap-4">
        <TabsList>
          <TabsTrigger value="pending">
            Pending review{pending.length ? ` (${pending.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="all">Everything</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <QueuePanel
            rows={pending}
            empty={EMPTY.pending}
            now={now}
            categoryLabel={categoryLabel}
          />
        </TabsContent>
        <TabsContent value="resolved">
          <QueuePanel
            rows={resolved}
            empty={EMPTY.resolved}
            now={now}
            categoryLabel={categoryLabel}
          />
        </TabsContent>
        <TabsContent value="all">
          <QueuePanel
            rows={history}
            empty={EMPTY.all}
            now={now}
            categoryLabel={categoryLabel}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
