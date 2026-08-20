import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Server population, as one object rather than four cards.
 *
 * WHY THIS REPLACED A ROW OF STAT TILES. Four boxes each holding an icon, a
 * label and a big number is the default shape every dashboard reaches for, and
 * it has two real problems beyond looking generic. It spends the widest,
 * highest part of the page on four numbers that a single line of text would
 * carry — and it presents them as four unrelated facts when they are in fact
 * one number cut three ways: everybody on the server is either in a match or
 * in the lobby, against a known capacity.
 *
 * A segmented bar says that. It also answers the question the numbers cannot —
 * "how full is the server" — without any arithmetic, and it degrades usefully:
 * at 4 of 48 it reads nearly empty, which is the truth, where "4" alone reads
 * as fine.
 */

function Figure({
  value,
  label,
  colour,
  className,
}: {
  value: number
  label: string
  colour?: string
  className?: string
}) {
  return (
    <div className={cn('leading-none', className)}>
      <div className="font-mono text-2xl tabular-nums" style={{ color: colour }}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

export function ServerStrip({
  connected,
  inMatch,
  lobby,
  matches,
}: {
  connected: number
  inMatch: number
  lobby: number
  /**
   * How many matches are running, and nothing else about them.
   *
   * IT WAS THE ROWS THEMSELVES until the phase pips were removed, because the
   * pips needed a state and an id per match. Nothing here reads either any
   * more, so the prop is the count — a component that takes the whole roster to
   * print `.length` invites the next person to draw something from it.
   */
  matches: number
}) {
  return (
    <Card className="surface-edge animate-rise gap-0 overflow-hidden px-5 py-4">
      {/*
        THE ORDER IS THE OWNER'S, VERBATIM: "This line should actually read in
        this order: 'on server', 'in lobby', 'in match', 'matches'".

        AND IT IS THE ORDER THE ARITHMETIC READS IN. `on server` is the total;
        `in lobby` and `in match` are the two halves it splits into; `matches` is
        what those in a match are spread across. Left to right it now goes
        whole → parts → containers, which is the sentence the segmented bar
        below it draws.

        `matches` WAS PUSHED TO THE FAR RIGHT BY AN `ml-auto`, which is what the
        owner saw ("'matches' all the way on the right side"). The gap was doing
        the job of a divider between "people" and "games", but at any real width
        it read as a figure that had come loose from the row.

        AND THE PHASE PIPS ARE GONE (owner, playtest: "What's the dot next to
        'matches' in the top bar of the live players page? That can be removed
        lol"). One coloured dot per running match sat beside this figure, each
        one a tooltip carrying `match 3 · storm · 12 alive`. At the one and two
        matches a real server runs it read as a stray dot rather than as a row
        of pips, and the fact it encoded is on the match cards under the "By
        match" tab, spelled out. The phase colours themselves are untouched —
        `MatchCard` is where they earn their keep.
      */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Figure value={connected} label="on server" />
        <Figure value={lobby} label="in lobby" colour="var(--idle)" />
        <Figure value={inMatch} label="in match" colour="var(--primary)" />
        <Figure value={matches} label="matches" colour="var(--live)" />
      </div>

    </Card>
  )
}
