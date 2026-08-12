import { Users } from 'lucide-react'

import { PlayerRowView } from '@/components/PlayerRow'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MatchRow, PlayerRow as Player } from '@/lib/ingest'
import { cn } from '@/lib/utils'

/**
 * One match, with its players grouped by squad.
 *
 * SQUAD GROUPING IS THE POINT, not a nicety. "Who was he playing with" is one
 * of the three questions an investigation asks, and a flat list makes it a
 * manual sort. It also makes the shape of a match legible at a glance: a squad
 * down to one member reads differently from a full one, and that difference is
 * usually why you were looking.
 */

/**
 * A phase's colour, and the whole reason this page is not monochrome.
 *
 * The ramp follows the order a match actually moves through, so six cards can
 * be scanned for "which is nearly over" without reading a word. Violet is
 * STORM specifically, because that is what the colour means in the game.
 */
const PHASE: Record<string, { chip: string; bar: string }> = {
  WARMUP: {
    chip: 'text-[12px]hase-warmup ring-phase-warmup/30 bg-phase-warmup/10',
    bar: 'bg-phase-warmup',
  },
  BUS: {
    chip: 'text-[12px]hase-bus ring-phase-bus/30 bg-phase-bus/10',
    bar: 'bg-phase-bus',
  },
  DROP: {
    chip: 'text-[12px]hase-drop ring-phase-drop/30 bg-phase-drop/10',
    bar: 'bg-phase-drop',
  },
  STORM: {
    chip: 'text-[12px]hase-storm ring-phase-storm/30 bg-phase-storm/10',
    bar: 'bg-phase-storm',
  },
  ENDED: {
    chip: 'text-[12px]hase-ended ring-border bg-muted/40',
    bar: 'bg-phase-ended',
  },
}

/**
 * A squad's colour.
 *
 * Squads are identified by colour far more often than by number — that is how
 * they read in game and how a person describes one out loud. Derived from the
 * id so it is stable across renders and across reloads.
 *
 * TEMPORARY: the roster already carries a real `colour` per player. When the
 * game side starts sending it, this must be replaced rather than kept
 * alongside — two systems disagreeing about which squad is "the blue one"
 * during an incident review is a genuinely bad outcome.
 */
const SQUAD_HUES = 8
export function squadColour(squadId: number | null): string {
  if (squadId === null) return 'var(--idle)'
  return `var(--squad-${(Math.abs(squadId) % SQUAD_HUES) + 1})`
}

/** Deterministic grouping — never iterate a hash and hope. */
function bySquad(players: Player[]): Array<[number | null, Player[]]> {
  const map = new Map<number | null, Player[]>()
  for (const p of players) {
    const key = p.squadId ?? null
    const list = map.get(key)
    if (list) list.push(p)
    else map.set(key, [p])
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === null) return 1
    if (b[0] === null) return -1
    return a[0] - b[0]
  })
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-sm">{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

export function MatchCard({
  match,
  players,
  server,
  now,
}: {
  match: MatchRow
  players: Player[]
  server: { wallMs: number; gameMs: number }
  now: number
}) {
  const groups = bySquad(players)
  const phase = PHASE[match.state] ?? PHASE.ENDED!

  return (
    <Card className="surface-edge animate-rise gap-0 overflow-hidden py-0 transition-shadow duration-300 hover:shadow-lg hover:shadow-black/20">
      {/* A phase-coloured rule across the top: the card's identity readable
          from the corner of the eye, before any text is parsed. */}
      <div className={cn('h-0.5 w-full', phase.bar)} />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm text-muted-foreground">
            match {match.id}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'rounded-md border-0 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset',
              phase.chip,
            )}
          >
            {match.state}
          </Badge>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">
            {match.mode}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <Stat label="alive" value={match.alive} />
          <Stat label="squads" value={match.squadsAlive} />
          <Stat label="players" value={players.length} />
        </div>
      </header>

      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="text-[10px] uppercase tracking-wider">
              Player
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">
              State
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider">
              Health
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              Connected
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              Kills
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              Damage
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              ID
            </TableHead>
          </TableRow>
        </TableHeader>

        {groups.map(([squadId, members]) => {
          const alive = members.filter((m) => m.state === 'ALIVE').length
          const colour = squadColour(squadId)
          const wiped = alive === 0

          return (
            <TableBody key={squadId ?? 'none'}>
              <TableRow className="border-border/60 hover:bg-transparent">
                <td
                  colSpan={7}
                  className="relative bg-background/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {/* The squad's colour as a spine down the left edge. Reads as
                      grouping without a border box, and survives being glanced
                      at from across a desk. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px]"
                    style={{ background: colour }}
                  />
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3" style={{ color: colour }} />
                    <span style={{ color: colour }}>
                      {squadId === null ? 'No squad' : `Squad ${squadId}`}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'ml-2 font-normal normal-case tracking-normal',
                      wiped ? 'text-danger/80' : 'text-muted-foreground/60',
                    )}
                  >
                    {wiped ? 'wiped' : `${alive} of ${members.length} alive`}
                  </span>
                </td>
              </TableRow>
              {members.map((p) => (
                <PlayerRowView key={p.src} p={p} accent={colour} server={server} now={now} />
              ))}
            </TableBody>
          )
        })}
      </Table>
    </Card>
  )
}
