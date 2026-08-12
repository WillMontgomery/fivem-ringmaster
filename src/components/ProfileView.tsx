'use client'

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
import { useState } from 'react'
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
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xl tabular-nums">{value}</div>
    </div>
  )
}

const INCIDENT_STATE: Record<ProfileIncident['state'], string> = {
  pending_review: 'text-warn ring-warn/30 bg-warn/10',
  resolved: 'text-muted-foreground ring-border bg-muted/40',
}

const INCIDENT_STATE_LABEL: Record<ProfileIncident['state'], string> = {
  pending_review: 'pending review',
  resolved: 'resolved',
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
        {/* The summary is the link. Somebody reading a profile who wants the
            detail should not have to go back through the queue to find it. */}
        <Link
          href={`/incidents/${i.id}`}
          className="text-sm underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {i.summary}
        </Link>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {when(i.at)} · {ago(i.at, now)}
        </div>
      </div>

      <Badge
        variant="outline"
        className={cn(
          'shrink-0 rounded-md border-0 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
          INCIDENT_STATE[i.state],
        )}
      >
        {INCIDENT_STATE_LABEL[i.state]}
      </Badge>
    </li>
  )
}

/**
 * The empty state, and it says the same thing everywhere on purpose.
 *
 * Each of these used to carry its own paragraph explaining why that particular
 * box had nothing in it — which stream was missing, what would fill it, why
 * absent was not the same as zero. All true, all useful exactly once, and then
 * permanent furniture on a page a moderator reads dozens of times a week.
 *
 * The explanations now live in the code and the issues, where they are read by
 * whoever is changing this. The page says what it knows, which is nothing.
 */
function Empty({ children }: { children?: React.ReactNode }) {
  return (
    <p className="py-2 text-sm text-muted-foreground/70">
      {children ?? 'Nothing recorded for this player.'}
    </p>
  )
}

/**
 * Audit action names, in English.
 *
 * `ban.issue` and `player.kick` are wire identifiers — stable, greppable, and
 * exactly right in the audit table. They are not what a moderator should be
 * reading at a glance, and a profile page is read at a glance.
 *
 * Falls through to the raw identifier for anything unmapped, so a new action
 * shows up as itself rather than disappearing.
 */
const ACTION_LABEL: Record<string, string> = {
  'ban.issue': 'Banned',
  'ban.lift': 'Ban lifted',
  'player.kick': 'Kicked',
  'maintenance.schedule': 'Scheduled a server update',
  'maintenance.cancel': 'Cancelled a server update',
  'host.deploy': 'Ran a server update',
}

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action
}

/**
 * A list that does not grow without bound.
 *
 * Every moderation section on this page is append-only, so on a long-lived
 * player each one grows forever and the page becomes a scroll. Ten at a time,
 * with the control hidden entirely when there is only one page — pagination on
 * a three-row list is noise.
 *
 * NEWEST FIRST is the caller's job, not this component's. It slices whatever
 * order it is given.
 */
function Paged<T>({
  items,
  perPage = 10,
  children,
}: {
  items: T[]
  perPage?: number
  children: (slice: T[]) => React.ReactNode
}) {
  const [page, setPage] = useState(0)
  const pages = Math.ceil(items.length / perPage)
  // Guard against the list shrinking under a page that no longer exists — a
  // resolved incident or a lifted ban can do that.
  const current = Math.min(page, Math.max(0, pages - 1))
  const slice = items.slice(current * perPage, current * perPage + perPage)

  return (
    <>
      {children(slice)}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">
            {current * perPage + 1}–{Math.min((current + 1) * perPage, items.length)} of{' '}
            {items.length}
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
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to live players
      </Link>

      {/* Identity. First, because every other panel is worthless if this is
          the wrong person. */}
      <Card className="surface-edge animate-rise gap-0 overflow-hidden px-5 py-4">
        {/* items-center: the name sits on the avatar's midline rather than
              hanging off its top edge. */}
        <div className="flex flex-wrap items-center gap-4">
          {/* THE FACE, when Discord gives us one. Falls back to initials rather
              than to a broken image, and the fallback is also what a player
              with no Discord link gets — which is a real state, not an error. */}
          {p.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.avatarUrl}
              alt=""
              className="size-12 shrink-0 rounded-xl object-cover ring-1 ring-inset ring-primary/25"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-lg font-semibold text-primary ring-1 ring-inset ring-primary/25">
              {p.name.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
              {/* BANNED SITS NEXT TO THE NAME, not down in a moderation panel.
                  It is the single most important fact about a player when it
                  is true, and it has to be visible in the same glance that
                  confirms you are looking at the right person. */}
              {banned && (
                <Badge className="gap-1 border-0 bg-danger/10 text-xs font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30">
                  <Ban className="size-3" />
                  Currently banned
                </Badge>
              )}
              {p.live ? (
                <Badge className="gap-1 border-0 bg-live/10 text-xs font-semibold uppercase tracking-wider text-live ring-1 ring-inset ring-live/25">
                  <span className="size-1.5 rounded-full bg-live" />
                  On the server now
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-0 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
                >
                  Offline
                </Badge>
              )}
              {p.bans.length > 0 && (
                <Badge className="gap-1 border-0 bg-danger/10 text-xs font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/25">
                  <Ban className="size-3" />
                  {p.bans.length} ban{p.bans.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            {/* The license used to sit here as well as in the identifiers box.
                One copy is enough, and the box is where somebody looking for an
                identifier will go. */}
          </div>

          <div className="flex gap-6 text-right">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                First seen
              </div>
              <div className="mt-1 text-sm">{when(p.firstSeen)}</div>
            </div>
            {/* LAST SEEN IS MEANINGLESS WHILE THEY ARE HERE. "2 minutes ago"
                next to "On the server now" is either confusing or wrong, and
                the badge already answers the question better. */}
            {!p.live && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Last seen
                </div>
                <div className="mt-1 text-sm">{ago(p.lastSeen, now)}</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Identifiers" provenance={<ProvenanceTag kind="identity" />}>
          {/*
            EVERY VALUE, NOT EVERY KIND. A player can present more than one
            value for the same kind over time — a second Steam account, a
            reissued license — and each of those is a separate row here.

            The key is kind+value rather than kind, which it used to be: two
            sightings of one kind collided, React kept the first, and the extra
            value silently vanished from a page whose whole job is to show what
            we know about somebody.
          */}
          {p.identifiers.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-1.5">
              {p.identifiers.map((id) => (
                <li
                  key={`${id.kind}:${id.value}`}
                  className="flex items-baseline gap-3"
                >
                  <span className="w-16 shrink-0 text-xs uppercase tracking-wider text-muted-foreground">
                    {id.kind}
                  </span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">
                    {id.value}
                  </code>
                </li>
              ))}
            </ul>
          )}
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
                <Figure icon={Trophy} value={p.stats.top10s} label="top 10" />
                <Figure icon={Crosshair} value={p.stats.kills} label="kills" />
                <Figure icon={Skull} value={p.stats.deaths} label="deaths" />
                <Figure icon={Crosshair} value={kd} label="k/d" />
                <Figure
                  icon={Clock}
                  value={humanDuration(p.stats.playtimeMs)}
                  label="in match"
                />
                <Figure icon={Skull} value={p.stats.downs} label="downs" />
                <Figure icon={Trophy} value={p.stats.revives} label="revives" />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {p.stats.soloMatches} solo · {p.stats.squadMatches} squad ·{' '}
                {p.stats.damageDealt.toLocaleString()} damage
                {p.stats.lastMatchAt
                  ? ` · last match ${ago(p.stats.lastMatchAt, now)}`
                  : ''}
              </p>
            </>
          ) : (
            <Empty />
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/*
          PROGRESSION AND WALLET. Same row as the play record and the same null
          rule — but a separate section, because a moderator scanning for "is
          this person new" reads level and matches differently from how they
          read a balance.
        */}
        <Section title="Progression" provenance={<ProvenanceTag kind="stats" />}>
          {p.progress ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Figure icon={Trophy} value={p.progress.level} label="level" />
                <Figure
                  icon={Swords}
                  value={p.progress.xp.toLocaleString()}
                  label="total xp"
                />
                <Figure
                  icon={Clock}
                  value={p.progress.balance.toLocaleString()}
                  label="volts"
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {p.progress.owned === 0
                  ? 'No cosmetics purchased.'
                  : `${p.progress.owned} cosmetic${p.progress.owned === 1 ? '' : 's'} owned.`}
                {Object.keys(p.progress.equipped).length > 0 && (
                  <>
                    {' '}
                    Wearing{' '}
                    {Object.entries(p.progress.equipped)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([kind, id]) => `${kind}: ${id}`)
                      .join(' · ')}
                    .
                  </>
                )}
              </p>
            </>
          ) : (
            <Empty />
          )}
        </Section>

        {/*
          TIME CONNECTED IS NOT TIME PLAYED, and they come from different
          tables. Somebody with twenty hours on the server and forty minutes in
          matches is a specific and interesting thing; one combined number
          would hide it completely.
        */}
        <Section title="Sessions" provenance={<ProvenanceTag kind="identity" />}>
          {p.connected ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Figure
                  icon={Swords}
                  value={p.connected.sessions}
                  label="sessions"
                />
                <Figure
                  icon={Clock}
                  value={humanDuration(p.connected.playtimeMs)}
                  label="connected"
                />
              </div>
              {p.names.length > 1 && (
                <div className="mt-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Also known as
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {/* A rename right before an incident is itself a signal,
                        which is why the history is kept rather than the latest
                        name overwriting it. */}
                    {p.names
                      .slice(1)
                      .map((n) => n.name)
                      .join(' · ')}
                  </p>
                </div>
              )}
            </>
          ) : (
            <Empty />
          )}
        </Section>
      </div>

      <Section
        title="Incidents involving this player"
        provenance={<ProvenanceTag kind="moderation" />}
        action={
          p.incidents.filter((i) => i.state === 'pending_review').length > 0 ? (
            <Badge className="border-0 bg-warn/10 text-xs font-semibold uppercase tracking-wider text-warn ring-1 ring-inset ring-warn/30">
              {p.incidents.filter((i) => i.state === 'pending_review').length} pending
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
          <Empty />
        )}
      </Section>

      {/*
        KICKS AND BANS, FROM THE AUDIT LOG.
        The bans table holds one row per license, so a second ban overwrites the
        first — asking it for history returns only the current state. The audit
        log is append-only and is the only place a player's moderation past
        actually survives.

        THE ACTING ADMIN LINKS TO THEIR OWN PROFILE. Moderation is a thing
        people do to other people, and "who decided this" should be one click
        rather than a name to go and look up.
      */}
      <Section
        title="Kicks and bans"
        provenance={<ProvenanceTag kind="moderation" />}
        action={
          p.actions.length > 0 ? (
            <Badge
              variant="outline"
              className="border-0 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
            >
              {p.actions.length}
            </Badge>
          ) : null
        }
      >
        {p.actions.length ? (
          <Paged items={p.actions}>
            {(slice) => (
              <ul>
                {slice.map((a, i) => (
                  <li
                    key={`${a.at}-${i}`}
                    className="flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0"
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
                        a.action.startsWith('ban')
                          ? 'bg-danger/10 text-danger ring-danger/25'
                          : 'bg-warn/10 text-warn ring-warn/25',
                      )}
                    >
                      <Ban className="size-3.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        <span className="font-medium">{actionLabel(a.action)}</span>
                        {a.reason ? (
                          <span className="text-muted-foreground"> — {a.reason}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {when(a.at)} · by{' '}
                        {a.actorLicense ? (
                          <Link
                            href={`/players/${encodeURIComponent(a.actorLicense)}`}
                            className="underline underline-offset-2 transition-colors hover:text-foreground"
                          >
                            {a.actorName}
                          </Link>
                        ) : (
                          a.actorName
                        )}
                        {/* THE OUTCOME BADGE IS GONE, but a failure is not.
                            "OK / PENDING / FAILED" meant nothing to somebody
                            reading a player's history — a successful action
                            does not need announcing. An action that did NOT
                            happen still does: a kick shown identically to one
                            that landed is a false record. */}
                        {a.outcome === 'failed' && (
                          <span className="text-danger"> · did not go through</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Paged>
        ) : (
          <Empty />
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
          <Empty />
        )}
      </Section>

      <Section title="Match history" provenance={<ProvenanceTag kind="stats" />}>
        {p.recentSessions.length === 0 ? (
          <Empty />
        ) : (
          <Paged items={p.recentSessions}>
            {(slice) => (
              <ul className="space-y-0">
                {slice.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-4 border-t border-border/60 py-2 text-sm first:border-t-0 first:pt-0"
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
            )}
          </Paged>
        )}
      </Section>
    </div>
  )
}
