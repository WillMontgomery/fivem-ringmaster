'use client'

import {
  ArrowLeft,
  Ban,
  Clock,
  Crosshair,
  FileWarning,
  Flag,
  Flame,
  Gavel,
  Shield,
  Shirt,
  Skull,
  Swords,
  Trophy,
  User,
  Users,
} from 'lucide-react'
import { Fragment, useState } from 'react'
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
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
/*
 * `import type { Ban as BanRecord } from '@/lib/bans'` USED TO BE HERE, aliased
 * because `Ban` in this file is already the lucide icon. It went with the
 * `moderation.ban` prop: nothing in this file reads a ban ROW any more — the
 * chip reads `p.ban` for its card and `banned` for whether to draw at all, and
 * the buttons take the same `banned`. See the `moderation` prop.
 */
import type { AccentSurface } from '@/lib/contrast'
import { ago, humanDuration } from '@/lib/duration'
import { filedByAPlayer, incidentChips, verdictTone } from '@/lib/incidentChip'
import { labelFor } from '@/lib/labels'
import type {
  DiscordNameChange,
  Profile,
  ProfileActionTaken,
  ProfileIdentifier,
  ProfileIncident,
  ProfileMatch,
} from '@/lib/profile'
import { formatCount, utcIso } from '@/lib/time'
import { cn } from '@/lib/utils'
import { nextThresholdFor } from '@/lib/xp'

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
  wrap = false,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  value: string | number
  label: string
  /** Grid placement, for figures whose value needs more than one column. */
  className?: string
  /**
   * LET THIS VALUE TAKE A SECOND LINE INSTEAD OF LOSING ITS END.
   *
   * `truncate` is right for every figure that is ONE number: a count clipped
   * mid-digit is unreadable either way, and no cell in this app is narrow
   * enough to clip one. It is wrong for a value made of TWO numbers with a
   * separator, because the half that gets cut is a fact of its own — which is
   * exactly how "2,707 / 2,8…" shipped twice (#22 item 11, then again when a
   * value was promoted into a fixed grid without measuring).
   *
   * So the one figure that carries a pair opts out. It breaks at the space
   * around the slash and only ever does so where the alternative was ellipsis:
   * measured at 375 and in the 1024-1130 band, one line everywhere else. Both
   * numbers survive at every width, which is the property that matters.
   */
  wrap?: boolean
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-mono text-xl tabular-nums',
          wrap ? 'break-words' : 'truncate',
        )}
      >
        {value}
      </div>
    </div>
  )
}

/*
 * THE STATE CHIP MOVED OUT, IT DID NOT GROW A SECOND COPY (#28).
 *
 * This used to be a pair of local maps from `state` to a word and a colour. The
 * word is no longer a function of `state` alone — a resolved incident now says
 * what was decided — and the incident queue renders the same chip about the same
 * rows. Two copies of that rule is how one list ends up saying "resolved" while
 * the other says "resolved · banned" about the same case, so it lives in
 * `lib/incidentChip` and both read it. See `NOT_AN_ACTION` below, whose
 * justification depends on this chip actually narrowing.
 */

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
  verdictLabel,
}: {
  i: ProfileIncident
  now: number
  /** Which tab this row is in — decides who the "other party" is. */
  direction: 'against' | 'by'
  categoryLabel: Record<string, string>
  verdictLabel: Record<string, string>
}) {
  const byAPlayer = filedByAPlayer(i)
  const chips = incidentChips(i, verdictLabel)

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
            {byAPlayer
              ? `Reported for ${labelFor(categoryLabel, i.category)}`
              : i.summary}
          </Link>
          {byAPlayer && other.name ? (
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

      {/*
        TWO CHIPS ON A CLOSED CASE, NOT ONE COMPOUND ONE (owner, playtest):
        "all we need is the white 'resolved' chip. If an action was taken, that
        should be its own (red) chip and read specifically 'KICKED' or
        'BANNED'." The shape is `incidentChips`, shared with the queue, so the
        same row cannot read differently in the two places it is listed.
      */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {chips.map((chip) => (
          <Badge
            key={chip.label}
            variant="outline"
            className={cn(
              'rounded-md border-0 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
              chip.tone,
            )}
          >
            {chip.label}
          </Badge>
        ))}
      </div>
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
        {labelFor(MODE_LABEL, m.mode) || 'match'}
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
  return labelFor(ACTION_LABEL, action)
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
 * THE FILTER IS UNCONDITIONAL, and it is now a CHOICE rather than a corner it
 * was backed into. It used to be forced: there was no machine-readable "action
 * taken" on a resolution, because `lib/incidents` stored the admin's decision as
 * free text (the box literally suggested "Banned for 7 days / watched a match,
 * looked fine / no action"), so nothing here could tell an action-taken closure
 * from a no-action one. #28 added `verdict`, and the `incident.resolve` audit
 * row now carries `detail.verdict` — so this list CAN discriminate.
 *
 * IT STILL DROPS THEM ALL, and the verdict is what makes that defensible rather
 * than merely convenient. Work through every case a row can be in:
 *
 *   verdict `ban` or `kick`   the action already wrote its own `ban.issue` or
 *                             `player.kick` row, which is still listed here.
 *                             Keeping the resolution too would show one event
 *                             as two rows, and the second one would repeat the
 *                             first one's reason.
 *   verdict `none`            #22 item 6, the owner: "A resolution with no
 *                             action is not an entry in a list of actions."
 *   no verdict on the row     a closure from before #28. Unknowable, and
 *                             therefore the one row that could never be listed
 *                             honestly under a heading that says "actions".
 *
 * So nothing is lost, and the reason has changed from "we cannot tell" to "we
 * can tell, and every answer is still no". What was decided lives on the
 * incident, and — since #28 — on the Incidents panel above, whose row carries a
 * red BANNED or KICKED chip beside the bare word "resolved" rather than only
 * the bare word. See {@link incidentChips}, which is the thing that has to stay
 * true for this paragraph to. (It said "resolved · banned" as one chip until
 * the owner asked for the two facts to be two chips; the claim this paragraph
 * rests on — that an action is still visible on the incident row — is
 * unchanged.)
 */
const NOT_AN_ACTION = new Set(['incident.resolve'])

/**
 * The same actions, worded for the OTHER direction: what this person DID.
 *
 * A SECOND MAP, NOT A SECOND SPELLING OF THE FIRST. `ACTION_LABEL` above reads
 * as a thing that happened — "Banned", "Kicked" — because those rows sit on the
 * profile of the person it happened TO. These rows sit on the profile of the
 * person who did it, next to the name of somebody else, so they are verbs with an
 * object: "Banned Vance", "Closed an incident about Vance". Reusing the first map
 * would produce "Banned — Vance" on a panel titled "Actions taken", which reads
 * as though the page's owner were the one banned.
 *
 * `incident.resolve` IS IN THIS ONE AND EXCLUDED FROM THE OTHER, which is the
 * whole difference between the two panels. Closing a report is not something done
 * to the subject — see `NOT_AN_ACTION` — but it is unambiguously something the
 * ADMIN did, and it is the third of the three things the owner listed
 * ("kicked, banned, or actioned an incident").
 */
const ACTION_TAKEN_LABEL: Record<string, string> = {
  'ban.issue': 'Banned',
  'ban.lift': 'Lifted the ban on',
  'player.kick': 'Kicked',
  'incident.resolve': 'Closed an incident about',
}

/**
 * The two acts that can be taken WITHOUT a case behind them.
 *
 * "ON-DEMAND" IS THE OWNER'S WORD AND IT NAMES A FEATURE, not a missing value:
 * "for the bans issued from the profile page — there's nothing to link to, so
 * let's just say banned on-demand. That's what we'll call that feature on the
 * profile page I guess lol — kicks/bans on-demand."
 *
 * WHICH DISTINCTION WAS ALREADY ON THIS ROW AND WAS INVISIBLE. A ban decided on
 * an incident renders a link to it; a ban decided from a profile rendered
 * nothing at all, so "no case" and "the link is missing" looked identical. Now
 * one of them says which it is, in the same slot, in the owner's words.
 *
 * `ban.lift` IS NOT IN HERE and neither is `incident.resolve`. A lift is never
 * decided on a case, so calling it on-demand would be marking every one of them
 * with a distinction that has no other side; a closure always has an incident by
 * definition. The owner named kicks and bans, and those are the two.
 */
const ON_DEMAND = new Set(['ban.issue', 'player.kick'])

/**
 * An action that was dispatched and did not land, on a row that otherwise looks
 * exactly like one that did.
 *
 * THE OUTCOME BADGE IS GONE AND A FAILURE IS NOT. "OK / PENDING / FAILED" meant
 * nothing to somebody reading a moderation history — a successful action does
 * not need announcing, and a green tick beside almost every line trains the eye
 * to skip the column where the one failure lives. An action that did NOT happen
 * still needs saying: a kick shown identically to one that landed is a false
 * record.
 *
 * ONE COMPONENT, TWO PANELS. The wording is the owner's from the Kicks-and-bans
 * row and it now serves "Actions taken" as well — the SAME state, on the same
 * page, about the same audit row read from the other end. Two copies of one
 * sentence is how the two ends of one fact start disagreeing, and the second one
 * would also have been a string this task authored rather than inherited.
 */
function DidNotHappen() {
  return <span className="text-danger"> · did not go through</span>
}

/** The colour of the marker beside one action taken. */
const ACTION_TAKEN_TONE: Record<string, string> = {
  'ban.issue': 'bg-danger/10 text-danger ring-danger/25',
  'player.kick': 'bg-warn/10 text-warn ring-warn/25',
  'ban.lift': 'bg-muted/40 text-muted-foreground ring-border',
  'incident.resolve': 'bg-info/10 text-info ring-info/25',
}

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
  verdictLabel,
}: {
  against: ProfileIncident[]
  filed: ProfileIncident[]
  now: number
  categoryLabel: Record<string, string>
  verdictLabel: Record<string, string>
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
            verdictLabel={verdictLabel}
          />
        </TabsContent>
        <TabsContent value="by">
          <IncidentList
            rows={filed}
            direction="by"
            now={now}
            categoryLabel={categoryLabel}
            verdictLabel={verdictLabel}
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
  verdictLabel,
}: {
  rows: ProfileIncident[]
  direction: 'against' | 'by'
  now: number
  categoryLabel: Record<string, string>
  verdictLabel: Record<string, string>
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
              verdictLabel={verdictLabel}
            />
          ))}
        </ul>
      )}
    </Paged>
  )
}

/**
 * ACTIONS TAKEN — what this person did TO other people (owner).
 *
 * "there should be an additional table on the page labelled 'Actions taken'
 * which lists all times they've kicked, banned, or actioned an incident.
 * Remember they may ban as a verdict of an incident - in which case it shouldn't
 * be counted twice."
 *
 * ═══ THE COUNTING RULE IS NOT IN THIS FILE ═══
 *
 * The rows arriving here are ALREADY one per act: `lib/actionsTaken.ts` folds the
 * `incident.resolve` row into the `ban.issue` or `player.kick` row it shares an
 * `incidentId` with, and folds the enforcement kick into the ban that caused it.
 * That rule is a pure function on audit-shaped rows rather than a filter in the
 * markup, for the reason `NOT_AN_ACTION` below this panel's sibling is a Set and
 * not an `if`: a counting rule embedded in JSX cannot be driven by a fixture, and
 * this one has four cases that all look identical on screen when they are wrong.
 *
 * ═══ WHEN THE PANEL EXISTS AT ALL ═══
 *
 * Almost nobody has taken a moderation action, so an empty "Actions taken" panel
 * on every profile in the console would be furniture — the same argument that
 * keeps the in-game name row off a player who has never renamed. It renders when
 * there is something to show, OR when the ADMIN chip is showing, which is the
 * owner's sentence read whole: "if the person is an admin … there should be an
 * additional table". An admin with nothing in it gets the house empty state, the
 * same one four other panels on this page use, and not a sentence of its own.
 *
 * WHICH MEANS AN ADMIN'S PANEL DISAPPEARS WHILE DISCORD IS DOWN, if they have
 * never acted. `admin` is false for "Discord did not answer" as well as for "not
 * an admin" — see AdminChip — so an empty panel is not reachable without a live
 * answer. A panel with rows in it is unaffected: those come from the audit log.
 *
 * ═══ THE VERDICT CHIP, AND WHEN IT WOULD BE A REPEAT ═══
 *
 * Only `incident.resolve` rows carry one. On a collapsed ban-from-an-incident the
 * row already reads "Banned", and a red BANNED chip beside it would be the exact
 * double-count this panel exists to remove, moved one line to the right. On a
 * closure the chip is the only thing that says what was decided — "No action" in
 * the quiet tone, from the same `verdictTone` the incident rows use, so a
 * conscientious no-action closure is never painted as a failure.
 */
function ActionsTakenPanel({
  rows,
  now,
  verdictLabel,
}: {
  rows: ProfileActionTaken[]
  now: number
  verdictLabel: Record<string, string>
}) {
  return (
    <Section
      title="Actions taken"
      provenance={<ProvenanceTag kind="moderation" />}
      action={
        rows.length > 0 ? (
          <Badge
            data-accent-chip=""
            variant="outline"
            className="border-0 bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border"
          >
            {rows.length}
          </Badge>
        ) : null
      }
    >
      {rows.length === 0 ? (
        /*
         * THE HOUSE EMPTY STATE, WORD FOR WORD, and no sentence of its own. Four
         * other panels on this page render exactly this — Identifiers, Play
         * record, Progression, Sessions — so an empty "Actions taken" reads as
         * the same absence they do rather than as a paragraph somebody wrote for
         * this one panel. See `Empty`.
         */
        <Empty />
      ) : (
        <Paged items={rows} perPage={PROFILE_PER_PAGE} label="Actions taken pages">
          {(slice) => (
            <ul>
              {slice.map((a) => (
                <li
                  key={`${a.at}-${a.action}-${a.targetLicense ?? ''}`}
                  className="flex items-start gap-3 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0"
                >
                  <div
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset',
                      ACTION_TAKEN_TONE[a.action] ??
                        'bg-muted/40 text-muted-foreground ring-border',
                    )}
                  >
                    <Gavel className="size-3.5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-medium">
                        {labelFor(ACTION_TAKEN_LABEL, a.action)}
                      </span>{' '}
                      {/* THE SUBJECT LINKS TO THEIR OWN PROFILE, the way both
                          parties do everywhere else moderation is listed —
                          "who did they do this to" should be one click. A row
                          the log recorded without a name says so rather than
                          rendering a blank. */}
                      {a.targetLicense ? (
                        <Link
                          href={`/players/${encodeURIComponent(a.targetLicense)}`}
                          className="underline underline-offset-2 transition-colors hover:text-foreground"
                        >
                          {a.targetName ?? a.targetLicense}
                        </Link>
                      ) : (
                        // The house dash for a value we do not have, not a
                        // sentence about not having it.
                        <span>{a.targetName ?? '—'}</span>
                      )}
                      {a.reason ? (
                        <span className="text-muted-foreground"> — {a.reason}</span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      <LocalTime ms={a.at} /> · {ago(a.at, now)}
                      {/* THE INCIDENT, LINKED WHERE THERE IS ONE. A link needs a
                          label; this one is the noun naming its destination and
                          not a phrase about it.

                          AND WHERE THERE IS NONE, THE OWNER'S WORD FOR THAT —
                          see ON_DEMAND. Not a link and not styled as one:
                          there is nowhere for it to go, which is the whole
                          fact it is stating. */}
                      {a.incidentId ? (
                        <>
                          {' · '}
                          <Link
                            href={`/incidents/${a.incidentId}`}
                            className="underline underline-offset-2 transition-colors hover:text-foreground"
                          >
                            incident
                          </Link>
                        </>
                      ) : ON_DEMAND.has(a.action) ? (
                        <> · on-demand</>
                      ) : null}
                      {a.outcome === 'failed' && <DidNotHappen />}
                    </div>
                  </div>

                  {a.action === 'incident.resolve' && a.verdict && (
                    <div className="flex shrink-0 items-center justify-end">
                      <Badge
                        variant="outline"
                        className={cn(
                          'rounded-md border-0 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
                          verdictTone(a.verdict),
                        )}
                      >
                        {labelFor(verdictLabel, a.verdict)}
                      </Badge>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Paged>
      )}
    </Section>
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
          THE FADE IS WHY THIS WHOLE BAND IS `relative`, and that is the fact
          FACE_STACK exists to answer: the fade is `absolute` and needs a
          positioned ancestor, which puts the band into the painting step that
          covers every non-positioned sibling. See FACE_STACK. */}
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
 * WHY THE FACE HAS TO BE POSITIONED, AND IT IS PAINTING ORDER RATHER THAN
 * ARITHMETIC.
 *
 * THE BUG THIS FIXES: the top 45px of the avatar rendered UNDERNEATH the banner
 * — the colour, the blurred image and the fade — instead of proud of it. The
 * geometry was never wrong. Measured on the rendered page before touching
 * anything: the band's bottom edge sits at y=482.78 and the avatar runs
 * 437.78–527.78, i.e. exactly 45px above the line and 45px below it, which is
 * what FACE_LIFT says it should be. `elementsFromPoint` at the avatar's own top
 * returned, in front-to-back order, the fade, the banner image, the banner, and
 * only THEN the avatar. It was behind all three.
 *
 * THE CAUSE IS `IdentityBanner`'s `relative`. Within one stacking context CSS
 * paints in-flow, non-positioned block descendants (step 4) before positioned
 * descendants with `z-index: auto` (step 8) — and DOM order only breaks ties
 * WITHIN a step. The band is `position: relative`, because the fade inside it is
 * `absolute` and needs an anchor; the avatar's wrapper was `position: static`.
 * So the band painted in step 8 over an avatar in step 4, and coming first in
 * the markup did not save it. Nothing had a `z-index`, nothing was
 * `overflow-hidden` on the wrong element, and no gradient was drawn "after" the
 * avatar in source order — the ordering was structural.
 *
 * THE FIX IS TO PUT THE FACE IN THE SAME STEP, where being later in the markup
 * finally means something. `z-10` is belt and braces rather than the mechanism:
 * `relative` alone is sufficient today, and the explicit index is what keeps
 * this working if the band ever acquires one of its own.
 *
 * IT IS PAIRED WITH FACE_LIFT AND APPLIED WITH IT. With no band there is no
 * overlap, nothing to sit in front of, and the avatar is not lifted either —
 * see `?discord=plain` and `?discord=none` in the preview harness.
 */
const FACE_STACK = 'relative z-10'

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

  // FACE_STACK travels with FACE_LIFT: the lift is what creates the overlap,
  // and the overlap is the only thing that needs to be painted in front.
  const frame = cn('shrink-0', overlap && FACE_LIFT, overlap && FACE_STACK)

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

/**
 * One superseded name, of any kind.
 *
 * NOT `DiscordNameChange`, AND THE DIFFERENCE IS THE POINT. The same "formerly
 * …" line now renders THREE histories: the Discord @handle, the Discord display
 * name, and the IN-GAME name the game server reports. The first two are
 * `DiscordNameChange`s. The third comes from `p.names` — Ringmaster's own record
 * of what the game called this player, which has never been near Discord and
 * carries a `lastSeen` rather than a `to`. Casting game names into a
 * Discord-shaped object so one component could take both would put a false claim
 * in a type on a page a moderator acts from; a neutral shape and two three-line
 * adapters cost less and lie about nothing.
 */
type FormerNameItem = {
  /** The value that was replaced. Never empty. */
  from: string
  /** When it stopped being the current one, as far as Ringmaster can tell. */
  at: number
  /** Draws the `@` prefix. True for the Discord @handle and nothing else. */
  handle: boolean
}

/** A Discord rename, as a former name. */
function fromDiscord(c: DiscordNameChange): FormerNameItem {
  return { from: c.from, at: c.at, handle: c.field === 'username' }
}

/** "was Slippery Jim until 12 Aug", for one superseded name. */
function FormerName({ item }: { item: FormerNameItem }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground/70">{item.handle ? '@' : ''}</span>
      {item.from}
      <span className="text-muted-foreground/70">
        {' '}
        until <LocalTime ms={item.at} />
      </span>
    </span>
  )
}

/**
 * "formerly known as", for ONE name.
 *
 * ONE COMPONENT, THREE PLACES NOW. A rename history renders directly under the
 * name it is a history OF — the @handle's beside the @handle, the display name's
 * beside the display name, the in-game name's beside the in-game name — from
 * this single implementation, so the three cannot drift into looking like
 * different features. Partitioning is the caller's job and it is total: `field`
 * is exactly `'username' | 'globalName'` for the Discord pair, and `p.names` is
 * the whole of the game's.
 *
 * THE HISTORY MUST TOUCH ITS NAME, and that is the whole of the owner's fourth
 * item. The in-game history used to sit in the Sessions panel under the heading
 * "Also known as", two cards away from any name at all: a bare list of strings
 * beside a session count, with nothing on screen saying whose names they were,
 * which name they replaced, or when. "was Preview Player until 15 Aug" under a
 * row labelled "In-game name" needs no explaining. A list of nouns next to
 * "74 sessions" cannot be explained.
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
function FormerNames({ items }: { items: FormerNameItem[] }) {
  if (items.length === 0) return null

  const rest = items.slice(2)
  const overflow = rest.map((c) => `${c.handle ? '@' : ''}${c.from}`).join(' · ')

  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-muted-foreground/70">formerly</span>
      {items.slice(0, 2).map((c, i) => (
        <FormerName key={`${c.from}-${c.at}-${i}`} item={c} />
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
      <FormerNames items={former.map(fromDiscord)} />
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

/*
 * `IdLabel` USED TO LIVE HERE AND IS GONE RATHER THAN LEFT UNCALLED.
 *
 * It was the self-explaining label for the two rows this panel no longer has:
 * "Display name" and "In-game name", each a heading, what the row was, and the
 * trap it warned about. The owner asked for both by name — "any helper text
 * should be a hover card, not just out in the open" — and it did that job.
 *
 * IT HAD EXACTLY TWO CALL SITES AND BOTH ARE NOW ONE ROW. Merging them into
 * "Other names" (the owner's later instruction) left the component with nothing
 * to label, and writing a THIRD descriptor to cover the merged row would have
 * been copy nobody asked for — which the owner has since ruled out in general:
 * "please do not add any helper text to any pages on your own ever."
 *
 * SO IT IS DELETED, NOT PARKED. A component with no callers is this repo's
 * signature failure and the thing its own notes warn about hardest. If a
 * descriptor for "Other names" is wanted, the words have to come from the owner,
 * and this comes back with them — out of git, unchanged.
 */

/**
 * The chip that says a player is banned, and the record behind it on hover.
 *
 * WHAT IT REPLACED. Two chips sat here: "Currently banned", which was correct
 * and said nothing else, and "1 BAN", a count of a row that can only ever be one
 * and that appeared for lifted and served bans too. The owner asked for the
 * count to go and for the remaining chip to read plainly — and a moderator who
 * then wants to know WHY, WHO and FOR HOW LONG had to scroll to a panel.
 *
 * A CARD RATHER THAN A TOOLTIP, by rule 5 of docs/hover-text.md: this is three
 * labelled rows, which is a layout. A single-line pill cannot hold a free-text
 * reason, a linked admin and a countdown.
 *
 * THE SAME IDIOM AS `IdLabel`, DELIBERATELY, AND FOR THE SAME REASON: one
 * treatment on this page rather than two. Trigger rendered as the chip itself
 * (`HoverCardTrigger` renders an `<a>` left alone, which would nest an anchor
 * with no href beside the player's name), the affordance visible rather than
 * discovered by accident, and EVERY STRING IN THE CARD ALSO IN THE DOM as
 * `sr-only` — Base UI's popup carries no `role` and no `aria-describedby`, and
 * an inert chip cannot be focused, so the hover reaches a sighted mouse user and
 * nobody else. The rows are built once, as strings, and rendered twice.
 *
 * THE ADMIN LINKS WHERE WE HAVE A LICENSE, which is how `AuditList` and the
 * incident rows already treat both parties: moderation is a thing people do to
 * people. A system-issued ban has no license and renders as plain text rather
 * than a link to nowhere. The spoken copy carries the name either way.
 */
function BannedChip({
  ban,
  now,
}: {
  ban: Profile['ban']
  now: number
}) {
  const chip =
    'gap-1 border-0 bg-danger/10 text-xs font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30'

  /*
   * THE CHIP STANDS ALONE IF THE ROW IS MISSING. `banned` is decided on the
   * server by `bans.isActive` and this is the row it was decided from, so the
   * two arrive together — but a chip that threw, or vanished, because the detail
   * behind it was absent would trade the most important fact on the page for the
   * least. The fact is the chip; the card is the elaboration.
   */
  if (!ban) {
    return (
      <Badge className={chip}>
        <Ban className="size-3" />
        Banned
      </Badge>
    )
  }

  /*
   * PERMANENT SAYS SO AND COUNTS DOWN TO NOTHING. `expiresAt` is null for
   * permanent (lib/bans — an absolute instant or nothing, never a duration), so
   * there is no arithmetic to do and no "expires in NaN" to render.
   *
   * AND AN EXPIRY IN THE PAST IS ITS OWN SENTENCE. Nothing sweeps this table:
   * `isActive` simply stops counting a ban once its instant has passed, and the
   * row stays. A page rendered a moment before that boundary — or left open
   * across it — would otherwise ask `humanDuration` for a negative number, which
   * answers "—". Say what actually happened instead.
   *
   * A DURATION, NOT A TIMESTAMP, because "in 4 days" is the question a moderator
   * is asking. The instant it was issued is in Kicks and bans below, with the
   * rest of the history.
   */
  const expiry =
    ban.expiresAt === null
      ? 'Permanent — it does not expire.'
      : ban.expiresAt <= now
        ? 'The end of it has passed — they are no longer banned.'
        : `Ends in ${humanDuration(ban.expiresAt - now)}.`

  const rows = [
    { label: 'Reason', value: ban.reason, license: null },
    { label: 'Banned by', value: ban.by, license: ban.byLicense },
    { label: 'How long', value: expiry, license: null },
  ]

  return (
    <HoverCard>
      <HoverCardTrigger render={<Badge className={cn(chip, 'cursor-help')} />}>
        <Ban className="size-3" />
        {/* The dotted underline is the affordance. A chip that hides its own
            explanation until somebody happens to point at it is the complaint
            that produced `IdLabel`; `cursor-help` alone only pays out once the
            pointer is already there. */}
        <span className="underline decoration-dotted decoration-danger/50 underline-offset-2">
          Banned
        </span>
        <span className="sr-only">
          . {rows.map((r) => `${r.label}: ${r.value}`).join(' ')}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-72">
        <p className="text-sm font-medium">Banned</p>
        <dl className="mt-1.5 space-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                {r.label}
              </dt>
              <dd className="text-foreground">
                {r.license ? (
                  <Link
                    href={`/players/${encodeURIComponent(r.license)}`}
                    className="underline underline-offset-2 transition-colors hover:text-muted-foreground"
                  >
                    {r.value}
                  </Link>
                ) : (
                  r.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * The chip that says this person is an admin. There is no second chip.
 *
 * ═══ WHAT "ADMIN" MEANS HERE, AND IT IS NOT THE GRANTS TABLE ═══
 *
 * The owner: "if the person is an admin (meaning they have the discord role)".
 * That is `lib/discordRole.ts` — the same live check that runs before every
 * write — asked once per profile render and carried on the Discord chrome. There
 * is deliberately no second notion of admin-ness on this page: a console where
 * the chip and the gate can disagree about the same person would be worse than a
 * console with no chip, and this repository has shipped exactly that shape of
 * defect before.
 *
 * ═══ ONE CHIP, AND ITS ABSENCE MEANS FOUR THINGS ═══
 *
 * There was a second chip. A quiet `ADMIN?` covered the case where Discord did
 * not answer — a timeout, a 429, a 5xx, a guild the bot cannot see — so that a
 * red ADMIN could never vanish merely because Discord was slow. The owner has
 * ruled it out: "Change ADMIN? to just show nothing."
 *
 * So `admin` is a plain boolean now — see lib/profile.ts, where the four-state
 * type used to be — and FALSE COVERS FOUR SITUATIONS THIS PAGE CANNOT TELL
 * APART: Discord said no, Discord did not answer, there is no bot token, and the
 * player has no Discord account at all.
 *
 * WHAT AN OPERATOR SEES WHILE DISCORD IS DOWN, written here because this is
 * where somebody will come looking: a genuine admin's profile is identical to a
 * non-admin's. No chip, nothing marking the gap, and no audit row either —
 * opening a profile is a READ, and reads are not events. The WRITE gate still
 * distinguishes all three answers and still records them; only this chip does
 * not. Nor does the page wait longer to be sure: the role check still races the
 * avatar fetch under one budget and never retries.
 *
 * IT CARRIES NO WORD OF EXPLANATION, on the owner's standing instruction that
 * nothing may write copy into a page on its own initiative. `ADMIN` is their
 * wording, and there is no tooltip, no hover card and no `sr-only` gloss.
 *
 * THE RED IS THE SAME RED AS THE BAN CHIP — the `danger` token, at the same
 * tenth-opacity fill and thirtieth-opacity ring — rather than a new colour mixed
 * for this chip. One accent, already measured, in both themes: 4.61:1 on its own
 * fill in the light theme and 5.26:1 in the dark.
 */
function AdminChip({ admin }: { admin: boolean }) {
  if (!admin) return null

  return (
    <Badge className="gap-1 border-0 bg-danger/10 text-xs font-semibold uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30">
      <Shield className="size-3" />
      Admin
    </Badge>
  )
}

/**
 * WHAT A NAME'S TIMESTAMP IS, WHICH IS NOT THE SAME QUESTION FOR EVERY NAME.
 *
 * NOT `FormerNameItem`, AND THE DIFFERENCE IS THIS UNION. That type says "a name
 * that was replaced" and its `at` is never absent. This list also holds a name
 * that has NOT been replaced — the Discord display name they are using right now,
 * which is an "other name" for somebody whose page is headed by their in-game
 * name — and that one has a BEGINNING rather than an end.
 *
 * TWO SENTENCE SHAPES IN ONE LIST, DELIBERATELY, and both are the owner's words:
 *
 *   `until`       "known as X until Y"      — a past name, and Y is its end.
 *   `first-seen`  "First seen as X on Y"    — the current display name, and Y is
 *                                             its start.
 *
 * `null` MEANS NO CARD. Not every name has an honest timestamp of either kind,
 * and a name with none renders as plain text rather than borrowing the other
 * sentence or getting an invented one.
 */
type OtherNameWhen =
  | { kind: 'until'; at: number }
  | { kind: 'first-seen'; at: number }
  | null

/** One entry in the "Other names" list. */
type OtherName = {
  /** The name. Never empty. */
  name: string
  /**
   * The instant behind this name, and which end of it that instant is.
   *
   * NONE OF THESE IS THE MOMENT THE PLAYER RENAMED, and nothing in this system
   * knows that moment. They are honest bounds; `OtherNameCard`'s comment works
   * through which is which, and the page states none of it.
   */
  when: OtherNameWhen
  /** Which stream it came from. */
  from: 'game' | 'discord'
}

/**
 * One name, with its own hover card. The owner asked for exactly this: "Each
 * name should have its own hover card which reads 'known as X until Y'".
 *
 * TWO SENTENCES, BOTH THE OWNER'S, ONE COMPONENT. A past name gets their first
 * wording. The current display name has no end, and rather than let it go
 * uncarded they supplied a second: "How about we word it as 'First seen a X on
 * Y' (date)" — read as "First seen as X on Y". Their capitalisation is kept as
 * written; normalising the two to match would be editing their copy.
 *
 * THE CARD IS THOSE WORDS AND NOTHING ELSE. No heading repeating the name, no
 * note about which instant Y is, no explanation of where the name came from —
 * the owner's standing rule is that nothing writes copy into a page on its own
 * initiative, and every one of those sentences would have been mine.
 *
 * WHICH MEANS THE FOOTNOTE Y DESERVES IS IN THIS COMMENT INSTEAD. None of these
 * instants is the moment the player renamed; nothing in this system knows that
 * moment. All three are honest bounds:
 *
 *   until, in-game   `names[].lastSeen` — the last time the GAME reported this
 *                    license under that name. The rename happened somewhere
 *                    between it and the next sighting.
 *   until, Discord   `DiscordNameChange.at` — when RINGMASTER first noticed the
 *                    answer had moved, which is why lib/profile.ts calls the
 *                    field `at` rather than `changedAt`. Discord only ever
 *                    returns the present, so on a player nobody opens this can
 *                    be days late.
 *   first seen       the `at` of the change that ARRIVED at the current display
 *                    name — the same field, the same lateness, read from the
 *                    other side. "First seen" is literally true of it in a way
 *                    "since" would not have been, which is the owner's wording
 *                    doing better than a bare date would.
 *
 * A NAME WITH NO INSTANT NEVER REACHES THIS COMPONENT. See `otherNames`: a
 * display name we have never watched them change INTO has no first sighting to
 * report, and it renders as plain text rather than with a borrowed sentence.
 *
 * THE DOTTED UNDERLINE IS THE AFFORDANCE, not decoration — the same rule the ban
 * chip follows. In a comma-separated list of plain words there would otherwise be
 * nothing at all saying any of them could be pointed at.
 *
 * AND THE SENTENCE IS IN THE DOM TWICE, in one component, so neither copy can be
 * deleted without seeing the other — docs/hover-text.md rule 1. Base UI's popup
 * carries no `role` and no `aria-describedby` and this trigger is an inert
 * `<span>`, so the hover reaches a sighted mouse user and nobody else. The spoken
 * copy uses the UTC instant because it is the unambiguous one, and because
 * `LocalTime` renders an element rather than a string this could reuse.
 */
function OtherNameCard({
  item,
}: {
  item: OtherName & { when: NonNullable<OtherNameWhen> }
}) {
  const { name, when } = item

  // Built once and rendered twice — the popup takes the element, the sr-only
  // copy takes the string. Splitting them is what keeps the two halves of rule 1
  // from drifting into different sentences.
  const words = when.kind === 'until' ? ['known as', 'until'] : ['First seen as', 'on']
  const [lead = '', joiner = ''] = words

  return (
    <HoverCard>
      {/* `render` is not optional: `HoverCardTrigger` renders an `<a>` by
          default, and an anchor with no href in a list of names is both wrong
          markup and a styling surprise. */}
      <HoverCardTrigger
        render={
          <span className="cursor-help whitespace-nowrap underline decoration-dotted decoration-muted-foreground/50 underline-offset-4" />
        }
      >
        {name}
        <span className="sr-only">
          . {lead} {name} {joiner} {utcIso(when.at)}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start">
        {lead} {name} {joiner} <LocalTime ms={when.at} />
      </HoverCardContent>
    </HoverCard>
  )
}

/**
 * WHEN RINGMASTER FIRST SAW THE DISPLAY NAME THEY ARE USING NOW, or null.
 *
 * READ OFF THE ARRIVAL RATHER THAN THE DEPARTURE. `formerNames` is a list of
 * REPLACEMENTS, and each one records both ends: `from` is the name that ended
 * and `to` is the name that started, both at the same instant `at`. Every other
 * entry in this list reads `from`; this one reads `to`. The most recent
 * `globalName` change whose `to` IS the current name is the moment we first saw
 * it — the same field, the same class of timestamp, the same honest lateness.
 *
 * IT MATCHES ON `to`, NOT "the newest change". Taking the newest blindly would
 * date the current name from an event that arrived at a DIFFERENT name — which
 * happens the moment Discord answers with something we have not recorded yet, and
 * would put a confident timestamp under the wrong word.
 *
 * NULL IS COMMON AND IS NOT A FAILURE. A player we have never watched rename has
 * no arrival to point at, and `lib/players` deliberately does not write a change
 * "from nothing" — the first sighting of an account is not a rename. There is
 * nothing else on the record that dates the name specifically: `discord.firstSeen`
 * is when the ACCOUNT was first recorded and `changedAt` moves when the @handle
 * changes too, so neither is this. No card, rather than a plausible wrong one.
 */
function firstSeenAs(
  displayName: string,
  formerDiscord: DiscordNameChange[],
): number | null {
  // `former` is newest-first (lib/players unshifts), so the first match is the
  // most recent arrival at this name — right for somebody who has used a name,
  // left it, and come back to it.
  return formerDiscord.find((c) => c.to === displayName)?.at ?? null
}

/**
 * Every name this person has gone by except the one in the `<h1>`, newest first.
 *
 * THE CURRENT DISPLAY NAME LEADS, because it is the only entry that is still
 * true, and it is dropped when it merely repeats the in-game name at the top of
 * the page — "other" is the whole of the label.
 *
 * DUPLICATES COLLAPSE. Somebody whose Discord display name and in-game name have
 * been the same string appears in both streams, and two identical words in a
 * comma-separated list read as a rendering fault rather than as two sightings.
 * The first occurrence wins, which — given the order below — is the most recent
 * one, so the card on a surviving duplicate carries the later instant.
 */
function otherNames(
  currentGameName: string,
  gameNames: Profile['names'],
  displayName: string | null,
  formerDiscord: DiscordNameChange[],
): OtherName[] {
  // Everything that has ended, newest first, from both streams at once. They
  // interleave: a Discord rename in June sits between two game renames.
  const past: OtherName[] = [
    // `names` is newest first and index 0 is the `<h1>`; the tail is history.
    ...gameNames.slice(1).map((n) => ({
      name: n.name,
      when: { kind: 'until' as const, at: n.lastSeen },
      from: 'game' as const,
    })),
    ...formerDiscord.map((c) => ({
      name: c.from,
      when: { kind: 'until' as const, at: c.at },
      from: 'discord' as const,
    })),
  ].sort((a, b) => b.when.at - a.when.at)

  // The one entry dated from its START. Null when we have never watched them
  // arrive at this name — see `firstSeenAs`, and note `formerDiscord` is already
  // filtered to display-name changes by the caller, so an @handle that happened
  // to pass through the same string cannot date this one.
  const arrived = displayName ? firstSeenAs(displayName, formerDiscord) : null

  const current: OtherName[] =
    displayName && displayName !== currentGameName
      ? [
          {
            name: displayName,
            when: arrived === null ? null : { kind: 'first-seen', at: arrived },
            from: 'discord',
          },
        ]
      : []

  const seen = new Set<string>([currentGameName])
  return [...current, ...past].filter((n) => {
    if (n.name === '' || seen.has(n.name)) return false
    seen.add(n.name)
    return true
  })
}

/**
 * Every identifier we hold for this player, and every name they have gone by.
 *
 * ═══ TWO NAME ROWS BECAME ONE (owner) ═══
 *
 * "let's combine in-game name and display name rows to just say 'other names'
 * with the names listed, separated by commas."
 *
 * WHAT THEY REPLACED. An "In-game name" row — the `<h1>` repeated, with its
 * rename history under it — and a "Display name" row of the same shape, each with
 * its own label, its own hover card and its own `formerly …` list. Between them
 * they used four lines of a panel of one-line rows to say what is now one line,
 * and the split was by SOURCE (which stream did this come from) rather than by
 * the question a moderator is asking, which is "what else has this person been
 * called". A rename in the game and a rename on Discord are the same signal.
 *
 * THE CURRENT IN-GAME NAME IS NOT IN THE LIST, because it is the `<h1>` 200px up
 * the page and "other" is the whole of the label. The current DISPLAY name is,
 * because it is a different name — one the person is using right now, somewhere
 * this page does not otherwise show.
 *
 * WHAT WAS LOST, STATED RATHER THAN GLOSSED. The display-name row used to render
 * absence as absence: "not set" when Discord answered and the account had no
 * display name. A row that is a LIST OF NAMES cannot say that — a name that does
 * not exist is not in the list — so on an account with no display name and no
 * renames the row simply does not appear. The @handle under the `<h1>` still
 * carries the one Discord value that identifies the account, and `?discord=noname`
 * in the preview harness is that case.
 *
 * THE IDENTIFIER ROWS ARE UNTOUCHED. License, Discord snowflake, Steam id — the
 * durable handles this system actually keys on, which is what the panel was for
 * before either name row existed.
 */
function IdentifiersPanel({
  identifiers,
  name,
  names,
}: {
  identifiers: ProfileIdentifier[]
  /** The current in-game name — the `<h1>` at the top of the page. */
  name: string
  /** Every in-game name, newest first. Index 0 is the current one. */
  names: Profile['names']
}) {
  const state = useDiscordChrome()
  const chrome = state.status === 'ready' ? state.chrome : null

  const formerDiscord = (chrome?.formerNames ?? []).filter(
    (c) => c.field === 'globalName',
  )

  const others = otherNames(
    name,
    names,
    chrome?.globalName ?? null,
    formerDiscord,
  )

  /*
   * THE "(LAST KNOWN)" MARKER GOES ON THE ROW, NOT ON A NAME, and only when a
   * Discord-sourced name is actually in it. Ringmaster's record of what the GAME
   * called somebody is unaffected by Discord being down — it never came from
   * Discord — so marking a row of purely in-game names as stale would be a
   * warning about the wrong stream.
   */
  const staleDiscord =
    chrome !== null &&
    !chrome.answered &&
    others.some((n) => n.from === 'discord')

  if (identifiers.length === 0 && others.length === 0) {
    return <Empty />
  }

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

      {/*
        OTHER NAMES — one row, comma separated, one hover card each (owner).

        THE COMMAS ARE PUNCTUATION, NOT LAYOUT, so they sit outside the triggers:
        a comma inside the hover target would underline with the name and read as
        part of it. `Fragment` keyed on the name and its instant, because two
        streams can hold the same string at different times and a bare name is not
        a unique key.
      */}
      {others.length > 0 && (
        <li className="flex items-baseline gap-3 border-t border-border/60 pt-2">
          {/*
            A PLAIN LABEL, NOT AN `IdLabel`. The two rows this replaces each
            carried a hover-card descriptor the owner asked for by name — but
            those described rows that no longer exist, and a merged descriptor
            for this one would be copy nobody asked for. Their standing rule is
            that nothing writes explanatory text into a page on its own
            initiative, so the row says what it is and no more, and the loss is
            reported rather than papered over.
          */}
          <span className={ID_LABEL}>Other names</span>
          <div className="min-w-0 flex-1 text-xs text-foreground/90">
            {others.map((n, i) => (
              <Fragment key={`${n.from}:${n.name}:${n.when?.at ?? 'undated'}`}>
                {i > 0 && <span className="text-muted-foreground">, </span>}
                {/*
                  NO INSTANT, NO CARD. Both of the owner's sentences name a date,
                  and a name we can date neither end of has none to name. The NAME
                  is data and is shown; the sentence would have been invention, so
                  there is none. See `firstSeenAs` for when this happens.
                */}
                {n.when === null ? (
                  <span className="whitespace-nowrap">{n.name}</span>
                ) : (
                  <OtherNameCard item={{ ...n, when: n.when }} />
                )}
              </Fragment>
            ))}
            {staleDiscord && (
              <span className="ml-2 text-muted-foreground">
                <LastKnown />
              </span>
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

function ProfileSkeleton({
  moderationButtons,
  actionsTaken,
}: {
  /**
   * How many buttons the moderation bar will have: 0 (no bar at all), 1 (a ban
   * is in force, so Kick is not drawn) or 2.
   *
   * A COUNT RATHER THAN A BOOLEAN, since the Kick button became conditional. It
   * is knowable here — `banned` comes from the server and owes nothing to
   * Discord — so a skeleton that always drew two would leave an 88px hole in a
   * right-aligned flex group on every banned player's page. See PlayerActions.
   */
  moderationButtons: number
  /** Whether the "Actions taken" panel is already certain to render. */
  actionsTaken: boolean
}) {
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
          {/* Same size, same lift, same ring AND the same stacking as the real
              face — see FACE_LIFT and FACE_STACK. The skeleton's band is a plain
              `Skeleton` rather than a positioned element, so this one happened to
              paint the right way round on DOM order alone; carrying FACE_STACK
              anyway is what stops the two drawings drifting apart the next time
              the band gains a child that needs an anchor. */}
          <div className={cn('shrink-0', FACE_LIFT, FACE_STACK)}>
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
            {/* ONE PRESENCE FIELD, BECAUSE THE REAL HEADER NOW DRAWS EXACTLY
                ONE. It used to draw two here and that was right at the time —
                an offline player got First seen AND Last seen. The pair is now
                complementary (see the ternary in `IdentityCard`), so whichever
                way it resolves it is a single block, and a skeleton still
                drawing two would promise a column that never arrives and drop
                it out of a right-aligned group when Discord answers — the exact
                jump this skeleton exists to prevent.

                NO COUNT PROP FOR IT, unlike `moderationButtons`: that one is
                genuinely 0, 1 or 2, and this one is always 1. */}
            <div className="flex gap-6">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
            {moderationButtons > 0 && (
              <div className="flex gap-2">
                {Array.from({ length: moderationButtons }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-20 rounded-md" />
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Identifiers: three value rows, then ONE name row.

            IT WAS TWO NAME ROWS AND IS NOW ONE, because the real panel's are —
            "In-game name" and "Display name" merged into "Other names" at the
            owner's request. A skeleton still drawing two blocks would have
            promised a row that never arrives and dropped ~58px out from under
            the page at the swap, which is the exact jump this whole arrangement
            exists to prevent.

            AND THE SURVIVING ROW IS SHORTER. The old rows were a name over its
            own "formerly …" list, two lines; the new one is a single comma-
            separated line that wraps to two only on a player with several. One
            bar of ordinary row height is the common case. */}
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
              <Skeleton className="h-4 min-w-0 flex-1" />
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
        {/* Progression: FOUR figures, two rows of two, which is the shape the
            real card took when cosmetics owned moved up beside lifetime xp. It
            was one row of two plus two stacked full-width blocks, and leaving
            that here would drop ~55px out from under the page the moment the
            skeleton cleared.

            THE ONE CASE IT CANNOT MATCH is a lifetime-xp pair too wide for its
            cell, which wraps to a second line — see the grid in the real card.
            That depends on the player's XP and on the viewport, neither of which
            a skeleton knows, so this draws the one-line shape: right for a low
            level anywhere and for everyone above ~1425px, and one line short of
            a high level in a narrow column. The alternative is being one line
            too tall for everybody else. */}
        <SkeletonSection>
          <SkeletonFigures n={4} className="grid grid-cols-2 gap-4" />
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

      {/*
        ACTIONS TAKEN, AND HALF OF ITS CONDITION IS KNOWABLE HERE.

        The panel renders when the player has taken an action OR holds the Discord
        admin role. The FIRST half comes from the audit log, which the server
        already read before this skeleton was drawn — so `actionsTaken` is passed
        in and the common case (an admin with a history) is drawn to the right
        height. The second half arrives with the very chunk this skeleton is
        waiting for and cannot be known.

        SO ONE CASE STILL JUMPS: an admin who holds the role and has never used
        it grows an empty panel at the swap. That is the smallest of the panels,
        it is below the fold, and the alternative — always drawing it — would take
        a whole card out from under EVERY non-admin profile in the console, which
        is almost all of them. Same trade `SkeletonFigures` makes about the
        lifetime-xp pair: be right for the common case and say which one is not.
      */}
      {actionsTaken && (
        <SkeletonSection>
          <SkeletonRows n={PROFILE_PER_PAGE} width="w-1/2" />
          <SkeletonPager />
        </SkeletonSection>
      )}

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
  verdictLabel = {},
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
   * facts and constructing the element here keeps it client-to-client, and keeps
   * the console quiet enough that a real warning is still worth reading.
   *
   * IT CARRIED THE `Ban` ROW AND NO LONGER DOES. The only thing `PlayerActions`
   * ever did with it was re-derive "is this ban in force" — a second copy of
   * `bans.isActive`, standing beside the `banned` prop above, which IS that rule
   * already evaluated on the server. The row is gone from both and `banned` is
   * handed down instead, so the chip beside the player's name and the buttons in
   * the same bar cannot disagree about the same ban. See PlayerActions.
   *
   * Omitted entirely by callers that must not offer the buttons at all.
   */
  moderation?: {
    /** On the server right now — decides whether a kick is even possible. */
    online: boolean
    canBan: boolean
  }
  /** Report categories in English. From `lib/incidents`, which is server-only. */
  categoryLabel?: Record<string, string>
  /** Verdicts in English. Same arrangement, same reason (#28). */
  verdictLabel?: Record<string, string>
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

  /**
   * ON THE SERVER RIGHT NOW — ONE SPELLING OF IT, FOR THE WHOLE COMPONENT.
   *
   * There are two ways to ask this question in this file's inputs and they are
   * the SAME FACT from the same variable: `p.live` is the presence snapshot, and
   * `moderation.online` is `live !== null` computed at the call site — see
   * `players/[license]/page.tsx`, which derives both from one `live`, and the
   * preview harness, which says so out loud ("the ONLINE NOW chip and the kick
   * button both read the same fact, so they move together").
   *
   * `p.live` IS THE ONE TO READ, and not by preference. `moderation` is optional
   * — omitted entirely by callers that must not offer the buttons — so a header
   * field gated on `moderation.online` would blink out for a viewer who merely
   * cannot moderate, which is a permission deciding a biographical fact. `p.live`
   * is always there, and it is already what the ONLINE NOW chip below reads.
   *
   * WHICH LEAVES `moderation.online` READ IN EXACTLY ONE PLACE — the prop handed
   * to `PlayerActions`, whose own contract it is. It is not a rival reading and
   * cannot disagree; a field passed by both call sites and read by neither would
   * be the worse outcome. If that prop ever loses `online`, this const is what
   * the kick button should be given.
   */
  const online = p.live !== null

  const kd = p.stats && p.stats.deaths > 0
    ? (p.stats.kills / p.stats.deaths).toFixed(2)
    : '—'

  // #22 item 6 — see NOT_AN_ACTION. Kicks and bans lists what was DONE to this
  // player; a decision about a report is not one of those things.
  const moderationActions = p.actions.filter((a) => !NOT_AN_ACTION.has(a.action))

  if (chromeState.status === 'loading') {
    return (
      <ProfileSkeleton
        // THE SAME CONDITION `PlayerActions` DRAWS FROM, kept in step by hand
        // because the skeleton cannot ask the component that has not rendered.
        //
        // Ban-or-lift is always there, so the count is one plus kick, and kick
        // needs BOTH a player who is not banned and one who is connected —
        // `kick.shown` over there is `!banned && online`. Neither input waits on
        // Discord: `banned` is the server's `bans.isActive`, and `online` is the
        // presence snapshot (see its own comment above). So the skeleton draws
        // the number that is about to appear rather than always two, and an
        // offline or banned player's bar no longer jumps from two buttons to one
        // when Discord answers.
        moderationButtons={moderation === undefined ? 0 : !banned && online ? 2 : 1}
        actionsTaken={p.actionsTaken.length > 0}
      />
    )
  }

  /*
   * ADMIN STATUS, WHICH ONLY EXISTS WHEN THERE IS A DISCORD ACCOUNT TO ASK ABOUT.
   *
   * `absent` — no Discord id on the registry row — is FALSE, and that one is a
   * real answer rather than a shrug: the owner's test for admin is holding a role
   * in the Discord server, and somebody with no Discord account cannot hold one.
   * Nothing was asked because there was nothing to ask. The other falses are less
   * confident and indistinguishable from it; see AdminChip.
   */
  const admin = chromeState.status === 'ready' && chromeState.chrome.admin

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
              {banned && <BannedChip ban={p.ban} now={now} />}
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
              {/* "a chip should appear next to their online/offline chip that
                  says 'ADMIN' in red" — the owner, and this is that chip, in
                  that position. See AdminChip for what "admin" is tested
                  against and for what its absence does and does not mean. */}
              <AdminChip admin={admin} />
              {/*
                THE "1 BAN" CHIP IS GONE, and it was worse than a redundant
                count. The owner: "remove where it says 'x bans' at the top of
                the player profile page, unless they're actively banned it
                should just say 'banned'."

                WHAT IT WAS COUNTING WAS NOT A HISTORY. `p.ban` is the bans
                table's single row for this license — the table is keyed on
                license and a second ban overwrites the first — so the number
                could never be anything but 1, and it appeared for a row that
                was LIFTED or SERVED just as readily as for one in force. A
                player in good standing carried a red chip reading like a rap
                sheet, next to no "banned" chip at all, which is the page
                telling a moderator someone is banned when they are not.

                NOTHING IS LOST WITH IT. Every ban and every lift is a row in
                Kicks and bans below, from the append-only audit log, with the
                reason, the admin and the time — checked, not assumed: the
                `ban.issue` and `ban.lift` rows are in this page's fixture and
                render there. That panel is the history; the chip above is the
                present tense, and only that.
              */}
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
            {/*
                ═══ ONE PRESENCE FIELD, AND WHICH ONE IS DECIDED BY WHETHER THEY
                    ARE HERE ═══

                LAST SEEN IS MEANINGLESS WHILE THEY ARE HERE. "2 minutes ago"
                next to "Online now" is either confusing or wrong, and the badge
                already answers the question better.

                AND FIRST SEEN IS THE HALF THE OWNER ASKED FOR NEXT: "when the
                player is disconnected, please do not show the 'first seen'
                timestamp or text". On a disconnected player the live question is
                when they were last here; when they first arrived is background,
                and printing both makes the reader pick.

                SO IT IS A TERNARY AND NOT TWO CONDITIONS. The two fields answer
                one question — "when does this person's presence matter" — and
                they are exactly complementary: online shows First seen, offline
                shows Last seen, never both and never neither. Written as two
                independent gates the pair could drift into showing two fields or
                none, and the reason each is hidden would live in a different
                place from the reason the other is shown.

                THE CLUSTER CANNOT GAIN A HOLE, which is the layout half of this.
                `gap-6` only paints BETWEEN children, so a single child leaves no
                trailing space and the moderation buttons keep their position in
                the right-aligned group. Nothing is rendered in the hidden
                field's place — no dash, no caption.
            */}
            <div className="flex gap-6 text-right">
              {online ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    First seen
                  </div>
                  <div className="mt-1 text-sm"><LocalTime ms={p.firstSeen} /></div>
                </div>
              ) : (
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
                // THE SAME BOOLEAN THE CHIP ABOVE READS. Not a second reading of
                // `p.ban` — see the `moderation` prop.
                banned={banned}
                // `moderation.online` and the `online` const above are the SAME
                // FACT — see that comment. This site keeps reading the prop so
                // the field is not left passed-but-unread by both call sites,
                // which is its own defect. The header pair cannot do the same,
                // because it must still render when `moderation` is absent.
                online={moderation.online}
                canBan={moderation.canBan}
              />
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Identifiers" provenance={<ProvenanceTag kind="identity" />}>
          {/* The stored identifiers, what Discord calls this account, and what
              the GAME has called it — see IdentifiersPanel for why the display
              name belongs here, why the @handle does not, and why the in-game
              rename history moved out of the Sessions panel. */}
          <IdentifiersPanel
            identifiers={p.identifiers}
            name={p.name}
            names={p.names}
          />
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
                TWO ROWS OF TWO — level / volts, then lifetime xp / cosmetics
                owned. The owner: "the cosmetics owned should be next to lifetime
                xp and below volts, not on it's own row."

                THAT TAKES BACK THE WIDTH #22 ITEM 11 WAS PAID IN, WHICH IS THE
                WHOLE TRAP HERE. "xp this level" truncated to "2,707 / 2,8…" in a
                narrow cell; the fix both times was to widen the cell, and this
                layout narrows it again by exactly one column. So it was measured
                rather than assumed, in /preview/profile?xp=widest, against the
                widest string the curve can produce — "991,549 / 991,550", 17
                monospace characters at text-xl, 229.5px — with the sidebar
                expanded, which is its default:

                  viewport   cell    one line?
                  375        138px   no
                  768        183px   no
                  1024       138px   no   (lg halves the card — the narrowest of all)
                  1280       202px   no
                  1440       242px   yes

                It fits on one line only from about 1425px up. THE NUMBER IS NOT
                THE THING THAT GIVES WAY: this figure alone opts out of `truncate`
                (see `Figure`'s `wrap`) and takes a second line where the width
                demands one, so both halves of the pair survive at every width
                tested. Nothing is ever clipped — `scrollWidth === clientWidth` at
                all five.

                WHAT WAS REJECTED, MEASURED RATHER THAN GUESSED. A smaller numeral
                for this one figure would need ~13.5px type at 138px, which is
                smaller than its own label. An abbreviated form ("992k / 992k")
                still needs ~148px, still does not fit at 375 or 1024, and stops
                being the number. Keeping the span was the layout the owner asked
                to change.
              */}
              <div className="grid grid-cols-2 gap-4">
                <Figure icon={Trophy} value={p.progress.level} label="level" />
                <Figure
                  icon={Clock}
                  value={formatCount(p.progress.balance)}
                  label="volts"
                />
                {/*
                  THE LIFETIME TOTAL AGAINST THE NEXT THRESHOLD, which is what
                  the levels are actually made of.

                  THIS USED TO BE `into / span` — where the player sits inside
                  the current level, counted from zero again on every level-up.
                  That reads as a lifetime figure and is not one, and it is how
                  the owner came to be looking at a level 8 chip beside "1,846 /
                  3,750" and concluded the XP was resetting (2026-08-17). It was
                  not: level 8 begins at 16,350 and costs 3,750, so that player
                  holds 16,350 + 1,846 = 18,196 and reaches level 9 at 20,100.
                  Both numbers on screen were true; neither was the one being
                  asked for, and the label could not save a pair that needs the
                  level chip beside it to mean anything.

                  So the figure is now the pair that stands on its own. The BAR
                  keeps the per-level geometry — `progress().into/span` — because
                  a bar drawn from the cumulative pair would sit 90% full at
                  level 8 and 99% full at level 50; a bar's zero is the level's
                  floor. `check-xp-curve.mjs` asserts the two are the same fact.

                  MAX LEVEL HAS NO NEXT THRESHOLD, and this used to render it as
                  "0 / 0" — into and span are both zero up there. `nextThreshold
                  For` returns 0 to say there is no next level, and it is spelt
                  out rather than drawn as a division by nothing.

                  THE SPACE AFTER THE SLASH IS NON-BREAKING, AND THAT IS THE
                  WHOLE OF THE LINE BREAK. Now that this figure wraps rather than
                  truncates (see the grid comment above), WHERE it breaks is a
                  choice, and there is only one break in the string. Left alone
                  it splits after the slash —

                      991,549 /
                      991,550

                  — which orphans an operator at the end of a line and reads as
                  if the number were unfinished. Tying the slash to the threshold
                  moves the break in front of it:

                      991,549
                      / 991,550

                  where the second line still says "out of" and the first is a
                  whole number on its own. It costs nothing when the pair fits on
                  one line, which is what it does above ~1425px: U+00A0 renders as
                  an ordinary space.
                */}
                <Figure
                  icon={Swords}
                  wrap
                  value={
                    nextThresholdFor(p.progress.xp) > 0
                      ? `${formatCount(p.progress.xp)} /\u00A0${formatCount(
                          nextThresholdFor(p.progress.xp),
                        )}`
                      : `${formatCount(p.progress.xp)} /\u00A0max`
                  }
                  label="lifetime xp"
                />
                {/*
                  A FIGURE, NOT A SENTENCE UNDER THE GRID — the owner: "on the
                  progression table we make cosmetics owned its own large
                  number."

                  It was already only a count (#22 item 10: "we don't need to
                  know what cosmetics they own, just 'x cosmetics owned' is
                  enough"), but it was a count folded into grey prose below the
                  table, which reads as a footnote about the panel rather than as
                  one of its numbers. Nothing about the value changed; only what
                  it is drawn as.

                  IT SITS BESIDE LIFETIME XP NOW, WHICH IS WHERE THE WIDTH WENT.
                  It used to span the row, on the reasoning that promoting a
                  value into this grid had truncated a neighbour once already and
                  this one should take width from nobody. The owner has since
                  asked for the pairing — "next to lifetime xp and below volts,
                  not on it's own row" — so the width did come out of the xp
                  cell, and the grid comment above is the measurement of what
                  that cost and what now gives way instead. This figure is a
                  single count of at most three digits (13.5px), so it is not the
                  one at risk in either layout.

                  ZERO IS A NUMBER HERE. The prose said "No cosmetics owned."; a
                  figure says 0, which is the same fact in the shape the rest of
                  the panel uses, and one fewer sentence to keep in step with a
                  count.
                */}
                <Figure
                  icon={Shirt}
                  value={formatCount(p.progress.owned)}
                  label="cosmetics owned"
                />
              </div>
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
            // "ALSO KNOWN AS" USED TO BE UNDER THIS GRID and is gone from here
            // entirely (owner, item 4): "what's the 'also known as' doing in the
            // sessions box? There's no hover card for me to know what that
            // information is or means." It was a heading over a list of bare
            // strings beside a session count — a history of a NAME filed under
            // how long somebody has been connected. It is now a row under the
            // in-game name in Identifiers, with the explanation on its label.
            // See IdentifiersPanel. This panel is two numbers about connecting,
            // and now only that.
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
        verdictLabel={verdictLabel}
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
                        {a.outcome === 'failed' && <DidNotHappen />}
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
        ACTIONS TAKEN — the other direction through the audit log, and it comes
        after Kicks and bans because that is the order the questions arrive in:
        what was done to this person first, then what they did to other people.
        See ActionsTakenPanel for the one-row-per-act rule and for why the panel
        is absent on almost every profile.
      */}
      {(p.actionsTaken.length > 0 || admin) && (
        <ActionsTakenPanel
          rows={p.actionsTaken}
          now={now}
          verdictLabel={verdictLabel}
        />
      )}

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
