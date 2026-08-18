'use client'

import {
  ArrowUpCircle,
  Check,
  GitCommitHorizontal,
  HardDrive,
  Power,
  Wifi,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Sparkline } from '@/components/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { commitUrl } from '@/lib/github'
import { behindMainNow, refBehindNow } from '@/lib/maintenance'
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

function human(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

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
  const updateRef = s?.deployedRef && s.deployedRef !== 'main' ? s.deployedRef : 'main'

  // How much wall-clock the window spans, for the graph axes.
  const spanSec =
    samples.length > 1 ? (last!.at - samples[0]!.at) / 1000 : 0
  const axisLeft = spanSec > 0 ? `${duration(spanSec)} ago` : undefined

  return (
    <div className="space-y-4">
      {/* Status row: the facts that answer "is it up and current". */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Power} label="FXServer" tone={s?.running ? 'var(--live)' : 'var(--danger)'}>
          {s ? (
            <span className={s.running ? 'text-live' : 'text-danger'}>
              {s.running ? 'Running' : 'Down'}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </StatCard>

        <StatCard icon={Power} label="FXServer uptime">
          <span className="font-mono">
            {s?.running ? duration(s.uptimeSec) : '—'}
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
              <Badge className="gap-1 border-0 bg-info/10 text-xs font-semibold uppercase tracking-wider text-info ring-1 ring-inset ring-info/30">
                <ArrowUpCircle className="size-3" />
                update on {updateRef}
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
                  up to date
                </span>
              )}
            </a>
          )}
        </StatCard>

        <StatCard icon={HardDrive} label="Disk free">
          <span className="font-mono">
            {last && last.diskTotalKb > 0
              ? `${Math.round((last.diskAvailKb / last.diskTotalKb) * 100)}%`
              : '—'}
          </span>
        </StatCard>
      </div>

      {/* Graphs. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="surface-edge px-4 py-4">
          <Sparkline
            label="CPU"
            values={samples.map((x) => x.cpuPct)}
            max={100}
            color="var(--primary)"
            current={last?.cpuPct ?? 0}
            format={(v) => `${Math.round(v)}%`}
            height={84}
            axisLeft={axisLeft}
          />
          <p className="mt-1 text-xs text-muted-foreground/60">
            {last ? `${last.cores} cores` : ''}
          </p>
        </Card>

        <Card className="surface-edge px-4 py-4">
          <Sparkline
            label="Memory"
            values={samples.map((x) => x.memPct)}
            max={100}
            color="var(--info)"
            current={last?.memPct ?? 0}
            format={(v) => `${Math.round(v)}%`}
            height={84}
            axisLeft={axisLeft}
          />
          <p className="mt-1 text-xs text-muted-foreground/60">
            {last && last.memTotalKb > 0
              ? `${((last.memTotalKb - last.memAvailKb) / 1024 / 1024).toFixed(1)} / ${(last.memTotalKb / 1024 / 1024).toFixed(1)} GB`
              : ''}
          </p>
        </Card>

        <Card className="surface-edge px-4 py-4">
          <Sparkline
            label="Network in"
            values={samples.map((x) => x.rxRate)}
            color="var(--live)"
            current={last?.rxRate ?? 0}
            format={human}
            height={84}
            axisLeft={axisLeft}
          />
        </Card>

        <Card className="surface-edge px-4 py-4">
          <Sparkline
            label="Network out"
            values={samples.map((x) => x.txRate)}
            color="var(--warn)"
            current={last?.txRate ?? 0}
            format={human}
            height={84}
            axisLeft={axisLeft}
          />
        </Card>
      </div>

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
