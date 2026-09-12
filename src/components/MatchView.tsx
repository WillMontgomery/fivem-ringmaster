'use client'

import { Crosshair, Trophy, Users } from 'lucide-react'
import Link from 'next/link'

import { LocalTime } from '@/components/LocalTime'
import { squadColour, squadIndex } from '@/components/MatchCard'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { humanDuration } from '@/lib/duration'
import { labelFor } from '@/lib/labels'
import { bySquad, mostKills, type MatchLedger, type MatchParticipant } from '@/lib/matchLedger'
import { profileHref } from '@/lib/profileLink'
import { formatCount } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * One match (#51).
 *
 * ═══ EVERY SECTION IS SOMETHING THE OWNER ASKED FOR, BY NAME ═══
 *
 * "we should make a new match page in Ringmaster which shows all participants,
 * grouped by squads (when in squads), the match type (solo/squad), the match ID,
 * the start and end timestamp, who won, volts awarded to each player during the
 * match, volts spent by each player during the match, and any other helpful info
 * about the match like who got the most kills, etc."
 *
 * THAT LIST IS THE WHOLE SPEC AND NOTHING HAS BEEN ADDED TO IT. #51 closes with
 * "'any other helpful info' is the owner's phrase, not a spec. Most kills is
 * named. Anything else should be put to him rather than invented, and no label on
 * the page should be copy he did not write." So: most kills is here, and the
 * other figures on the participant rows (kills, damage, downs, revives, time
 * alive) are the columns the profile's match table and `IncidentMatchRecord`
 * already draw, under the labels those already use. Nothing on this page is a
 * sentence.
 *
 * ═══ A COMPONENT OVER A LEDGER, WHICH NEVER FETCHES ═══
 *
 * The same shape as `LiveBoard` and for the same reason: the identical tree
 * renders from a real DynamoDB read and from a fixture, so the whole surface —
 * including the three states where data is MISSING — is reviewable without a
 * played match and without AWS credentials. See `app/preview/match/page.tsx`.
 *
 * ═══ WHAT AN ABSENCE LOOKS LIKE, AND WHY IT IS NEVER A ZERO ═══
 *
 * None of #293's three fields backfills, and the owner does not hand-edit
 * DynamoDB, so every match played before `03cce2d` has no spend, no squad
 * grouping and no start time — permanently. #51: "The page must not render a
 * missing value as a real one; a zero is a claim."
 *
 * So the house em dash carries all of it — the same glyph `LocalTime` renders for
 * an instant it cannot show and `IncidentMatchRecord` for a match with no row —
 * and there is no prose beside it. An absent start time is an em dash where the
 * time would be. An absent spend is an em dash in that cell, on every row, and
 * the COLUMN STAYS: dropping it would make the page's shape depend on the
 * match's age, so a reader comparing two matches would see two different tables
 * and have to work out why.
 *
 * AND THE SQUAD GROUPING IS THE ONE ABSENCE THAT CANNOT BE AN EM DASH, because
 * it is a shape rather than a value. A squad match whose rows predate #293 is
 * drawn as a flat list with NO squad headers at all — the page declines to group
 * rather than drawing one group that would read as "everybody played alone".
 * `squadsRecorded` on the ledger is that distinction and `mode` beside the title
 * still says Squad, so the two together are readable. This is a gap the data
 * cannot close and it is stated in the handover rather than papered over here.
 */
export function MatchView({ ledger }: { ledger: MatchLedger }) {
  const groups = bySquad(ledger.participants)
  const top = mostKills(ledger.participants)
  const winners = ledger.participants.filter((p) => p.won)

  /**
   * GROUPED ONLY WHEN THE GROUPING IS REAL. See the header: a flat list is the
   * honest rendering of a squad match whose rows never carried a squad, and
   * `bySquad` would otherwise hand back one null-keyed group that the markup
   * below would label "No squad".
   */
  const grouped = ledger.squadsRecorded

  return (
    <div className="space-y-4">
      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/60 px-4 py-3">
          {/*
            THE ID IS THE HEADING, and it is the same five characters the game
            server printed into its own console. That is the entire point of
            #291's console half: "Ringmaster and the game logs should convert
            together, or moderation reads two numbers for one match."
          */}
          <span className="font-mono text-sm text-muted-foreground">
            match {ledger.tag}
          </span>

          {labelFor(MODE_LABEL, ledger.mode) && (
            <Badge className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
              {labelFor(MODE_LABEL, ledger.mode)}
            </Badge>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <Pair label="started">
              {/*
                THE EM DASH IS THE WHOLE POINT HERE. `startedAt` is null both for
                a pre-#293 row and for a match that dissolved on the warmup pad
                without starting — `persist.lua` stores the second as 0 and says
                0 is "the one value every reader already has to treat as not
                recorded". Substituting `endedAt` would file a zero-length match
                that never happened.
              */}
              {ledger.startedAt === null ? (
                <span className="text-muted-foreground/70">—</span>
              ) : (
                <LocalTime ms={ledger.startedAt} />
              )}
            </Pair>
            <Pair label="ended">
              <LocalTime ms={ledger.endedAt} />
            </Pair>
            <Pair label="players">
              {/*
                THE FIELD SIZE THE GAME COUNTED, falling back to the rows found.
                `total` is 0 on a row that never carried one, and a page that
                said "0 players" above a list of eight would be wrong in the one
                place a reader would not check.
              */}
              <span className="font-mono tabular-nums">
                {ledger.total > 0 ? ledger.total : ledger.participants.length}
              </span>
            </Pair>
          </div>
        </header>

        <div className="flex flex-wrap gap-x-8 gap-y-4 px-4 py-3">
          {/*
            WHO WON — the owner asked for it by name. `won` is stored by the game
            precisely because it is NOT `placement === 1`: the storm can take the
            last squad standing, so they place first and the match has no winner.
            An empty winner list is therefore a real outcome and gets the em dash
            rather than being filled in from placement.
          */}
          <Figure icon={Trophy} label="won">
            {winners.length === 0 ? (
              <span className="text-muted-foreground/70">—</span>
            ) : (
              <NameList people={winners} className="text-warn" />
            )}
          </Figure>

          {/*
            MOST KILLS — the one item named inside "any other helpful info".
            Empty when the top score is zero: a match where nobody got a kill has
            no most-kills, and naming somebody the leader of nothing is a claim
            about them.
          */}
          <Figure icon={Crosshair} label="most kills">
            {top.length === 0 ? (
              <span className="text-muted-foreground/70">—</span>
            ) : (
              <span className="inline-flex items-baseline gap-1.5">
                <NameList people={top} />
                <span className="font-mono text-sm text-muted-foreground tabular-nums">
                  {top[0]!.kills}
                </span>
              </span>
            )}
          </Figure>
        </div>
      </Card>

      <Card className="surface-edge gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="text-xs uppercase tracking-wider">
                Placed
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider">
                Player
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Kills
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Damage
              </TableHead>
              {/*
                DOWNS AND REVIVES ARE ABSENT IN A SOLO, and not because they
                happen to be zero. `IncidentMatchRecord` states the rule and the
                gamemode declares it: BR.Mode.SOLO carries `dbno = false`, so
                nobody can be knocked and nobody can be revived. Both figures are
                structurally impossible there rather than merely empty.

                ONLY ON AN EXPLICIT 'solo'. An unreadable mode is not a claim
                that there were no squadmates.
              */}
              {ledger.mode !== 'solo' && (
                <>
                  <TableHead className="text-right text-xs uppercase tracking-wider">
                    Downs
                  </TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">
                    Revives
                  </TableHead>
                </>
              )}
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Alive
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Volts earned
              </TableHead>
              <TableHead className="text-right text-xs uppercase tracking-wider">
                Volts spent
              </TableHead>
            </TableRow>
          </TableHeader>

          {grouped ? (
            groups.map(([squadId, members]) => {
              const colour = squadColour(squadId)
              return (
                <TableBody key={squadId ?? 'none'}>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <td
                      colSpan={COLUMNS(ledger.mode)}
                      className="relative bg-background/40 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {/* The squad's colour as a spine down the left edge —
                          the same device the live board's cards use, so a squad
                          keeps its identity between the two pages. */}
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px]"
                        style={{ background: colour }}
                      />
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="size-3" style={{ color: colour }} />
                        <span style={{ color: colour }}>
                          {squadId === null
                            ? 'No squad'
                            : `Squad ${squadIndex(squadId) ?? squadId}`}
                        </span>
                      </span>
                    </td>
                  </TableRow>
                  {members.map((p) => (
                    <ParticipantRow
                      key={p.license}
                      p={p}
                      mode={ledger.mode}
                      spendRecorded={ledger.spendRecorded}
                      accent={colour}
                    />
                  ))}
                </TableBody>
              )
            })
          ) : (
            <TableBody>
              {ledger.participants.map((p) => (
                <ParticipantRow
                  key={p.license}
                  p={p}
                  mode={ledger.mode}
                  spendRecorded={ledger.spendRecorded}
                  accent={null}
                />
              ))}
            </TableBody>
          )}
        </Table>
      </Card>
    </div>
  )
}

/**
 * How many columns the group header spans.
 *
 * DERIVED FROM THE SAME CONDITION THE HEADER CELLS ARE, so the two cannot drift.
 * A hardcoded `colSpan` was how the live board's group header ended up one cell
 * short of its table.
 */
const COLUMNS = (mode: string) => (mode !== 'solo' ? 9 : 7)

/** 'solo' | 'squad', as the game spells it. Anything else is humanised. */
const MODE_LABEL: Record<string, string> = {
  solo: 'Solo',
  squad: 'Squad',
}

function ParticipantRow({
  p,
  mode,
  spendRecorded,
  accent,
}: {
  p: MatchParticipant
  mode: string
  spendRecorded: boolean
  accent: string | null
}) {
  return (
    <TableRow className="border-border/60">
      <TableCell className="relative">
        {accent !== null && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ background: accent }}
          />
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono text-xs font-semibold',
            p.won ? 'text-warn' : 'text-muted-foreground',
          )}
        >
          {p.won && <Trophy className="size-3" />}
          {p.placement > 0 ? `#${p.placement}` : '—'}
        </span>
      </TableCell>

      <TableCell>
        {/*
          THE PARTICIPANT LINKS TO THEIR PROFILE, which is the direction this
          console already goes everywhere else. `profileHref` rather than a hand
          built path so the one spelling stays in one place.

          THE LICENSE IS THE FALLBACK, NOT A PLACEHOLDER NAME. The history rows
          carry no name (`persist.lua`), so these come from this console's own
          registry, and a player who predates the snapshot feed has no registry
          row. Showing the license is honest; showing "Unknown" would be this
          page inventing a person.
        */}
        <Link
          href={profileHref(p.license)}
          className="font-medium underline-offset-4 hover:underline"
        >
          {p.name ?? p.license}
        </Link>
      </TableCell>

      <TableCell className="text-right font-mono text-sm tabular-nums">
        {p.kills}
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">
        {formatCount(p.damage)}
      </TableCell>
      {mode !== 'solo' && (
        <>
          <TableCell className="text-right font-mono text-sm tabular-nums">
            {p.downs}
          </TableCell>
          <TableCell className="text-right font-mono text-sm tabular-nums">
            {p.revives}
          </TableCell>
        </>
      )}
      <TableCell className="text-right font-mono text-sm text-muted-foreground tabular-nums">
        {humanDuration(p.survivedMs)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">
        {formatCount(p.voltsEarned)}
      </TableCell>
      {/*
        THE ONE CELL THAT IS ALLOWED TO BE AN EM DASH ON A ROW FULL OF NUMBERS.
        `voltsSpent` is null only when the attribute is ABSENT — a row written
        before #293. A player who genuinely spent nothing has a real 0 and it is
        shown as 0, because that is a fact about them. `spendRecorded` is carried
        in so a future reading of "what does null mean here" has the match-level
        answer beside the row-level one.
      */}
      <TableCell
        className={cn(
          'text-right font-mono text-sm tabular-nums',
          p.voltsSpent === null && 'text-muted-foreground/70',
        )}
      >
        {p.voltsSpent === null || !spendRecorded ? '—' : formatCount(p.voltsSpent)}
      </TableCell>
    </TableRow>
  )
}

/** A label with a value beside it, for the header strip. */
function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </span>
  )
}

/**
 * A small label over a value.
 *
 * THE SAME SHAPE AS `IncidentMatchRecord`'s `Figure` AND NOT AN IMPORT OF IT,
 * for the reason that one already states about `ProfileView`'s: it is local to a
 * file with different needs, and lifting it into a shared component is a bigger
 * change than this one. The debt is small, stated, and one line of markup wide.
 */
function Figure({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}

/**
 * One or more people, each linking to their own profile.
 *
 * A LIST BECAUSE A TIE IS ORDINARY. Most matches finish with several players on
 * the same low kill count, and a squad wins together — so both callers here
 * genuinely have more than one, and picking the first would be the page choosing
 * a winner the game did not.
 */
function NameList({
  people,
  className,
}: {
  people: readonly MatchParticipant[]
  className?: string
}) {
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      {people.map((p, i) => (
        <span key={p.license}>
          <Link
            href={profileHref(p.license)}
            className="font-medium underline-offset-4 hover:underline"
          >
            {p.name ?? p.license}
          </Link>
          {i < people.length - 1 && <span className="text-muted-foreground">,</span>}
        </span>
      ))}
    </span>
  )
}
