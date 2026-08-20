'use client'

import { FileWarning, Flag, Users } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { LocalTime } from '@/components/LocalTime'
import { Pager } from '@/components/Pager'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { incidentChips, incidentHeadline } from '@/lib/incidentChip'
import type {
  Incident,
  IncidentCategory,
  IncidentKind,
  VerdictAction,
} from '@/lib/incidents'
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

/**
 * How long ago this was filed. "12m ago".
 *
 * IT USED TO READ "12m waiting", IN AMBER PAST A DAY. The owner: "Incidents in
 * the queue need to not say 'waiting' but instead maybe like 'ago' or
 * something. And that doesn't need to be any special color."
 *
 * "AGO" IS THE HONEST WORD ANYWAY, and the ambiguity the old label was written
 * to resolve is resolved better by it. "3d" beside an opened-at timestamp could
 * be an age or a deadline; "3d waiting" fixed that by asserting the row is
 * still being waited on, which is a claim about a QUEUE. "3d ago" fixes it by
 * naming the direction, which is a fact about a TIMESTAMP — and it stays true
 * on a row that is nobody's job any more.
 *
 * THE COLOUR IS GONE WITH IT. Amber past 24 hours was the console deciding, on
 * a fixed threshold nobody set, which incidents an operator should feel bad
 * about; the queue is already sorted oldest-first, so the row that has waited
 * longest is the one at the top whether or not it is coloured.
 */
function ago(ms: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ms) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function Row({
  i,
  now,
  categoryLabel,
  verdictLabel,
}: {
  i: Incident
  now: number
  categoryLabel: Record<IncidentCategory, string>
  verdictLabel: Record<VerdictAction, string>
}) {
  const Icon = KIND_ICON[i.kind] ?? Flag
  const chips = incidentChips(i, verdictLabel)

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
          {/*
            THE CATEGORY CHIP IS GONE, AND SO IS THE SYSTEM ONE (owner,
            playtest): "Any time an incident is listed, we don't need a chip
            telling us what the incident was for if the description already
            tells us", and "SYSTEM doesn't need to be its own chip on those."

            Both halves of this row's category chip were saying something the
            line directly beneath it already says. On a player report the
            description reads "Reported for Abusive chat" and the chip read
            "ABUSIVE CHAT" a few pixels above it. On a system-filed case the
            chip read "SYSTEM", which is not a thing anybody reported anybody
            for — it is the absence of a reporter, and the row's own footer says
            "filed by System".

            WHAT IS LEFT IN THIS SLOT IS THE OUTCOME (#28), which is not
            duplicated anywhere on the row: whether the case is closed and
            whether anything happened to the player. See `incidentChips` for why
            that is now two chips rather than one compound label.

            PENDING ROWS CARRY NO CHIP HERE, which is why this is guarded rather
            than left to the helper: the queue tab is entirely pending, so a
            "pending review" badge on every row would be noise. The profile
            mixes both and shows it.
          */}
          {i.state === 'resolved' &&
            chips.map((chip) => (
              <Badge
                key={chip.label}
                variant="outline"
                className={cn(
                  'border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                  chip.tone,
                )}
              >
                {chip.label}
              </Badge>
            ))}
        </div>
        {/*
          THE DESCRIPTION, WHICH FOR A PLAYER REPORT THE CONSOLE COMPOSES.
          The stored summary is the game's, and for reports it interpolates the
          raw category id — "Reported for abusive_chat by Xeon". See
          `incidentHeadline`: the id is mapped through CATEGORY_LABEL and the
          filer's name is left to the line below, which already carries it.
        */}
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {incidentHeadline(i, categoryLabel)}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/70">
          <LocalTime ms={i.openedAt} />
          {/*
            "FILED BY THE SYSTEM" WAS THE OWNER'S WORD FOR IT: "sounds cheesy.
            How about filed by `System`." Which is also the name the timeline
            has always used for the same actor — `byName: 'System'` on every
            event `lib/incidents` writes without a human — so this row now
            agrees with the case page it links to rather than paraphrasing it.
          */}
          {i.reporterName ? ` · reported by ${i.reporterName}` : ' · filed by System'}
        </p>
      </div>

      {/* THE AGE, ON PENDING ROWS ONLY. A resolved incident's age is not what
          anybody is reading it for, and the row's timestamp above is already
          the answer for those. A tooltip here would be a trap: this span is
          inside the row's `<Link>`, and a default `TooltipTrigger` renders a
          `<button>`, which is invalid inside an `<a>`. */}
      {i.state === 'pending_review' && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {ago(i.openedAt, now)}
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
  verdictLabel,
}: {
  rows: Incident[]
  empty: string
  now: number
  categoryLabel: Record<IncidentCategory, string>
  verdictLabel: Record<VerdictAction, string>
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
              <Row
                key={i.incidentId}
                i={i}
                now={now}
                categoryLabel={categoryLabel}
                verdictLabel={verdictLabel}
              />
            ))}
          </div>

          <Pager
            page={current}
            perPage={PER_PAGE}
            total={rows.length}
            label="Incident queue pages"
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
  verdictLabel,
}: {
  pending: Incident[]
  history: Incident[]
  now: number
  categoryLabel: Record<IncidentCategory, string>
  /**
   * Passed in like `categoryLabel`, and for the same reason: `lib/incidents`
   * owns the labels and is server-only (it reaches DynamoDB), so a client
   * component takes the map as a prop rather than importing the module.
   */
  verdictLabel: Record<VerdictAction, string>
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
            verdictLabel={verdictLabel}
          />
        </TabsContent>
        <TabsContent value="resolved">
          <QueuePanel
            rows={resolved}
            empty={EMPTY.resolved}
            now={now}
            categoryLabel={categoryLabel}
            verdictLabel={verdictLabel}
          />
        </TabsContent>
        <TabsContent value="all">
          <QueuePanel
            rows={history}
            empty={EMPTY.all}
            now={now}
            categoryLabel={categoryLabel}
            verdictLabel={verdictLabel}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
