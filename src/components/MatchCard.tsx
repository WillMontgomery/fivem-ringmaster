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
import { isInMatch } from '@/lib/playerState'
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
    chip: 'text-phase-warmup ring-phase-warmup/30 bg-phase-warmup/10',
    bar: 'bg-phase-warmup',
  },
  BUS: {
    chip: 'text-phase-bus ring-phase-bus/30 bg-phase-bus/10',
    bar: 'bg-phase-bus',
  },
  DROP: {
    chip: 'text-phase-drop ring-phase-drop/30 bg-phase-drop/10',
    bar: 'bg-phase-drop',
  },
  STORM: {
    chip: 'text-phase-storm ring-phase-storm/30 bg-phase-storm/10',
    bar: 'bg-phase-storm',
  },
  ENDED: {
    chip: 'text-phase-ended ring-border bg-muted/40',
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

/**
 * The squad's number, out of the id the game actually sends.
 *
 * THE ONE PLACE THE WIRE FORMAT IS PARSED. `m<match>sq<index>` is the gamemode's
 * own shape (server/party.lua:873) and it is namespaced by match on purpose, so
 * the id is the right thing to key, group and compare on -- but it is the wrong
 * thing to SHOW, because "Squad m3sq2" is not how anybody says it out loud.
 *
 * NULL FOR ANYTHING IT DOES NOT RECOGNISE, and callers fall back to the id.
 * A shape this does not know means the gamemode moved and this did not, and the
 * honest answer to that is the raw id rather than a wrong number.
 */
export function squadIndex(squadId: string | null): number | null {
  if (squadId === null) return null
  const m = /sq(\d+)$/u.exec(squadId)
  return m ? Number(m[1]) : null
}

export function squadColour(squadId: string | null): string {
  if (squadId === null) return 'var(--idle)'
  // The INDEX and not the whole id: two squads in one match must not share a
  // hue, and hashing the string would let them.
  const n = squadIndex(squadId)
  if (n === null) return 'var(--idle)'
  return `var(--squad-${(Math.abs(n) % SQUAD_HUES) + 1})`
}

/** Deterministic grouping — never iterate a hash and hope. */
function bySquad(players: Player[]): Array<[string | null, Player[]]> {
  const map = new Map<string | null, Player[]>()
  for (const p of players) {
    const key = p.squadId ?? null
    const list = map.get(key)
    if (list) list.push(p)
    else map.set(key, [p])
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === null) return 1
    if (b[0] === null) return -1
    // By INDEX where both have one, so Squad 2 sorts before Squad 10; by id
    // otherwise, which at least keeps the order stable across renders.
    const ai = squadIndex(a[0])
    const bi = squadIndex(b[0])
    if (ai !== null && bi !== null) return ai - bi
    return a[0].localeCompare(b[0])
  })
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-sm">{value}</span>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
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
              'rounded-md border-0 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
              phase.chip,
            )}
          >
            {match.state}
          </Badge>
          <span className="text-xs uppercase tracking-wider text-muted-foreground/70">
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
            <TableHead className="text-xs uppercase tracking-wider">
              Player
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider">
              State
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wider">
              Health
            </TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider">
              Connected
            </TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider">
              Kills
            </TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider">
              Damage
            </TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider">
              ID
            </TableHead>
          </TableRow>
        </TableHeader>

        {groups.map(([squadId, members]) => {
          /**
           * THE SAME RULE THE MATCH HEADER ABOVE IS COUNTED WITH.
           *
           * This was `m.state === 'ALIVE'`, against a wire that says `alive` —
           * so on a live server every squad counted zero and every squad
           * header read "wiped", including the one that went on to win. The
           * case was half of it; the other half was the rule. `match.alive` in
           * the envelope comes from `BR.Server.aliveCount`, which counts
           * `isInMatch` — downed, warmup and the descent states included — so
           * comparing against `alive` alone would still have printed "1 of 4"
           * under a header saying 3.
           */
          const alive = members.filter((m) => isInMatch(m.state)).length
          const colour = squadColour(squadId)
          const wiped = alive === 0

          return (
            <TableBody key={squadId ?? 'none'}>
              <TableRow className="border-border/60 hover:bg-transparent">
                <td
                  colSpan={7}
                  className="relative bg-background/40 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
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
                      {squadId === null ? 'No squad' : `Squad ${squadIndex(squadId) ?? squadId}`}
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
