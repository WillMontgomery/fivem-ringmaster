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

const PHASE: Record<string, string> = {
  WARMUP: 'text-primary ring-primary/25 bg-primary/10',
  BUS: 'text-primary ring-primary/25 bg-primary/10',
  DROP: 'text-info ring-info/25 bg-info/10',
  STORM: 'text-chart-1 ring-chart-1/30 bg-chart-1/10',
  ENDED: 'text-muted-foreground ring-border bg-muted/40',
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
}: {
  match: MatchRow
  players: Player[]
}) {
  const groups = bySquad(players)

  return (
    <Card className="surface-edge gap-0 overflow-hidden py-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm text-muted-foreground">
            match {match.id}
          </span>
          <Badge
            variant="outline"
            className={cn(
              'rounded-md border-0 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset',
              PHASE[match.state] ?? PHASE.ENDED,
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
              Kills
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              Damage
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              Place
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wider">
              ID
            </TableHead>
          </TableRow>
        </TableHeader>

        {groups.map(([squadId, members]) => {
          const alive = members.filter((m) => m.state === 'ALIVE').length
          return (
            <TableBody key={squadId ?? 'none'}>
              <TableRow className="border-border/60 hover:bg-transparent">
                <td
                  colSpan={7}
                  className="bg-background/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3" />
                    {squadId === null ? 'No squad' : `Squad ${squadId}`}
                  </span>
                  <span
                    className={cn(
                      'ml-2 font-normal normal-case tracking-normal',
                      alive === 0 ? 'text-danger/70' : 'text-muted-foreground/60',
                    )}
                  >
                    {alive} of {members.length} alive
                  </span>
                </td>
              </TableRow>
              {members.map((p) => (
                <PlayerRowView key={p.src} p={p} />
              ))}
            </TableBody>
          )
        })}
      </Table>
    </Card>
  )
}
