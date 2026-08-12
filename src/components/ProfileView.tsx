import {
  ArrowLeft,
  Ban,
  Clock,
  Crosshair,
  FileWarning,
  Flag,
  Skull,
  Swords,
  Trophy,
} from 'lucide-react'
import Link from 'next/link'

import { ProvenanceTag } from '@/components/Provenance'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { humanDuration } from '@/lib/duration'
import type { Profile, ProfileIncident } from '@/lib/profile'
import { cn } from '@/lib/utils'

/**
 * Everything known about one person.
 *
 * THE ORDER IS THE ARGUMENT. An investigation opens this page with a question,
 * and the questions arrive in a reliable order: is this the right person, are
 * they here now, have we dealt with them before, what do they actually do on
 * this server. Identity first, live state second, moderation history third,
 * play record last — not the other way round, however much prettier a wall of
 * stats would look at the top.
 */

function when(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(0, 16).replace('T', ' ') + 'Z'
}

function ago(ms: number, now: number): string {
  return `${humanDuration(now - ms)} ago`
}

function Section({
  title,
  provenance,
  action,
  children,
  className,
}: {
  title: string
  provenance: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('surface-edge animate-rise gap-0 overflow-hidden py-0', className)}>
      <header className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5">
        <span className="text-sm">{title}</span>
        {provenance}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </Card>
  )
}

function Figure({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  value: string | number
  label: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xl tabular-nums">{value}</div>
    </div>
  )
}

const INCIDENT_STATE: Record<ProfileIncident['state'], string> = {
  open: 'text-warn ring-warn/30 bg-warn/10',
  reviewed: 'text-info ring-info/25 bg-info/10',
  actioned: 'text-danger ring-danger/25 bg-danger/10',
  dismissed: 'text-muted-foreground ring-border bg-muted/40',
}

function IncidentRow({ i, now }: { i: ProfileIncident; now: number }) {
  return (
    <li className="flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0">
      <div
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
          i.kind === 'anticheat'
            ? 'bg-danger/10 text-danger ring-danger/25'
            : 'bg-info/10 text-info ring-info/25',
        )}
      >
        {i.kind === 'anticheat' ? (
          <FileWarning className="size-3.5" />
        ) : (
          <Flag className="size-3.5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{i.summary}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {when(i.at)} · {ago(i.at, now)}
        </div>
      </div>

      <Badge
        variant="outline"
        className={cn(
          'shrink-0 rounded-md border-0 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
          INCIDENT_STATE[i.state],
        )}
      >
        {i.state}
      </Badge>
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-[13px] text-muted-foreground/70">{children}</p>
  )
}

export function ProfileView({
  p,
  now,
  banned = false,
}: {
  p: Profile
  now: number
  /** Currently banned — shown beside the name, where identity is confirmed. */
  banned?: boolean
}) {
  const kd = p.stats && p.stats.deaths > 0
    ? (p.stats.kills / p.stats.deaths).toFixed(2)
    : '—'

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to live players
      </Link>

      {/* Identity. First, because every other panel is worthless if this is
          the wrong person. */}
      <Card className="surface-edge animate-rise gap-0 overflow-hidden px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-lg font-semibold text-primary ring-1 ring-inset ring-primary/25">
            {p.name.slice(0, 2).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
              {/* BANNED SITS NEXT TO THE NAME, not down in a moderation panel.
                  It is the single most important fact about a player when it
                  is true, and it has to be visible in the same glance that
                  confirms you are looking at the right person. */}
              {banned && (
                <Badge className="gap-1 border-0 bg-danger/10 text-[10px] font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30">
                  <Ban className="size-3" />
                  Currently banned
                </Badge>
              )}
              {p.live ? (
                <Badge className="gap-1 border-0 bg-live/10 text-[10px] font-semibold uppercase tracking-wider text-live ring-1 ring-inset ring-live/25">
                  <span className="size-1.5 rounded-full bg-live" />
                  On the server now
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-0 bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
                >
                  Offline
                </Badge>
              )}
              {p.bans.length > 0 && (
                <Badge className="gap-1 border-0 bg-danger/10 text-[10px] font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/25">
                  <Ban className="size-3" />
                  {p.bans.length} ban{p.bans.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <code className="mt-1 block font-mono text-[11px] text-muted-foreground">
              {p.license}
            </code>
          </div>

          <div className="flex gap-6 text-right">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                First seen
              </div>
              <div className="mt-1 text-[13px]">{when(p.firstSeen)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Last seen
              </div>
              <div className="mt-1 text-[13px]">{ago(p.lastSeen, now)}</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Identifiers" provenance={<ProvenanceTag kind="identity" />}>
          <ul className="space-y-1.5">
            {p.identifiers.map((id) => (
              <li key={id.kind} className="flex items-baseline gap-3">
                <span className="w-16 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {id.kind}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[12px]">
                  {id.value}
                </code>
              </li>
            ))}
          </ul>
          {/*
            The absence is the point, so it is stated rather than left as a
            gap somebody assumes is a bug.
          */}
          <p className="mt-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground/70">
            No IP address is recorded, by design. The identifier scan is an
            allowlist, so anything FiveM adds later is excluded by construction
            rather than collected by default. The cost is that evasion matching
            is weaker — every identifier above is one a determined evader can
            change.
          </p>
        </Section>

        <Section
          title="Play record"
          provenance={<ProvenanceTag kind="stats" />}
        >
          {p.stats ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Figure icon={Swords} value={p.stats.matches} label="matches" />
                <Figure icon={Trophy} value={p.stats.wins} label="wins" />
                <Figure
                  icon={Clock}
                  value={humanDuration(p.stats.playtimeMs)}
                  label="played"
                />
                <Figure icon={Crosshair} value={p.stats.kills} label="kills" />
                <Figure icon={Skull} value={p.stats.deaths} label="deaths" />
                <Figure icon={Crosshair} value={kd} label="k/d" />
              </div>
            </>
          ) : (
            <Empty>
              No persistent stats yet — these arrive when match results start
              being written to DynamoDB. The page is built to show nothing
              rather than zeroes, because a returning player showing 0 matches
              looks like a different person.
            </Empty>
          )}
        </Section>
      </div>

      <Section
        title="Incidents involving this player"
        provenance={<ProvenanceTag kind="moderation" />}
        action={
          p.incidents.filter((i) => i.state === 'open').length > 0 ? (
            <Badge className="border-0 bg-warn/10 text-[10px] font-semibold uppercase tracking-wider text-warn ring-1 ring-inset ring-warn/30">
              {p.incidents.filter((i) => i.state === 'open').length} open
            </Badge>
          ) : null
        }
      >
        {p.incidents.length ? (
          <ul>
            {p.incidents.map((i) => (
              <IncidentRow key={i.id} i={i} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>Nothing recorded against this player.</Empty>
        )}
      </Section>

      <Section
        title="Reports they filed against others"
        provenance={<ProvenanceTag kind="moderation" />}
      >
        {p.reportsFiled.length ? (
          <ul>
            {p.reportsFiled.map((i) => (
              <IncidentRow key={i.id} i={i} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>
            None. Worth having on the page even when empty — somebody reporting
            everybody is itself a signal, and it is only visible if you can see
            what they have filed.
          </Empty>
        )}
      </Section>

      <Section title="Recent sessions" provenance={<ProvenanceTag kind="stats" />}>
        <ul className="space-y-0">
          {p.recentSessions.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-4 border-t border-border/60 py-2 text-[13px] first:border-t-0 first:pt-0"
            >
              <span className="w-36 shrink-0 text-muted-foreground">
                {when(s.at)}
              </span>
              <span className="w-20 shrink-0 font-mono text-muted-foreground">
                {humanDuration(s.durationMs)}
              </span>
              <span className="w-24 shrink-0 font-mono text-muted-foreground">
                match {s.matchId}
              </span>
              <span className="w-16 shrink-0 font-mono">
                {s.placement ? `#${s.placement}` : '—'}
              </span>
              <span className="font-mono text-muted-foreground">
                {s.kills} kills
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Separator />
      <p className="text-[11px] leading-relaxed text-muted-foreground/60">
        <span className="text-warn">Demo data.</span> Only the live panel is
        wired to anything real. Identifiers arrive with the{' '}
        <code className="font-mono">player_seen</code> event stream, the play
        record with persistent stats, and incidents and bans with Slice 2. The
        layout exists now so the shape can be argued with before any of it is
        expensive to change.
      </p>
    </div>
  )
}
