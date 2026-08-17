'use client'

import {
  ArrowLeft,
  Ban,
  Clock,
  Crosshair,
  FileWarning,
  Flag,
  Flame,
  Skull,
  Swords,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'

import { Pager } from '@/components/Pager'
import { PlayerActions } from '@/components/PlayerActions'
import { ProvenanceTag } from '@/components/Provenance'
import { LocalTime } from '@/components/LocalTime'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
// Aliased: `Ban` in this file is already the lucide icon.
import type { Ban as BanRecord } from '@/lib/bans'
import { humanDuration } from '@/lib/duration'
import type { Profile, ProfileIncident, ProfileMatch } from '@/lib/profile'
import { formatCount } from '@/lib/time'
import { cn } from '@/lib/utils'
import { progress } from '@/lib/xp'

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
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  value: string | number
  label: string
  /** Grid placement, for figures whose value needs more than one column. */
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
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

/**
 * One incident, as a title in three pieces (#22 item 5).
 *
 * THE WHOLE TITLE USED TO BE ONE LINK, to the incident, with the filer's name
 * buried in a subtitle. The owner asked for three pieces of which two are
 * links, because they are two different journeys from the same row:
 *
 *   "Reported for Abusive chat"   → the incident
 *   "by"                          → nothing, it is grammar
 *   "Xeon"                        → the filer's own profile
 *
 * THE CATEGORY IS HUMANISED, not the raw `abusive_chat` the owner wrote in the
 * issue. Every id on this page is already mapped to English before it is shown
 * — `ban.issue` reads "Banned", `solo` reads "Solo", `pending_review` reads
 * "pending review" — and the incident queue and detail pages both render this
 * exact field through the same CATEGORY_LABEL map (#143). A raw id here would
 * be the only one left. The map arrives as a prop because `lib/incidents` talks
 * to DynamoDB and must not be imported into a client bundle.
 *
 * THE COUNTERPARTY DEPENDS ON THE TAB, and only the connecting word changes.
 * On "filed against them" the other party is whoever reported them ("by
 * Xeon"). On "filed by them" the profile's owner IS the filer, so naming them
 * again says nothing — the other party is the person they reported ("against
 * Vance"). Same three pieces, same two links, one word different.
 *
 * SYSTEM-FILED INCIDENTS KEEP THEIR SUMMARY. An anticheat escalation has no
 * reporter and its category is `system`; "Reported for System by —" would be
 * three pieces of nonsense, so those rows stay one link on the summary, which
 * is what they have always been.
 */
function IncidentRow({
  i,
  now,
  direction,
  categoryLabel,
}: {
  i: ProfileIncident
  now: number
  /** Which tab this row is in — decides who the "other party" is. */
  direction: 'against' | 'by'
  categoryLabel: Record<string, string>
}) {
  const filedByAPlayer = i.kind === 'report' && i.category !== 'system'

  const other =
    direction === 'against'
      ? { word: 'by', name: i.reportedBy, license: i.reportedByLicense }
      : { word: 'against', name: i.subjectName, license: i.subjectLicense }

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
        <div className="text-sm">
          <Link
            href={`/incidents/${i.id}`}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            {filedByAPlayer
              ? `Reported for ${categoryLabel[i.category] ?? i.category}`
              : i.summary}
          </Link>
          {filedByAPlayer && other.name ? (
            <>
              {/* Plain text between two links, on purpose: it is the only piece
                  of this title that does not go anywhere. */}
              <span className="text-muted-foreground"> {other.word} </span>
              {other.license ? (
                <Link
                  href={`/players/${encodeURIComponent(other.license)}`}
                  className="underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {other.name}
                </Link>
              ) : (
                <span>{other.name}</span>
              )}
            </>
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <LocalTime ms={i.at} /> · {ago(i.at, now)}
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
 * Mode keys, as the GAME spells them, mapped to something a human reads.
 *
 * Falls through to the raw key, so a mode added on the game side shows up as
 * itself rather than vanishing from the row.
 */
const MODE_LABEL: Record<string, string> = {
  solo: 'Solo',
  squad: 'Squad',
}

/**
 * One match, as it was recorded when it ended.
 *
 * WINNING AND PLACING FIRST ARE DIFFERENT, and this row is the place a
 * moderator would otherwise never learn that. The storm can take the last squad
 * standing: they place first because nobody outlasted them, and the match has
 * no winner. The game stores `won` for exactly this, and the badge only goes
 * gold when it is true — a `#1` in plain grey with the explanation on hover is
 * the honest rendering of the other case.
 */
function MatchRow({ m }: { m: ProfileMatch }) {
  const firstButDead = m.placement === 1 && !m.won

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 py-2.5 text-sm first:border-t-0 first:pt-0">
      <span
        className={cn(
          'flex w-16 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset',
          m.won
            ? 'bg-warn/10 text-warn ring-warn/30'
            : 'bg-muted/40 text-muted-foreground ring-border',
        )}
        // BOTH CASES EXPLAIN THEMSELVES ON HOVER, because "#1 in gold" and "#1
        // in grey" are otherwise a colour difference somebody has to already
        // know the meaning of. The trophy is the non-colour half of the same
        // signal; this is the sentence behind it.
        title={
          m.won
            ? 'Won — still alive when the match ended.'
            : firstButDead
              ? 'Placed first but did not survive — the storm took the last squad, so the match had no winner.'
              : undefined
        }
      >
        {m.won && <Trophy className="size-3" />}
        {m.placement > 0 ? `#${m.placement}` : '—'}
      </span>

      {/* THE FIELD SIZE SITS WITH THE PLACEMENT, because it is the half that
          gives it meaning: third of eight and third of ninety-six are not the
          same result, and the number alone cannot say which happened. */}
      <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground/70">
        {m.total > 0 ? `of ${m.total}` : ''}
      </span>

      <span className="w-36 shrink-0 text-muted-foreground">
        <LocalTime ms={m.endedAt} />
      </span>

      {/* The game server's own match number, kept so a row here can be lined up
          against a line in the server log. */}
      <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground/70">
        match {m.matchId}
      </span>

      <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
        {MODE_LABEL[m.mode] ?? (m.mode || 'match')}
      </span>

      {/* TIME ALIVE, NOT MATCH LENGTH. Every player in one match shares its
          duration; how long each of them survived is the interesting half. */}
      <span
        className="w-20 shrink-0 font-mono text-xs text-muted-foreground"
        title="How long they stayed alive"
      >
        {humanDuration(m.survivedMs)}
      </span>

      <span className="font-mono text-xs text-muted-foreground">
        {m.kills} {m.kills === 1 ? 'kill' : 'kills'} · {formatCount(m.damage)} dmg
        {m.downs > 0 ? ` · ${m.downs} ${m.downs === 1 ? 'down' : 'downs'}` : ''}
        {m.revives > 0
          ? ` · ${m.revives} ${m.revives === 1 ? 'revive' : 'revives'}`
          : ''}
      </span>

      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
        +{formatCount(m.xpEarned)} XP · +{formatCount(m.voltsEarned)} volts
      </span>
    </li>
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
  // #22 item 7. WHAT THIS ROW ACTUALLY IS, which is not obvious from the name:
  // an admin closed an incident about this player, and the text beside it is
  // the note they typed while closing it — "watched a match, looked fine", "no
  // action". It is NOT a ban reason and NOT a record that anything was done to
  // them. "Incident closed" says that; "Resolved" would read as though the
  // PLAYER had been dealt with, which is the wrong claim to put on a moderation
  // history. See item 6 below for why it no longer reaches the list at all.
  'incident.resolve': 'Incident closed',
}

function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action
}

/**
 * Audit actions that are decisions rather than things done to the player.
 *
 * #22 item 6, owner: "A resolution with no action is not an entry in a list of
 * actions." `incident.resolve` lands in this list because closing an incident
 * records the incident's SUBJECT as the audit target — so every closure of
 * every report about somebody turned up under "Kicks and bans", next to actual
 * kicks and actual bans.
 *
 * THE FILTER IS UNCONDITIONAL, and that is a finding rather than a shortcut.
 * There is no machine-readable "action taken" on a resolution: `lib/incidents`
 * stores the admin's decision as free text (the box literally suggests "Banned
 * for 7 days / watched a match, looked fine / no action"). So nothing here can
 * tell an action-taken closure from a no-action one — and it does not need to,
 * because a closure that DID come with a ban or a kick already wrote its own
 * `ban.issue` or `player.kick` row, which is still listed. Dropping these rows
 * therefore loses no action from the history; it only stops decisions being
 * filed as actions. What was decided stays on the incident itself, which is one
 * click away in the panel above.
 */
const NOT_AN_ACTION = new Set(['incident.resolve'])

/**
 * FIVE ROWS A PAGE, ON EVERY PANEL OF THIS PAGE — the owner's number.
 *
 * This is a page you read top to bottom while deciding something about a
 * person: identity, then live state, then what has been done to them, then what
 * they play. Ten rows in each of three panels made the moderation history alone
 * taller than a laptop screen, so "what do they actually do on this server" was
 * below the fold on every profile that had any history at all. Five keeps all
 * four panels in one view and makes the reading order survive.
 *
 * It is passed explicitly at all three call sites as well as being the default.
 * `Paged` is local to this file today, but a default is a quiet thing to change
 * and the next person to reuse this component should have to state a size
 * rather than inherit the profile page's.
 */
const PROFILE_PER_PAGE = 5

/**
 * A list that does not grow without bound.
 *
 * Every moderation section on this page is append-only, so on a long-lived
 * player each one grows forever and the page becomes a scroll. Five at a time,
 * with the control hidden entirely when there is only one page — pagination on
 * a three-row list is noise.
 *
 * NEWEST FIRST is the caller's job, not this component's. It slices whatever
 * order it is given.
 */
function Paged<T>({
  items,
  perPage = PROFILE_PER_PAGE,
  label,
  children,
}: {
  items: T[]
  perPage?: number
  /** Names this list's pager. Three of them share this page — see Pager. */
  label: string
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
      <Pager
        page={current}
        perPage={perPage}
        total={items.length}
        onPage={setPage}
        label={label}
        className="mt-3 border-t border-border/60 pt-3"
      />
    </>
  )
}

/**
 * Incidents, both directions, in one paginated table with two tabs (#22 item 4).
 *
 * TWO PANELS BECAME ONE. "Incidents involving this player" and "Reports they
 * filed against others" were separate sections with an unpaginated list each,
 * so a player with forty reports against them pushed everything below off the
 * screen — and the two lists were never on screen together anyway, despite
 * being the same kind of row asking the same question from two directions.
 *
 * THE COUNTS ARE IN THE TAB TITLES, exactly as the owner wrote them:
 * "Filed against them (3)" and "Filed by them (0)". Including the zero, which
 * is deliberate on their part and right — a tab reading "(0)" tells a moderator
 * this player has never reported anybody, which is itself a thing worth
 * knowing. A tab with the count hidden would just look unvisited.
 *
 * REAL TABS NOW, not two styled <button>s. The strip this replaces had no
 * `role="tablist"`, no `aria-selected`, no roving tabindex and no arrow keys —
 * it looked like tabs and behaved like two unrelated buttons. `ui/tabs` is Base
 * UI underneath, so arrows move between them, Enter activates, and the panel is
 * announced as the thing the tab controls.
 *
 * THE ROOT IS CONTROLLED, and that is not optional. `tab` is read outside the
 * panels: the "N PENDING" badge in the section header counts the tab you are
 * looking at. A `defaultValue` root would leave that badge frozen on the first
 * tab's number while the list under it changed, which is the specific kind of
 * wrong that gets believed.
 *
 * FIVE ROWS A PAGE, and the page still resets on a tab change — by unmount
 * rather than by `key={tab}`. Base UI panels default to `keepMounted={false}`,
 * so each direction has its own `Paged` and the hidden one is torn down; coming
 * back lands on page one exactly as the remount used to. Worth stating because
 * it is now a consequence of a default rather than of a line of code: if
 * `keepMounted` is ever added here, the reset goes with it.
 */
function IncidentsPanel({
  against,
  filed,
  now,
  categoryLabel,
}: {
  against: ProfileIncident[]
  filed: ProfileIncident[]
  now: number
  categoryLabel: Record<string, string>
}) {
  const [tab, setTab] = useState<'against' | 'by'>('against')

  const rows = tab === 'against' ? against : filed
  const pending = rows.filter((i) => i.state === 'pending_review').length

  return (
    <Section
      title="Incidents"
      provenance={<ProvenanceTag kind="moderation" />}
      action={
        // Counts the tab you are looking at, not a fixed one — a "2 PENDING"
        // badge above a list that has none in it is just wrong.
        pending > 0 ? (
          <Badge className="border-0 bg-warn/10 text-xs font-semibold uppercase tracking-wider text-warn ring-1 ring-inset ring-warn/30">
            {pending} pending
          </Badge>
        ) : null
      }
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'against' | 'by')}
        className="gap-3"
      >
        <TabsList>
          <TabsTrigger value="against">
            Filed against them ({against.length})
          </TabsTrigger>
          <TabsTrigger value="by">Filed by them ({filed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="against">
          <IncidentList
            rows={against}
            direction="against"
            now={now}
            categoryLabel={categoryLabel}
          />
        </TabsContent>
        <TabsContent value="by">
          <IncidentList
            rows={filed}
            direction="by"
            now={now}
            categoryLabel={categoryLabel}
          />
        </TabsContent>
      </Tabs>
    </Section>
  )
}

/** One direction's worth of incidents, paginated, or the sentence for none. */
function IncidentList({
  rows,
  direction,
  now,
  categoryLabel,
}: {
  rows: ProfileIncident[]
  direction: 'against' | 'by'
  now: number
  categoryLabel: Record<string, string>
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        {direction === 'against'
          ? 'Nobody has ever filed an incident about this player.'
          : 'This player has never reported anybody.'}
      </Empty>
    )
  }

  return (
    <Paged items={rows} perPage={PROFILE_PER_PAGE} label="Incident pages">
      {(slice) => (
        <ul>
          {slice.map((i) => (
            <IncidentRow
              key={i.id}
              i={i}
              now={now}
              direction={direction}
              categoryLabel={categoryLabel}
            />
          ))}
        </ul>
      )}
    </Paged>
  )
}

export function ProfileView({
  p,
  now,
  banned = false,
  moderation,
  categoryLabel = {},
}: {
  p: Profile
  now: number
  /** Currently banned — shown beside the name, where identity is confirmed. */
  banned?: boolean
  /**
   * What the moderation buttons in the top bar need to know (#22 item 1).
   *
   * PLAIN DATA, NOT AN ELEMENT, and that is not a style preference. The obvious
   * shape was a `ReactNode` slot the page fills with <PlayerActions/> — but the
   * page is a SERVER component and this is a client one, and an element built on
   * the server and handed across as a non-`children` prop trips React's dev key
   * check: it arrives unvalidated, and rendering it raises "Each child in a list
   * should have a unique key prop" on a page that has no such list. Passing the
   * three facts and constructing the element here keeps it client-to-client, and
   * keeps the console quiet enough that a real warning is still worth reading.
   *
   * Omitted entirely by callers that must not offer the buttons at all.
   */
  moderation?: {
    ban: BanRecord | null
    /** On the server right now — decides whether a kick is even possible. */
    online: boolean
    canBan: boolean
  }
  /** Report categories in English. From `lib/incidents`, which is server-only. */
  categoryLabel?: Record<string, string>
}) {
  const kd = p.stats && p.stats.deaths > 0
    ? (p.stats.kills / p.stats.deaths).toFixed(2)
    : '—'

  // #22 item 6 — see NOT_AN_ACTION. Kicks and bans lists what was DONE to this
  // player; a decision about a report is not one of those things.
  const moderationActions = p.actions.filter((a) => !NOT_AN_ACTION.has(a.action))

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
                // #22 item 3. The chip is `uppercase`, so this renders as
                // ONLINE NOW — which is what the owner asked for, and which
                // sits better beside a row of buttons than a sentence did.
                <Badge className="gap-1 border-0 bg-live/10 text-xs font-semibold uppercase tracking-wider text-live ring-1 ring-inset ring-live/25">
                  <span className="size-1.5 rounded-full bg-live" />
                  Online now
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

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  First seen
                </div>
                <div className="mt-1 text-sm"><LocalTime ms={p.firstSeen} /></div>
              </div>
              {/* LAST SEEN IS MEANINGLESS WHILE THEY ARE HERE. "2 minutes ago"
                  next to "Online now" is either confusing or wrong, and the
                  badge already answers the question better. */}
              {!p.live && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Last seen
                  </div>
                  <div className="mt-1 text-sm">{ago(p.lastSeen, now)}</div>
                </div>
              )}
            </div>

            {/* #22 item 1 — the moderation bar, now built into this bar. It is
                the last thing in the row because the row reads left to right as
                "who is this, are they here, when did we last see them, what do
                you want to do about it". */}
            {moderation && (
              <PlayerActions
                license={p.license}
                name={p.name}
                ban={moderation.ban}
                online={moderation.online}
                canBan={moderation.canBan}
              />
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
            /*
              #22 items 8 and 9.
              SOLOS, SQUADS AND LIFETIME DAMAGE ARE FIGURES NOW, not the tail of
              a sentence underneath the grid. They were the only three career
              numbers rendered as small grey prose, which made them look like a
              footnote to the table rather than three of its rows — and "how
              much damage has this person done, ever" is one of the first things
              asked about a suspected cheater.

              LAST MATCH IS GONE (item 9). "Offline / last seen 20 minutes ago"
              is already in the top bar, and match history below carries the
              timestamp of every individual match. A third, vaguer version of
              the same fact in the middle was the one nobody needed.

              Every count goes through formatCount rather than a bare
              `.toLocaleString()`: this is a client component, so the ambient
              locale renders `184,220` on the server and `184.220` in a de-DE
              browser — an unsuppressed text mismatch that costs the page its
              server render.

              THE COLUMN COUNT FOLLOWS THE CARD, NOT THE WINDOW, which is why it
              changes twice. A lifetime damage total is 95px of monospace at this
              size and the counts that used to live here were all three or four
              digits, so promoting it into the grid re-created item 11's bug in a
              second place: three columns gave it an 86px cell and truncated it
              to "184,2…". This card is full width below `lg` and HALF width at
              and above it — the outer grid splits — so the narrow points are the
              phone and the 1024-1279 band, and both drop to two columns. Every
              width was measured against the widest values, not eyeballed.
            */
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
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
              <Figure
                icon={User}
                value={formatCount(p.stats.soloMatches)}
                label="solos"
              />
              <Figure
                icon={Users}
                value={formatCount(p.stats.squadMatches)}
                label="squads"
              />
              <Figure
                icon={Flame}
                value={formatCount(p.stats.damageDealt)}
                label="total damage"
              />
            </div>
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
              {/*
                #22 ITEM 11 — THE CONTAINER, NOT THE TEXT.
                "xp this level" was the third cell of a three-column grid inside
                a half-width card, which is about 145px. Its value is ALWAYS
                "<into> / <span>" and the spans run from 800 up to 15,450, so
                the string is routinely 13-15 monospace characters at text-xl —
                roughly 180px. It truncated to "2,707 / 2,8…" for most players at
                most levels, not as an edge case, and half a progress figure is
                worse than none: a moderator reading it cannot tell whether the
                player is about to level.

                So the figure now spans the full width of this grid and the other
                two share the row above it. That gives it 330-470px against the
                ~180px it needs, which holds at every breakpoint and for the
                widest span on the curve — checked in /preview/profile, which is
                the only place this is visible without a live game table.
              */}
              <div className="grid grid-cols-2 gap-4">
                <Figure icon={Trophy} value={p.progress.level} label="level" />
                <Figure
                  icon={Clock}
                  value={formatCount(p.progress.balance)}
                  label="volts"
                />
                {/*
                  PROGRESS, NOT A LIFETIME TOTAL. "2,498 XP" answers a question
                  nobody asks; "148 / 2,050" answers the one they do — how close
                  is this player to levelling. It also makes this figure directly
                  comparable with the bar in the player's own lobby, which is how
                  the stored-level bug was spotted in the first place.
                */}
                <Figure
                  icon={Swords}
                  className="col-span-2"
                  value={`${formatCount(progress(p.progress.xp).into)} / ${formatCount(
                    progress(p.progress.xp).span,
                  )}`}
                  label="xp this level"
                />
              </div>
              {/*
                #22 item 10 — a count, not a list. Owner: "We don't need to know
                what cosmetics they own, just 'x cosmetics owned' is enough."
                What was here also listed what they were WEARING, as raw market
                ids ("chute: chute_ember"), which is a wardrobe note on a page
                used to decide whether to ban somebody.
              */}
              <p className="mt-3 text-sm text-muted-foreground">
                {p.progress.owned === 0
                  ? 'No cosmetics owned.'
                  : `${formatCount(p.progress.owned)} cosmetic${
                      p.progress.owned === 1 ? '' : 's'
                    } owned.`}
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

      <IncidentsPanel
        against={p.incidents}
        filed={p.reportsFiled}
        now={now}
        categoryLabel={categoryLabel}
      />

      {/*
        KICKS AND BANS, FROM THE AUDIT LOG.
        The bans table holds one row per license, so a second ban overwrites the
        first — asking it for history returns only the current state. The audit
        log is append-only and is the only place a player's moderation past
        actually survives.

        THE ACTING ADMIN LINKS TO THEIR OWN PROFILE. Moderation is a thing
        people do to other people, and "who decided this" should be one click
        rather than a name to go and look up.

        IT LISTS ACTIONS ONLY (#22 item 6). See NOT_AN_ACTION — incident
        closures target the player too, but closing a report is a decision about
        the report, not something done to them.
      */}
      <Section
        title="Kicks and bans"
        provenance={<ProvenanceTag kind="moderation" />}
        action={
          moderationActions.length > 0 ? (
            <Badge
              variant="outline"
              className="border-0 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
            >
              {moderationActions.length}
            </Badge>
          ) : null
        }
      >
        {moderationActions.length ? (
          <Paged
            items={moderationActions}
            perPage={PROFILE_PER_PAGE}
            label="Kick and ban pages"
          >
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
                        <LocalTime ms={a.at} /> · by{' '}
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

      {/*
        MATCH HISTORY, REAL SINCE #153 — and the empty state is now three
        different statements rather than one.

        While nothing wrote these rows, "no matches" and "never played" were
        the same fact and one blank panel said both. They are no longer the
        same fact. A player with four hundred matches in their career totals and
        no per-match rows played all of them before this shipped; showing them
        the same panel as somebody who has never connected would be a false
        statement about a real person, on the page an admin acts from.

        So the panel reads the career totals to decide which sentence to say,
        and a failed read says a third thing — because a table that could not be
        reached is not a player who did nothing.
      */}
      <Section
        title="Match history"
        provenance={<ProvenanceTag kind="stats" />}
        action={
          p.matches && p.matches.length > 0 ? (
            <Badge
              variant="outline"
              className="border-0 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
            >
              {p.matches.length}
            </Badge>
          ) : null
        }
      >
        {p.matches === null ? (
          <Empty>
            Match history could not be read. This is a problem with the stats
            table, not a statement about this player — nothing else on this page
            is affected.
          </Empty>
        ) : p.matches.length === 0 ? (
          p.stats ? (
            <Empty>
              No individual matches recorded. This player has{' '}
              {formatCount(p.stats.matches)}{' '}
              {p.stats.matches === 1 ? 'match' : 'matches'} in their career
              totals above, all played before per-match history started being
              kept — those matches counted, but they were never stored one by
              one and cannot be recovered. Anything they play from now on
              appears here.
            </Empty>
          ) : (
            <Empty>
              No match has ever been recorded for this player — not here, and not
              in their career totals. As far as the game is concerned they have
              never finished a match.
            </Empty>
          )
        ) : (
          <Paged items={p.matches} perPage={PROFILE_PER_PAGE} label="Match history pages">
            {(slice) => (
              <ul className="space-y-0">
                {slice.map((m) => (
                  <MatchRow key={`${m.endedAt}-${m.matchId}`} m={m} />
                ))}
              </ul>
            )}
          </Paged>
        )}
      </Section>
    </div>
  )
}
