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

import {
  type DiscordChromeState,
  useAccent,
  useDiscordChrome,
} from '@/components/DiscordChrome'
import { Pager } from '@/components/Pager'
import { PlayerActions } from '@/components/PlayerActions'
import { ProvenanceTag } from '@/components/Provenance'
import { LocalTime } from '@/components/LocalTime'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
// Aliased: `Ban` in this file is already the lucide icon.
import type { Ban as BanRecord } from '@/lib/bans'
import type { AccentSurface } from '@/lib/contrast'
import { humanDuration } from '@/lib/duration'
import type {
  DiscordNameChange,
  Profile,
  ProfileIdentifier,
  ProfileIncident,
  ProfileMatch,
} from '@/lib/profile'
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
 *
 * NOTHING BELOW RENDERS UNTIL DISCORD IS READY, and that is a reversal the
 * owner asked for by name: "While the colors/images are loading I want the
 * entire profile page to show shadcn skeletons." The page used to stream its
 * body immediately and suspend only the Discord-shaped parts. It now has ONE
 * loading state — `ProfileSkeleton`, gated on the same `ready` signal
 * `DiscordChrome` already produces — and the per-element skeletons that used to
 * sit on the face, the banner and the names are gone rather than left beside it.
 * Two loading paths for one wait is exactly the duplication this repo keeps
 * shipping.
 *
 * THE NO-DISCORD-ID FAST PATH SURVIVES UNTOUCHED. `absent` is not `loading`: a
 * player with no Discord identifier renders immediately, with no skeleton at
 * all, because there is nothing to wait for. See DiscordChromeProvider.
 */

function when(ms: number): string {
  const d = new Date(ms)
  return d.toISOString().slice(0, 16).replace('T', ' ') + 'Z'
}

function ago(ms: number, now: number): string {
  return `${humanDuration(now - ms)} ago`
}

/**
 * A panel, with its header painted in the player's Discord accent colour.
 *
 * "USE THEIR BANNER COLOR TO COLOR THE BACKGROUND OF THE TOP OF OUR TABLES" —
 * the owner. This is that, and it is the one place on the page where text sits
 * on a colour somebody else chose, which is why it is also the only place the
 * contrast maths is load-bearing. `accent.background` has already been clamped
 * into a mid lightness band and `accent.foreground` derived from its luminance;
 * see src/lib/contrast.ts. Nothing here ever sees the raw value.
 *
 * THESE HEADERS USED TO CARRY NO SKELETON, on the argument that the title, the
 * provenance tag and the count are all known immediately and none of them comes
 * from Discord. The owner has since asked for the opposite — the whole page
 * waits — so the skeleton of this header lives in `SkeletonSection`, which is
 * this component's shape with grey bars in it, and this component never renders
 * at all until the accent is in hand. The 300ms transition on `.accent-surface`
 * is therefore no longer doing the job it was added for; it is kept because a
 * theme switch still crosses it.
 */
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
  const accent = useAccent()

  return (
    <Card className={cn('surface-edge animate-rise gap-0 overflow-hidden py-0', className)}>
      <header
        className={cn(
          'flex items-center gap-2 border-b border-border px-4 py-2.5',
          accent ? 'accent-surface' : 'bg-card/60',
        )}
        style={
          accent
            ? ({
                '--rm-accent-bg': accent.background,
                '--rm-accent-fg': accent.foreground,
              } as React.CSSProperties)
            : undefined
        }
      >
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
 * THE COLUMNS OF THE MATCH TABLE, DECLARED ONCE, LABELS AND WIDTHS TOGETHER.
 *
 * "The match history table should have column labels. It's impossible to read
 * what these columns are supposed to mean" — the owner. A header row is only
 * worth having if it lines up with the rows underneath it, and a header that
 * carries its own copy of the widths is two representations of one layout with
 * nothing asserting they agree. So the widths live here and BOTH the header and
 * `MatchRow` read them from this array; changing a width in one place is the
 * only way to change it at all.
 *
 * PLAIN ENGLISH, NOT FIELD NAMES. `placement` is where they finished, `total` is
 * how many people were in the match with them, `survivedMs` is how long they
 * stayed alive before dying — so "Placed", "Field" and "Survived". The last two
 * columns each hold several numbers and are named for what they are about
 * rather than for any one field inside them.
 *
 * THE MATCH ID IS GONE (owner: "Match IDs are not necessary to display in the
 * table"). It was a bare `match 412` in a column of its own, with no link, no
 * copy affordance and nothing anywhere else on the page pointing at it —
 * checked before deleting. The FIELD is untouched: `m.matchId` is still the
 * second half of every row's React key, which is what keeps two matches that
 * ended in the same millisecond from colliding.
 */
const MATCH_COLUMNS = [
  { key: 'placement', label: 'Placed', className: 'w-16 shrink-0' },
  { key: 'field', label: 'Field', className: 'w-12 shrink-0' },
  { key: 'ended', label: 'Ended', className: 'w-36 shrink-0' },
  { key: 'mode', label: 'Mode', className: 'w-14 shrink-0' },
  { key: 'survived', label: 'Survived', className: 'w-32 shrink-0' },
  // The one elastic column, with a floor. `min-w-0` alone would let it collapse
  // to nothing in a narrow card and wrap "7 kills · 1,642 dmg" one character to
  // a line; 12rem is the width at which it wraps to two readable lines instead.
  { key: 'fight', label: 'Kills and damage', className: 'min-w-[12rem] flex-1' },
  // Auto width, pushed right, text right-aligned — so the label's right edge
  // lands on the values' right edge without either being given a fixed width
  // wide enough for the longest possible earnings string.
  { key: 'earned', label: 'Earned', className: 'ml-auto shrink-0 text-right' },
] as const

type MatchColumnKey = (typeof MATCH_COLUMNS)[number]['key']

/** The same classes, by name, for the row that renders values into them. */
const MATCH_COL = Object.fromEntries(
  MATCH_COLUMNS.map((c) => [c.key, c.className]),
) as Record<MatchColumnKey, string>

/**
 * The flex layout every line of the table shares — header and rows alike.
 *
 * `flex-wrap` IS GONE, AND THE HEADER IS WHY. The row used to wrap: at a 1024px
 * window the cells reflowed onto five lines, in an order that depended on how
 * long each value happened to be. That was survivable while the columns were
 * unlabelled — it is exactly what the owner was complaining about — but a header
 * row over a wrapping row is worse than no header, because it lines up on the
 * first line and then lies about every line after it. Measured before changing
 * it: header on three lines, rows on five, at 1024px.
 *
 * SO THE TABLE SCROLLS INSTEAD OF REFLOWING. Every cell keeps its column and
 * long text wraps INSIDE its own cell, which keeps the header true at every
 * width; `MatchTable` puts the whole thing in an `overflow-x-auto` box so a
 * narrow window gets a scrollbar rather than a horizontal page.
 */
const MATCH_LINE = 'flex items-center gap-x-4'

/**
 * The column labels.
 *
 * A `<li>` AT THE TOP OF THE LIST rather than a `<thead>`, because this is a
 * flex list and not a `<table>`, and converting it would restyle every cell.
 * The trade is stated rather than hidden: a screen reader announces the labels
 * as the first item of the list rather than as headers bound to each cell.
 */
function MatchColumnLabels() {
  return (
    <li
      className={cn(
        MATCH_LINE,
        'pb-2 text-xs uppercase tracking-wider text-muted-foreground',
      )}
    >
      {MATCH_COLUMNS.map((c) => (
        <span key={c.key} className={c.className}>
          {c.label}
        </span>
      ))}
    </li>
  )
}

/**
 * The scroll box the match table lives in.
 *
 * Shared by the table and by its skeleton, so the two cannot end up in boxes
 * with different overflow behaviour and different heights.
 */
function MatchTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <ul className="min-w-[42rem] space-y-0">{children}</ul>
    </div>
  )
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
 *
 * EVERY ROW NOW CARRIES ITS TOP BORDER. The `first:border-t-0 first:pt-0` this
 * used to have made the first match sit flush with the top of the panel; the
 * first child of the list is the label row now, so that rule would have deleted
 * the rule UNDER the header instead — which is the one line that makes a header
 * look like one.
 */
function MatchRow({ m }: { m: ProfileMatch }) {
  const firstButDead = m.placement === 1 && !m.won

  /**
   * ONLY THE SURPRISING CASE GETS AN EXPLANATION.
   *
   * The old `title` covered both `won` and `firstButDead`. The winning case did
   * not need it: the gold ring and the trophy beside the number already say it,
   * and a popup on every winning row is noise on a page a moderator scrolls.
   * `#1 in plain grey` is the one that is genuinely unreadable without a
   * sentence, because it looks like a rendering bug rather than a real outcome.
   *
   * AND IT IS THE `<Tooltip>` ITSELF THAT IS CONDITIONAL, not the string inside
   * it. Passing `undefined` content to a mounted tooltip buys an empty popup on
   * every ordinary row — the exact defect a naive conversion produces here.
   */
  const badgeClass = cn(
    'flex items-center justify-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ring-1 ring-inset',
    MATCH_COL.placement,
    m.won
      ? 'bg-warn/10 text-warn ring-warn/30'
      : 'bg-muted/40 text-muted-foreground ring-border',
  )
  const badgeInner = (
    <>
      {m.won && <Trophy className="size-3" />}
      {m.placement > 0 ? `#${m.placement}` : '—'}
    </>
  )
  const deadFirstNote =
    'Placed first but did not survive — the storm took the last squad, so the match had no winner.'

  return (
    <li className={cn(MATCH_LINE, 'border-t border-border/60 py-2.5 text-sm')}>
      {firstButDead ? (
        <>
          <Tooltip>
            {/* `render` keeps this a `<span>` with its own classes. Left to
                itself `TooltipTrigger` renders a `<button>`, which would put a
                button in a bare `<li>` and restyle the badge. */}
            <TooltipTrigger render={<span className={badgeClass} />}>
              {badgeInner}
            </TooltipTrigger>
            <TooltipContent side="top">{deadFirstNote}</TooltipContent>
          </Tooltip>
          {/* This trigger is an inert `<span>`, so nothing focuses it and the
              popup only ever opens for a mouse; and Base UI gives the popup no
              `role` and no `aria-describedby`, so it is never announced anyway.
              The sentence therefore also exists in the DOM. */}
          <span className="sr-only">{deadFirstNote}</span>
        </>
      ) : (
        <span className={badgeClass}>{badgeInner}</span>
      )}

      {/* THE FIELD SIZE SITS WITH THE PLACEMENT, because it is the half that
          gives it meaning: third of eight and third of ninety-six are not the
          same result, and the number alone cannot say which happened. */}
      <span
        className={cn(
          MATCH_COL.field,
          'font-mono text-xs text-muted-foreground/70',
        )}
      >
        {m.total > 0 ? `of ${m.total}` : ''}
      </span>

      <span className={cn(MATCH_COL.ended, 'text-muted-foreground')}>
        <LocalTime ms={m.endedAt} />
      </span>

      <span
        className={cn(MATCH_COL.mode, 'font-mono text-xs text-muted-foreground')}
      >
        {MODE_LABEL[m.mode] ?? (m.mode || 'match')}
      </span>

      {/* TIME ALIVE, NOT MATCH LENGTH. Every player in one match shares its
          duration; how long each of them survived is the interesting half —
          which the word "alive" says in the row instead of on hover. The column
          is w-32 rather than w-20 to pay for it: `humanDuration` emits up to
          "12h 30m", and "12h 30m alive" does not fit in 80px. */}
      <span
        className={cn(
          MATCH_COL.survived,
          'font-mono text-xs text-muted-foreground',
        )}
      >
        {humanDuration(m.survivedMs)} alive
      </span>

      <span
        className={cn(MATCH_COL.fight, 'font-mono text-xs text-muted-foreground')}
      >
        {m.kills} {m.kills === 1 ? 'kill' : 'kills'} · {formatCount(m.damage)} dmg
        {m.downs > 0 ? ` · ${m.downs} ${m.downs === 1 ? 'down' : 'downs'}` : ''}
        {m.revives > 0
          ? ` · ${m.revives} ${m.revives === 1 ? 'revive' : 'revives'}`
          : ''}
      </span>

      <span
        className={cn(MATCH_COL.earned, 'font-mono text-xs text-muted-foreground')}
      >
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
          <Badge
            data-accent-chip=""
            className="border-0 bg-warn/10 text-xs font-semibold uppercase tracking-wider text-warn ring-1 ring-inset ring-warn/30"
          >
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

/**
 * What the band across the top of the identity card is made of, or null when
 * there is no band at all.
 *
 * ONE DECISION, TWO CONSUMERS, WHICH IS WHY IT IS A FUNCTION AND NOT AN `if`
 * INSIDE THE BANNER. The band is drawn by `IdentityBanner`; the AVATAR also has
 * to know whether it exists, because an avatar lifted up over a band that is not
 * there hangs off the top of the card. Deciding "is there a band" in two places
 * is how the two drift apart, which is this repo's signature failure — so it is
 * decided here, once, and handed to both.
 *
 * RETURNS NULL IN THREE DIFFERENT NOTHINGS. No Discord id, Discord did not
 * answer, and an account with neither a banner nor an accent all produce no
 * band — the card simply starts at its content, exactly as it did before any of
 * this existed. Only the middle of those three is worth saying out loud, and
 * `DiscordNames` says it.
 *
 * THERE IS NO `loading` CASE. The whole page is a skeleton until Discord is
 * ready, so nothing downstream of this ever renders mid-flight.
 */
type IdentityBand = { bannerUrl: string | null; accent: AccentSurface | null }

function identityBand(state: DiscordChromeState): IdentityBand | null {
  if (state.status !== 'ready') return null
  const { bannerUrl, accent } = state.chrome
  if (!bannerUrl && !accent) return null
  return { bannerUrl, accent }
}

/**
 * The banner strip across the top of the identity card.
 *
 * WHAT IT IS: the player's own Discord banner image, blurred, over their accent
 * colour. The owner asked for exactly this — "for their profile banner we could
 * use their own banner image as a blurred background for that banner" — and it
 * is the only place on the page that shows what somebody's Discord profile
 * looks like rather than merely what it is called.
 *
 * IT CARRIES NO TEXT, AND THAT IS A CONTRAST DECISION RATHER THAN A LAYOUT ONE.
 * Everything else on this page that sits on the accent colour is legible
 * because `accentSurface` clamped the colour and derived the foreground from
 * it. That guarantee does not survive an arbitrary image being composited in:
 * with a banner at even a quarter of the mix, a mid-tone accent that measures
 * 4.50:1 on its own drops to 3.09:1 against a white banner. So the band is
 * decorative and every word on this card sits on the card.
 */
function IdentityBanner({ band }: { band: IdentityBand | null }) {
  if (!band) return null

  const { bannerUrl, accent } = band

  return (
    <div
      aria-hidden
      className="relative h-24 w-full overflow-hidden"
      style={accent ? { backgroundColor: accent.background } : undefined}
    >
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerUrl}
          alt=""
          /*
            SCALED UP BEFORE IT IS BLURRED. A blur samples outside the element,
            so an unscaled image feathers to transparent at all four edges and
            the band ends up with pale borders it did not ask for. 110% pushes
            those artefacts outside the clip.
          */
          className="size-full scale-110 object-cover blur-lg"
        />
      )}
      {/* A downward fade into the card, so the band ends rather than stops.
          IT STOPS SHORT OF THE AVATAR: the fade is a full-width strip and the
          avatar sits on top of it, ringed in the card's own colour, so the two
          never argue about which is in front. */}
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-card/70" />
    </div>
  )
}

/**
 * How far the avatar is lifted, and it is arithmetic rather than taste.
 *
 * The row below the banner opens with `pt-4` — 18px at this app's 18px root — so
 * a flex item aligned to the start of that row begins 18px BELOW the boundary
 * between the banner and the bar. `-mt-14` is 63px, which puts the top of the
 * avatar 45px ABOVE the boundary: exactly half of the 90px (`size-20`) circle.
 * That is the Discord profile convention the owner attached a screenshot of.
 *
 * `self-start` IS LOAD-BEARING, NOT TIDINESS. The row is `items-center`, under
 * which a negative top margin resolves against the line's cross-size — so the
 * overlap would silently change with how tall the name block happened to be
 * that render. Pinned to the start of the line, the sum above is the whole
 * story.
 */
const FACE_LIFT = '-mt-14 self-start'

/** 90px, and the number the lift above is half of. Changing one changes both. */
const FACE_SIZE = 'size-20'

/**
 * The ring that makes the avatar read as cut OUT of the banner rather than
 * pasted on top of it: the colour of the bar it is straddling, which is the
 * card. A token rather than white, so it tracks the theme instead of vanishing
 * in the dark one.
 */
const FACE_RING = 'ring-[6px] ring-card'

/**
 * The face, sitting proud of the bar with the player's name in it.
 *
 * TWO STATES, NOT THREE. Initials mean there is no Discord id at all and there
 * never will be a picture; a picture means Discord was asked. The third state —
 * a skeleton, meaning the picture is on its way — has moved to the page level,
 * because the owner now wants the whole page to wait rather than this one
 * element. See `ProfileSkeleton`, which draws this circle at this size in this
 * position so the swap does not move anything.
 *
 * THE GENERIC DISCORD LOGO IS STILL WORTH EXPLAINING, because a coloured
 * Discord logo looks enough like a chosen avatar to be mistaken for one. It used
 * to be explained in a native `title`, which docs/hover-text.md bans outright:
 * that string could not be selected, focused or announced, and never appeared on
 * a touch device at all. It is now the same conversion the placement badge in
 * this file already carries — a Tooltip on an inert span, with the identical
 * sentence in the DOM as `sr-only` so nothing lives on hover alone.
 */
function Face({ name, overlap }: { name: string; overlap: boolean }) {
  const state = useDiscordChrome()

  const frame = cn('shrink-0', overlap && FACE_LIFT)

  const initials = (
    <div className={frame}>
      <div
        className={cn(
          FACE_SIZE,
          FACE_RING,
          'flex items-center justify-center rounded-full bg-primary/15 text-2xl font-semibold text-primary',
        )}
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    </div>
  )

  if (state.status !== 'ready') return initials

  const { avatarUrl, real, answered } = state.chrome
  if (!avatarUrl) return initials

  const picture = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt=""
      className={cn(
        FACE_SIZE,
        FACE_RING,
        'rounded-full bg-card object-cover',
      )}
    />
  )

  if (real) return <div className={frame}>{picture}</div>

  const note = answered
    ? 'Default Discord avatar — they have not set a picture.'
    : 'Default Discord avatar — Discord did not answer.'

  return (
    <div className={frame}>
      <Tooltip>
        {/* `render` keeps this a plain block `<span>`. Left to itself
            `TooltipTrigger` renders a `<button>`, which would put a focusable
            control around a decorative image. */}
        <TooltipTrigger render={<span className="block cursor-help" />}>
          {picture}
        </TooltipTrigger>
        <TooltipContent side="bottom">{note}</TooltipContent>
      </Tooltip>
      {/* The popup carries no `role` and no `aria-describedby` in Base UI, and
          the trigger is inert, so the sentence also exists in the DOM. */}
      <span className="sr-only">{note}</span>
    </div>
  )
}

/** "was Slippery Jim until 12 Aug", for one superseded name. */
function FormerName({ change }: { change: DiscordNameChange }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground/70">
        {change.field === 'username' ? '@' : ''}
      </span>
      {change.from}
      <span className="text-muted-foreground/70">
        {' '}
        until <LocalTime ms={change.at} />
      </span>
    </span>
  )
}

/**
 * "formerly known as", for ONE of the two Discord names.
 *
 * ONE COMPONENT, TWO PLACES. `formerNames` records renames of both names and
 * says which one moved, so the handle's history renders under the handle and the
 * display name's under the display name — from this single implementation, so
 * the two cannot drift into looking like different features. `field` is exactly
 * `'username' | 'globalName'`, so partitioning the list between them is total:
 * no recorded rename is dropped by being filed under the wrong name.
 *
 * TWO INLINE, THE REST REACHABLE. A player who renames often would otherwise
 * push the identity card taller than the panels beside it, and the two most
 * recent are the ones that answer "were they called something else when this was
 * reported". `lib/players.ts` keeps up to twenty (DISCORD_NAME_HISTORY), so the
 * overflow is real rather than theoretical.
 *
 * THE OVERFLOW IS NOT A `title` ATTRIBUTE ANY MORE. docs/hover-text.md bans it:
 * a fact parked there cannot be selected, focused or announced, and never fires
 * on touch. Tooltip on an inert span plus the identical string as `sr-only` is
 * the conversion this file already uses for the placement badge.
 */
function FormerNames({ changes }: { changes: DiscordNameChange[] }) {
  if (changes.length === 0) return null

  const rest = changes.slice(2)
  const overflow = rest
    .map((c) => `${c.field === 'username' ? '@' : ''}${c.from}`)
    .join(' · ')

  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-muted-foreground/70">formerly</span>
      {changes.slice(0, 2).map((c, i) => (
        <FormerName key={`${c.field}-${c.at}-${i}`} change={c} />
      ))}
      {rest.length > 0 && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-help underline decoration-dotted underline-offset-2" />
              }
            >
              +{rest.length} more
            </TooltipTrigger>
            <TooltipContent side="top">{overflow}</TooltipContent>
          </Tooltip>
          <span className="sr-only">{overflow}</span>
        </>
      )}
    </span>
  )
}

/**
 * "(last known)" — what is on screen is Ringmaster's stored copy of a name,
 * because Discord did not answer this time.
 *
 * RENDERED BESIDE BOTH NAMES, from one component, because the two names now sit
 * in two different panels and a moderator reading either one alone needs to know
 * it might be stale. One implementation, two placements: they cannot disagree.
 */
function LastKnown() {
  const note =
    'Showing the name Ringmaster last recorded; Discord did not answer this time.'
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<span className="cursor-help" />}>
          (last known)
        </TooltipTrigger>
        <TooltipContent side="top">{note}</TooltipContent>
      </Tooltip>
      <span className="sr-only">{note}</span>
    </>
  )
}

/**
 * The @handle, under the in-game name.
 *
 * TWO NAMES, TWO PLACES, AND THAT SPLIT IS THE OWNER'S: "Where it shows their
 * discord username/nickname — their nickname should be in the identifiers table
 * with descriptor."
 *
 * DISCORD HAS TWO NAMES AND THEY ARE NOT THE SAME KIND OF THING. `username` is
 * the @handle: unique across Discord, changed rarely, and the string you type to
 * find somebody. `global_name` is the display name — free text, changed on a
 * whim, and the one a human recognises. Both used to sit on this line, side by
 * side and unlabelled, which is precisely why they could not be told apart. The
 * display name has moved into the Identifiers panel, labelled and described like
 * every other identifier; the handle stays here, because "is this the right
 * person" is answered by a handle far more often than by a license.
 *
 * "FORMERLY KNOWN AS" IS THE POINT OF STORING ANY OF THIS. It is the only thing
 * on this card that the live Discord call cannot produce — see
 * recordDiscordIdentity in lib/players.ts — and it is there because renaming is
 * what a reported player does next. The history splits with the names: handle
 * renames here, display-name renames beside the display name.
 */
function DiscordNames() {
  const state = useDiscordChrome()

  if (state.status !== 'ready') return null

  const { answered, username, globalName, formerNames } = state.chrome
  const former = formerNames.filter((c) => c.field === 'username')

  if (!answered && !username && !globalName && formerNames.length === 0) {
    return (
      // THE EXPLANATION IS THE SENTENCE, not a hover on it. Rule 2 of
      // docs/hover-text.md: if the words fit next to the thing, put them there.
      <p className="mt-1.5 text-xs text-muted-foreground/70">
        Discord did not answer. The page rendered without it rather than waiting;
        nothing here is a statement about this player.
      </p>
    )
  }

  if (!username && former.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {username && <span className="font-mono">@{username}</span>}
      {!answered && <LastKnown />}
      <FormerNames changes={former} />
    </div>
  )
}

/**
 * The label column of the identifiers table.
 *
 * WIDER THAN IT WAS (w-16 -> w-28) TO PAY FOR "DISPLAY NAME". Every label in
 * this panel used to be one short word — license, discord, steam — and 72px was
 * enough for all of them. "Display name" is twelve characters of uppercase at
 * `tracking-wider`, which is about 109px, so at the old width it wrapped onto
 * two lines under a one-line value. It is a shared constant rather than two
 * copies of `w-28` for the obvious reason: a column with two widths is not a
 * column.
 */
const ID_LABEL =
  'w-28 shrink-0 text-xs uppercase tracking-wider text-muted-foreground'

/**
 * Every identifier we hold for this player, and what Discord calls them.
 *
 * THE DISPLAY NAME IS AN IDENTIFIER ROW NOW (owner, item 1). It sat unlabelled
 * beside the @handle under the in-game name, where the two were indistinguishable
 * — one of them is how you find an account and the other is what somebody
 * decided to call themselves this week.
 *
 * AND IT GETS A DESCRIPTOR, which none of the other rows needs, because it is
 * the only row in this panel you cannot key anything on. A license, a Steam id
 * and a Discord snowflake are all durable handles on a person; a display name is
 * free text the player edits at will. A row that sits in a table of identifiers
 * looking as solid as the ones above it, and is not, would be worse than no row
 * at all — so the descriptor says exactly that, and points at the @handle as the
 * stable one.
 */
function IdentifiersPanel({
  identifiers,
}: {
  identifiers: ProfileIdentifier[]
}) {
  const state = useDiscordChrome()
  const chrome = state.status === 'ready' ? state.chrome : null

  const displayName = chrome?.globalName ?? null
  const former = (chrome?.formerNames ?? []).filter(
    (c) => c.field === 'globalName',
  )

  /*
   * WHEN THE ROW EXISTS AT ALL, and the three cases are not the same.
   *
   *   Discord answered            always a row. "They have not set one" is a
   *                               fact Discord told us, and a row that silently
   *                               vanishes says nothing at all — absence gets
   *                               rendered as absence on this page, not as a
   *                               gap somebody has to notice.
   *   Discord did not answer, but
   *   we have a stored name or a
   *   rename history              a row, marked "(last known)".
   *   Discord did not answer and
   *   we have never seen a name    no row. The identity card already says
   *                               Discord did not answer; repeating it as an
   *                               empty labelled row is furniture.
   */
  const showDisplayName =
    chrome !== null &&
    (chrome.answered || displayName !== null || former.length > 0)

  if (identifiers.length === 0 && !showDisplayName) return <Empty />

  return (
    <ul className="space-y-2">
      {/*
        EVERY VALUE, NOT EVERY KIND. A player can present more than one
        value for the same kind over time — a second Steam account, a
        reissued license — and each of those is a separate row here.

        The key is kind+value rather than kind, which it used to be: two
        sightings of one kind collided, React kept the first, and the extra
        value silently vanished from a page whose whole job is to show what
        we know about somebody.
      */}
      {identifiers.map((id) => (
        <li key={`${id.kind}:${id.value}`} className="flex items-baseline gap-3">
          <span className={ID_LABEL}>{id.kind}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs">
            {id.value}
          </code>
        </li>
      ))}

      {showDisplayName && chrome && (
        <li className="flex items-baseline gap-3 border-t border-border/60 pt-2">
          <span className={ID_LABEL}>Display name</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
              {displayName ? (
                <span className="text-foreground/90">{displayName}</span>
              ) : (
                // "not set" and "not known" are different claims and the page
                // must not make the first one on the second one's evidence.
                <span className="text-muted-foreground/70">
                  {chrome.answered ? 'not set' : 'not known'}
                </span>
              )}
              {!chrome.answered && (
                <span className="text-muted-foreground">
                  <LastKnown />
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground/70">
              What Discord shows for this account — free text they can change at
              any time. The @handle beside their in-game name above is the one
              that identifies the account.
            </p>
            {former.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                <FormerNames changes={former} />
              </div>
            )}
          </div>
        </li>
      )}
    </ul>
  )
}

/* ---------------------------------------------------------------------------
 * THE PAGE, WHILE IT IS WAITING.
 *
 * "While the colors/images are loading I want the entire profile page to show
 * shadcn skeletons" — the owner, reversing an earlier instruction of his own.
 * The page used to stream its body immediately and skeleton only the three
 * Discord-shaped elements; it now shows nothing but skeletons until Discord's
 * JSON AND its images have landed, then swaps the whole thing at one instant.
 *
 * THIS IS THE ONLY LOADING PATH. The per-element skeletons that used to sit on
 * the face, the banner strip and the names are DELETED rather than left behind
 * this — two representations of one wait, with nothing asserting they agree, is
 * the failure this repo keeps shipping. Every `status === 'loading'` branch in
 * this file is now this one.
 *
 * IT LIVES BESIDE `ProfileView` ON PURPOSE, in the same file and immediately
 * above it, because it is a second drawing of that component's layout and the
 * only thing keeping the two in step is that you cannot read one without seeing
 * the other. Shapes are matched to the real content — same card order, same
 * grid, same row counts, same avatar size and lift — so the page does not jump
 * when it swaps.
 *
 * WHAT IS *NOT* SKELETONED: the back link. It is the way out of a page that is
 * still loading, it comes from nowhere and cannot be wrong, and greying it out
 * would take away the one control that works.
 * ------------------------------------------------------------------------- */

/**
 * A run of list rows, built to the real row's box rather than to a guess at it.
 *
 * The incident and audit rows are `flex items-start gap-3 border-t py-2.5` with
 * a `size-6` icon and two lines of text, which measures 66px. This is the same
 * box with grey bars in it, so five of them stack to the same height as five of
 * those — which is the only reason a skeleton is worth drawing at all.
 */
function SkeletonRows({ n, width }: { n: number; width?: string }) {
  return (
    <ul>
      {Array.from({ length: n }, (_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 border-t border-border/60 py-2.5"
        >
          <Skeleton className="mt-0.5 size-6 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Skeleton className={cn('h-5', width ?? 'w-2/3')} />
            <Skeleton className="mt-0.5 h-4 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** `Pager`'s footprint: the rule above it and a row of numbered buttons. */
function SkeletonPager() {
  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <Skeleton className="h-8 w-64" />
    </div>
  )
}

/** `Section`, with grey bars where its header and its content will be. */
function SkeletonSection({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('surface-edge gap-0 overflow-hidden py-0', className)}>
      {/* bg-card/60 rather than an accent: the accent colour is precisely what
          has not arrived yet, and guessing at one would be the pop-in this
          whole arrangement exists to prevent. */}
      <header className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4 w-16 rounded" />
      </header>
      <div className="p-4">{children}</div>
    </Card>
  )
}

/** A grid of `Figure`s: a small label over a large number, twelve times. */
function SkeletonFigures({ n, className }: { n: number; className: string }) {
  return (
    <div className={className}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  )
}

function ProfileSkeleton({ moderation }: { moderation: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true">
      {/* Announced once, because a wall of grey boxes says nothing out loud. */}
      <p className="sr-only" role="status">
        Loading this profile. Waiting for Discord.
      </p>

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to live players
      </Link>

      {/* IDENTITY. The band is always drawn here even though a player with no
          banner and no accent will not have one — this is the state where we do
          not yet know which, and a card that grows a 108px strip on arrival is
          the jump the skeleton exists to prevent. */}
      <Card className="surface-edge gap-0 overflow-hidden p-0">
        <Skeleton className="h-24 w-full rounded-none" />
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          {/* Same size, same lift, same ring as the real face — see FACE_LIFT. */}
          <div className={cn('shrink-0', FACE_LIFT)}>
            <Skeleton className={cn(FACE_SIZE, FACE_RING, 'rounded-full')} />
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-28 rounded-md" />
            </div>
            <Skeleton className="h-3.5 w-56" />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex gap-6">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
            {moderation && (
              <div className="flex gap-2">
                <Skeleton className="h-9 w-20 rounded-md" />
                <Skeleton className="h-9 w-20 rounded-md" />
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identifiers: three value rows, then the display name with its
            descriptor and its rename history under it. */}
        <SkeletonSection>
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-baseline gap-3">
                <Skeleton className="h-4 w-24 shrink-0" />
                <Skeleton className="h-4 min-w-0 flex-1" />
              </div>
            ))}
            <div className="flex items-baseline gap-3 border-t border-border/60 pt-2">
              <Skeleton className="h-4 w-24 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          </div>
        </SkeletonSection>

        {/* Play record: twelve figures on the same responsive grid. */}
        <SkeletonSection>
          <SkeletonFigures
            n={12}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3"
          />
        </SkeletonSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonSection>
          <SkeletonFigures n={2} className="grid grid-cols-2 gap-4" />
          <div className="mt-4 space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-40" />
          </div>
          <Skeleton className="mt-3 h-3.5 w-44" />
        </SkeletonSection>

        <SkeletonSection>
          <SkeletonFigures n={2} className="grid grid-cols-2 gap-4" />
        </SkeletonSection>
      </div>

      {/* Incidents: the tab strip, then five rows and a pager. */}
      <SkeletonSection>
        <div className="flex gap-2">
          <Skeleton className="h-12 w-52 rounded-md" />
          <Skeleton className="h-12 w-44 rounded-md" />
        </div>
        <div className="mt-3">
          <SkeletonRows n={PROFILE_PER_PAGE} />
        </div>
        <SkeletonPager />
      </SkeletonSection>

      {/* Kicks and bans. */}
      <SkeletonSection>
        <SkeletonRows n={PROFILE_PER_PAGE} width="w-1/2" />
        <SkeletonPager />
      </SkeletonSection>

      {/* Match history, including its new label row. The columns come from
          MATCH_COLUMNS so the skeleton cannot drift from the table — except for
          `earned`, whose real cell is shrink-to-fit around its text and would
          collapse to nothing around a `w-full` bar. */}
      <SkeletonSection>
        <MatchTable>
          <li className={cn(MATCH_LINE, 'pb-2')}>
            {MATCH_COLUMNS.map((c) => (
              <span
                key={c.key}
                className={cn(c.className, c.key === 'earned' && 'w-44')}
              >
                <Skeleton className="h-3 w-full" />
              </span>
            ))}
          </li>
          {Array.from({ length: PROFILE_PER_PAGE }, (_, i) => (
            <li
              key={i}
              className={cn(MATCH_LINE, 'border-t border-border/60 py-2.5')}
            >
              {MATCH_COLUMNS.map((c) => (
                <span
                  key={c.key}
                  className={cn(c.className, c.key === 'earned' && 'w-44')}
                >
                  <Skeleton className="h-5 w-full" />
                  {/* The kills-and-damage cell is the one that runs to two
                      lines on a busy match, which is what sets the real row's
                      height. A one-line skeleton row here would be 24px short
                      five times over. */}
                  {c.key === 'fight' && (
                    <Skeleton className="mt-1 h-5 w-2/3" />
                  )}
                </span>
              ))}
            </li>
          ))}
        </MatchTable>
        <SkeletonPager />
      </SkeletonSection>
    </div>
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
  /*
   * THE GATE (owner, item 3). One `ready` signal, one skeleton, one page.
   *
   * `DiscordChrome` already produces exactly the signal this needs: `loading`
   * until Discord has answered AND every image it named has been decoded, with
   * a five-second ceiling on each half so it cannot hang. Reading it here rather
   * than building a second wait is the whole point — the alternative is two
   * loading paths that agree until they do not.
   *
   * `absent` FALLS STRAIGHT THROUGH, and that is the owner's earlier instruction
   * surviving this one intact: a player with no Discord id is not a player whose
   * Discord data is loading, so there is no promise, no wait and NO SKELETON AT
   * ALL. `DiscordChromeProvider` decides that from `promise === null`, on the
   * server and the client identically, which is also what keeps this from being
   * a hydration mismatch.
   */
  const chromeState = useDiscordChrome()

  const kd = p.stats && p.stats.deaths > 0
    ? (p.stats.kills / p.stats.deaths).toFixed(2)
    : '—'

  // #22 item 6 — see NOT_AN_ACTION. Kicks and bans lists what was DONE to this
  // player; a decision about a report is not one of those things.
  const moderationActions = p.actions.filter((a) => !NOT_AN_ACTION.has(a.action))

  if (chromeState.status === 'loading') {
    return <ProfileSkeleton moderation={moderation !== undefined} />
  }

  // Decided once and used twice — the band is drawn by IdentityBanner and the
  // avatar's lift depends on there being one. See identityBand.
  const band = identityBand(chromeState)

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
          the wrong person.

          THE CARD'S OWN PADDING IS GONE so the banner strip can be full bleed;
          the content below it carries the padding instead.

          `overflow-hidden` STAYS, and it is what keeps the avatar from breaking
          the card's rounded corners now that it straddles the band. Nothing is
          clipped by it: the lifted circle's top sits 45px below the top of the
          108px band, well inside the card. */}
      <Card className="surface-edge animate-rise gap-0 overflow-hidden p-0">
        <IdentityBanner band={band} />

        {/* items-center: the name sits below the avatar's midline, which is
              where a Discord profile puts it. The avatar itself opts out with
              `self-start` — see FACE_LIFT for why that is arithmetic. */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          {/* THE FACE, straddling the band above it (owner, item 2). Initials or
              a picture; the third state is the whole-page skeleton now. */}
          <Face name={p.name} overlap={band !== null} />

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
                identifier will go.

                WHAT DISCORD CALLS THEM DOES sit here, under the in-game name,
                because "is this the right person" is answered by a Discord
                handle far more often than by a license — and because a name
                that changed last Tuesday is a moderation fact. */}
            <DiscordNames />
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
          {/* The stored identifiers plus what Discord calls this account —
              see IdentifiersPanel for why the display name belongs here and the
              @handle does not. */}
          <IdentifiersPanel identifiers={p.identifiers} />
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
              data-accent-chip=""
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
              data-accent-chip=""
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
              <MatchTable>
                {/* THE COLUMN LABELS (owner, item 4). Inside the list rather
                    than above it, so the rule under the header is the first
                    row's own top border and there is no second border to keep
                    in step with it. */}
                <MatchColumnLabels />
                {slice.map((m) => (
                  <MatchRow key={`${m.endedAt}-${m.matchId}`} m={m} />
                ))}
              </MatchTable>
            )}
          </Paged>
        )}
      </Section>
    </div>
  )
}
