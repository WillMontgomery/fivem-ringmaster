'use client'

import { Clock, Crosshair, Flame, Skull, Trophy } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { humanDuration } from '@/lib/duration'
import { labelFor } from '@/lib/labels'
import type { ProfileMatch } from '@/lib/profile'
import { formatCount } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * What the subject actually did in the match this incident was filed during.
 *
 * ═══ THE OWNER ASKED FOR THIS, AND FOR ONE THING THAT IS NOT HERE ═══
 *
 * "In the incident there should also be a section about what they did that match
 * - like how many kills they got, what position they got, how much loot they got,
 * etc."
 *
 * LOOT IS NOT ON THE PAGE BECAUSE NOTHING RECORDS IT. The per-match row the game
 * writes (`br-players`, sort key `match#…`) carries placement, field size, kills,
 * downs, revives, damage, time alive, XP and volts — and nothing about what was
 * picked up, carried or spent. Neither does the incident row. There is no field
 * to read, no aggregate to derive it from, and an empty "Loot" figure would be
 * this console claiming to know a number it does not have. What it would take is
 * a game-side change: the match-end write would need a loot total per player,
 * which means the gamemode counting pickups per match and putting the figure in
 * the same payload as `kills` and `damage`. Until then this section says nothing
 * about it rather than approximating it from volts, which are an award and not a
 * count of anything picked up.
 *
 * ═══ THE PANEL IS DRAWN WHENEVER A MATCH WAS RECORDED, EVEN WITH NO ROW ═══
 *
 * An absent row is ORDINARY and it is not "they did nothing". Three ways it
 * happens, all normal:
 *
 *   · the match is still running — these rows are written when a match ENDS
 *   · the history read is bounded, so a case older than the subject's last N
 *     matches is past the end of it
 *   · the read failed, which is not a statement about the player either
 *
 * So the body is the console's own em dash and no words, exactly as
 * `IncidentArtifacts` does for a case with no frames. A "0 kills, no placement"
 * rendering would be the one thing that must not happen here: it is a claim
 * about the player, and it is a claim nobody made.
 *
 * AND THE PANEL IS ABSENT ENTIRELY when the incident names no match at all —
 * a report filed in the lobby, or any of the thousands filed before the game
 * started recording this. There is no match to have a record of, which is a
 * different thing from a match whose record we could not find. `IncidentDetail`
 * makes that call; this component is only ever handed the second case.
 *
 * NOTHING HERE JOINS ANYTHING. `matchRecordFor` in `lib/matchTimeline` picks the
 * row and `check:timeline` pins it, because the match number is not unique
 * across server restarts and matching on it alone puts one afternoon's kills on
 * another afternoon's case.
 */
export function IncidentMatchRecord({ record }: { record: ProfileMatch | null }) {
  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5 text-sm">
        Match record
        {/*
          MODE IS A CHIP RATHER THAN A FIGURE because it is not a number, and
          `labelFor` rather than a lookup so a mode this build has never heard of
          arrives humanised instead of blank — the same treatment the profile's
          match table gives it.
        */}
        {record && labelFor(MODE_LABEL, record.mode) && (
          <Badge className="border-0 bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground ring-1 ring-inset ring-border">
            {labelFor(MODE_LABEL, record.mode)}
          </Badge>
        )}
      </header>

      <div className="p-4">
        {record ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {/*
              PLACED AND FIELD ARE ONE FIGURE, not two, because neither half
              means anything alone: third of eight and third of ninety-six are
              different results, and the profile's match table already keeps them
              adjacent for that reason.

              WINNING AND PLACING FIRST ARE DIFFERENT. The storm can take the
              last squad standing — they place first because nobody outlasted
              them, and the match has no winner. `won` is stored by the game for
              exactly this, so the trophy is on `won` and never on `placement
              === 1`.
            */}
            <Figure
              icon={Trophy}
              label="placed"
              value={
                <span className={record.won ? 'text-warn' : undefined}>
                  {record.placement > 0 ? `#${record.placement}` : '—'}
                  {record.total > 0 && (
                    <span className="text-base text-muted-foreground/70">
                      {' '}
                      of {record.total}
                    </span>
                  )}
                </span>
              }
            />
            <Figure icon={Crosshair} label="kills" value={record.kills} />
            <Figure
              icon={Flame}
              label="damage"
              value={formatCount(record.damage)}
            />
            {/*
              NOT IN A SOLO, AND NOT BECAUSE THEY HAPPEN TO BE ZERO.

              The gamemode declares it: BR.Mode.SOLO carries `dbno = false`
              alongside `squadSize = 1`, and combat.lua puts it in a sentence --
              "knock a squad player down and all kill a solo". Nobody can be
              knocked in a solo, so nobody can be revived either. Both figures
              are structurally impossible rather than merely empty, and a zero
              beside four real numbers reads as a fact about the player.

              ONLY ON AN EXPLICIT 'solo'. `mode` is coerced to '' when the row
              carries something unreadable (lib/gameProfile.ts), and an unknown
              mode is not a claim that there were no squadmates -- hiding a real
              five-down record would be the worse mistake of the two.
            */}
            {record.mode !== 'solo' && (
              <>
                <Figure icon={Skull} label="downs" value={record.downs} />
                <Figure icon={Trophy} label="revives" value={record.revives} />
              </>
            )}
            {/*
              TIME ALIVE, NOT MATCH LENGTH. Every player in one match shares its
              duration; how long this one survived is the half that is about
              them.
            */}
            <Figure
              icon={Clock}
              label="alive"
              value={humanDuration(record.survivedMs)}
            />
          </div>
        ) : (
          /*
            THE HOUSE GLYPH FOR A VALUE WE DO NOT HAVE, and not a word beside it.
            `LocalTime` renders exactly this for an instant it cannot show and
            `IncidentArtifacts` for a case with no frames. Any sentence here
            would be helper text (docs/hover-text.md rule 8) and — worse — the
            console volunteering an interpretation of an absence that has three
            unrelated causes, none of them about the player.
          */
          <p className="py-6 text-center text-sm text-muted-foreground/70">—</p>
        )}
      </div>
    </Card>
  )
}

/** 'solo' | 'squad', as the game spells it. Anything else is humanised. */
const MODE_LABEL: Record<string, string> = {
  solo: 'Solo',
  squad: 'Squad',
}

/**
 * A small label over a large number.
 *
 * DELIBERATELY THE SAME SHAPE AS `ProfileView`'s `Figure` AND NOT AN IMPORT OF
 * IT. That one is local to a 3,000-line file, takes a `wrap` prop for one call
 * site there and reads the Discord accent through context this page has none of.
 * Lifting it into a shared component is a bigger change than this one and would
 * put a refactor of the profile page inside a playtest fix. The debt is small,
 * stated, and one line of markup wide.
 *
 * `value` IS A NODE RATHER THAN A STRING here, which is the one real difference:
 * "placed" is two numbers with different weights in one cell.
 */
function Figure({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  value: React.ReactNode
  label: string
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
