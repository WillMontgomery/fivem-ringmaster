'use client'

import {
  ArrowUpCircle,
  Check,
  Database,
  GitCommitHorizontal,
  HardDrive,
  Package,
  Power,
  Wifi,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { HostCharts } from '@/components/HostCharts'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { BUNDLE_LABEL, REACH_LABEL } from '@/lib/ddbHealth'
import { commitUrl } from '@/lib/github'
import {
  behindMainNow,
  refBehindNow,
  UPDATE_AVAILABLE,
  UP_TO_DATE,
} from '@/lib/maintenance'
import { cn } from '@/lib/utils'
import type { hostView } from '@/lib/telemetry'

type View = ReturnType<typeof hostView>

/**
 * Host status and telemetry.
 *
 * Polls /api/host every 5s. The refresh to the game box happens on the server
 * on its own timer; this just reads the latest window, so the page stays
 * responsive even when the box across the country is slow to answer.
 */

function duration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function StatCard({
  icon: Icon,
  label,
  children,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  children: React.ReactNode
  tone?: string
}) {
  return (
    <Card className="surface-edge gap-0 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" style={{ color: tone }} />
        {label}
      </div>
      <div className="mt-1.5 text-xl">{children}</div>
    </Card>
  )
}

export function HostBoard({ initial }: { initial: View }) {
  const [view, setView] = useState<View>(initial)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/host', { cache: 'no-store' })
        if (res.ok && alive) setView((await res.json()) as View)
      } catch {
        /* hold the last view; the ages tick up on their own */
      }
    }
    void tick()
    const t = setInterval(tick, 5_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!view.configured) {
    return (
      <Card className="surface-edge items-center px-6 py-16 text-center">
        <p className="text-base text-muted-foreground">
          Host monitoring is not configured yet.
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground/60">
          Once the game host connection is set up in the Ringmaster environment,
          live process, CPU, memory and network metrics appear here. Until then
          this is the correct display, not an error.
        </p>
      </Card>
    )
  }

  const s = view.status
  const samples = view.samples
  const last = samples[samples.length - 1]

  /**
   * IS THERE AN UPDATE, AGAINST WHICHEVER REF THE BOX IS ON, AND IS THAT KNOWN?
   *
   * ONE OF THE TWO ANSWERS, NEVER BOTH, because exactly one of them applies:
   * `behindMainNow` returns null off main and `refBehindNow` returns null on it.
   * `??` picks whichever one is answering — which is not a fallback, it is the
   * one reading that exists. Null out of both means nobody has measured yet, and
   * that is a state this card must render as silence rather than as a verdict.
   */
  const update = behindMainNow(s) ?? refBehindNow(s?.deployedRef, view.refUpdate)

  // The window's span used to be computed here for the sparkline captions.
  // `HostCharts` derives it from the samples it is handed, so it is no longer
  // this component's business.

  return (
    <div className="space-y-4">
      {/*
        FOUR FACTS, AND NOT ONE OF THEM IS ALSO A LINE ON A CHART BELOW.

        WHAT WENT, IN TWO PASSES. First Inbound and Outbound, which carried a
        byte rate and nothing else while the network chart drew both rates
        against a labelled axis. The owner: "on the Host page we don't need
        cards for processor, memory, inbound/outbound when our graphs show
        literally the exact same info".

        THEN PROCESSOR AND MEMORY, WHICH THAT PASS ONLY REDUCED AND SHOULD HAVE
        DELETED. The argument for keeping them was that each carried a second
        reading no chart shows — the core count, and the absolute GB behind a
        percentage drawn on an unnamed ceiling. Both are true and neither earns
        a card. The owner, looking at the result: "The processor card only lists
        number of cores lol, like that is something we should be watching for
        change XD". A LIVE-STATUS CARD IS A THING YOU WATCH, and a core count
        cannot change without the machine being rebuilt underneath it. The GB
        figure went with it: it was the same card's other half, on a row that
        exists to say what is happening right now.

        THE COST, SAID PLAINLY RATHER THAN PATCHED WITH A CAPTION: neither the
        live percentage nor the machine's size is readable as text any more. The
        percentage is the right-hand end of a line on a fixed 0-100 axis, one
        hover or one arrow key away — which is what `accessibilityLayer` on
        those charts is paying for. The size is not on this page at all, and the
        owner has decided it does not need to be.

        THE GRID IS `HostCharts`' GRID, DELIBERATELY — one column, two from
        `lg`, gap-3 — so the card column edges land on the Processor and Memory
        chart edges directly below and the page reads as two columns the whole
        way down. Four cards divide into it exactly, with no stranded card on a
        half-empty row, which is the defect the previous three-wide grid was
        chosen to avoid when there were six and would now cause with four.

        IT IS ALSO THE ONLY WIDTH THE COMMIT CARD SURVIVES, and that was
        measured rather than guessed. `a3f9c21` plus the `Update available`
        badge is 257px of unbreakable inline content; a card needs ~293px to
        hold it. Four columns gives 263px at 1440 and 223px at 1280 — the badge
        pushes 30px and 70px out through the card's own padding. Three gives
        216px at 1024. Two gives 331px at 1024, 459px at 1280 and 779px at 1920,
        and one gives 330px at 375: every card 88px tall, nothing wrapped,
        nothing clipped, at every width this console is opened at.

        ═══ SIX CARDS NOW, AND THE TWO NEW ONES WERE RE-MEASURED ═══

        DynamoDB and br_ddb bundle joined the row. Six still divides into two
        columns exactly — three full rows, no stranded card — which is the
        property this grid was chosen for and which four and six both have and
        five would not.

        MEASURED AT 375px, NOT ASSUMED — `/preview/host?ddb=disconnected` in a
        375px viewport, reading every card's box and the true inline extent of
        its text. All six come back 88px tall and 330px wide, with 294px of
        content box inside each.

        NOTHING WRAPS AND NOTHING IS CLOSE TO IT. The widest new value is
        `Disconnected` at 141px and the widest new label is `BR_DDB BUNDLE` at
        120px — the second of which is not even the widest label on the row,
        since `FXSERVER UPTIME` is 130px. Every one of them has over 150px of
        slack, and the label and the value are on separate lines so neither
        constrains the other. The same pass re-measured the commit card's
        unbreakable 257px, which is the figure recorded above: the method
        agrees with the number this grid was originally chosen for.

        THE 88px IS STRUCTURAL RATHER THAN LUCKY. These are the same `StatCard`
        with the same one-line label and one-line value as the other four, so
        the height cannot diverge without all six diverging together — which is
        why the measurement above reports one distinct height for the row
        rather than six numbers that happen to agree.

        THE OWNER ASKED FOR THE DDB READING BESIDE THE FXSERVER ONE ("Please
        have the DDB status inside the FXServer status box. They can live next
        to each other"), which is why DynamoDB is second in DOM order rather
        than appended: at `lg` it lands directly beside FXServer, and at 375px
        it lands directly under it. Either way they are read together.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StatCard icon={Power} label="FXServer" tone={s?.running ? 'var(--live)' : 'var(--danger)'}>
          {s ? (
            <span className={s.running ? 'text-live' : 'text-danger'}>
              {s.running ? 'Running' : 'Down'}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>

        {/*
          ═══ FACT ONE: CAN br_ddb TALK TO DYNAMODB RIGHT NOW ═══

          THE SAME VISUAL LANGUAGE AS `FXServer: Running` DIRECTLY BESIDE IT,
          deliberately — live green, danger red, and an em-dash for silence —
          because it is the same KIND of statement: a process-level yes or no
          about the box, read at a glance, on a row of live readings.

          THREE STATES AND THE THIRD IS NOT A FAILURE. `unknown` is a console
          that has not been pushed to yet, a game build that predates the probe,
          a br_ddb that never started, and a probe that has aged out. All four
          render the same em-dash every other card here uses for "not told". A
          red `Disconnected` on a console that simply has not looked would train
          the owner to ignore the one that means it — which is the entire reason
          `reachNow` returns three values and not a boolean.

          THIS CARD IS THE QUIET HALF. It states the reading and does nothing
          else; the chip, the banner and the fix popup that a real failure earns
          live in the chrome (`DdbHealth`) so they are on every page rather than
          only on the one you had to already suspect.
        */}
        <StatCard
          icon={Database}
          label="DynamoDB"
          tone={
            view.ddb.reach === 'connected'
              ? 'var(--live)'
              : view.ddb.reach === 'unreachable'
                ? 'var(--danger)'
                : undefined
          }
        >
          <span
            className={
              view.ddb.reach === 'connected'
                ? 'text-live'
                : view.ddb.reach === 'unreachable'
                  ? 'text-danger'
                  : 'text-muted-foreground'
            }
          >
            {REACH_LABEL[view.ddb.reach]}
          </span>
        </StatCard>

        <StatCard icon={Power} label="FXServer uptime">
          <span className="font-mono">
            {s?.running ? duration(s.uptimeSec) : '—'}
          </span>
        </StatCard>

        {/*
          ═══ FACT TWO, AND IT IS NOT THE SAME FACT ═══

          A bundle that matches its manifest still cannot reach AWS, and a bundle
          that does not match connects perfectly well. This card answers "is the
          box running the br_ddb bundle its own manifest describes"; the one
          above answers "does that bundle work". Merging them into a single
          br_ddb light would leave the operator knowing something is wrong and
          not which thing to go and fix.

          `Matches`, NOT `Verified`, AND THE WORD IS LOAD-BEARING. The box has
          the bundle and the manifest and NO SOURCE TREE, so what can be checked
          there is one sha256 against the hash recorded beside it. That catches
          an rsync that did not finish and a bundle patched by hand. It does not
          prove the bundle was rebuilt from current source — that is
          `tools/verify.sh`'s job before a commit lands — and it is not tamper
          detection, because the manifest sits in the same directory as the
          thing it describes. See lib/ddbHealth, which says so at length.
        */}
        <StatCard
          icon={Package}
          label="br_ddb bundle"
          tone={
            view.bundle === 'matched'
              ? 'var(--live)'
              : view.bundle === 'mismatched'
                ? 'var(--danger)'
                : undefined
          }
        >
          <span
            className={
              view.bundle === 'matched'
                ? 'text-live'
                : view.bundle === 'mismatched'
                  ? 'text-danger'
                  : 'text-muted-foreground'
            }
          >
            {BUNDLE_LABEL[view.bundle]}
          </span>
        </StatCard>

        {/*
          THREE STATES, NOT TWO, AND THE THIRD IS THE ONE THIS CARD WAS GETTING
          WRONG. It read `s.behindMain > 0 ? behind : "up to date"`, which makes
          "up to date" the answer to every question that is not a positive
          number — including a host parked on a branch, where `behindMain` is a
          large permanent distance nobody is acting on, and including a
          dispatcher too old to report the field at all. A green tick claiming
          the server is current is a claim; the absence of one is not.

          SO THE READING COMES FROM THE SHARED DERIVATIONS. `behindMainNow` on
          main, `refBehindNow` off it — the same two functions the header chip,
          the toast and the maintenance card use — and each returns null for "we
          have not been told". Null renders the commit as a plain fact with no
          verdict beside it, which is the honest third state.

          AND NO COUNT, per #26. The badge said "3 behind" with nothing naming
          what it was behind, on a card that is visible while the server is
          parked on a branch — the exact ambiguity that got the number deleted
          from the update banner. What is left says there is an update and names
          the ref it is against; the two commits themselves are on the page this
          links to.
        */}
        <StatCard icon={GitCommitHorizontal} label="Commit">
          {!s ? (
            <span className="text-muted-foreground">—</span>
          ) : update !== null && update > 0 ? (
            // There is an update: the commit is a call to action, so it links
            // to where the deploy happens rather than to what the commit is.
            <Link
              href="/maintenance"
              className="group inline-flex items-center gap-2 transition-colors hover:text-info"
            >
              <code className="font-mono text-base">{s.commit}</code>
              {/*
                THE LABEL IS IMPORTED, NOT TYPED OUT, and that is the fix rather
                than the three words. This chip read "update on dev" for a
                fortnight AFTER the owner asked for "UPDATE AVAILABLE", because
                the correction was applied to `UpdateBadge`, which had its own
                copy of the string, and nobody knew this second copy existed.
                Both now render `UPDATE_AVAILABLE` from lib/maintenance, beside
                the `behindMainNow`/`refBehindNow` reading they already share.
              */}
              <Badge className="gap-1 border-0 bg-info/10 text-xs font-semibold uppercase tracking-wider text-info ring-1 ring-inset ring-info/30">
                <ArrowUpCircle className="size-3" />
                {UPDATE_AVAILABLE}
              </Badge>
            </Link>
          ) : (
            // Current, or not yet known. Either way the commit is a fact and
            // links to what it is; only a KNOWN zero earns the green tick.
            <a
              href={commitUrl(s.sha ?? s.commit)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 transition-colors hover:text-primary"
            >
              <code className="font-mono text-base underline decoration-dotted underline-offset-4">
                {s.commit}
              </code>
              {update === 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-live">
                  <Check className="size-3" />
                  {UP_TO_DATE}
                </span>
              )}
            </a>
          )}
        </StatCard>

        {/* NO CHART DRAWS DISK. `do_telemetry` reports it and this is its only
            reader, so this card is not a duplicate of anything. */}
        <StatCard icon={HardDrive} label="Disk free">
          <span className="font-mono">
            {last && last.diskTotalKb > 0
              ? `${Math.round((last.diskAvailKb / last.diskTotalKb) * 100)}%`
              : '—'}
          </span>
        </StatCard>
      </div>

      <HostCharts samples={samples} />

      <div className="flex items-center justify-between text-xs text-muted-foreground/60">
        <span>
          {samples.length} sample{samples.length === 1 ? '' : 's'}
          {view.statusAgeMs !== null && ` · updated ${Math.round(view.statusAgeMs / 1000)}s ago`}
        </span>
        {view.lastError && (
          <span className={cn('flex items-center gap-1.5 text-warn')}>
            <Wifi className="size-3" />
            last update failed
          </span>
        )}
      </div>
    </div>
  )
}
