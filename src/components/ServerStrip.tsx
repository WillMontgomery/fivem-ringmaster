import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { MatchRow } from '@/lib/ingest'
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

const PHASE_DOT: Record<string, string> = {
  WARMUP: 'bg-phase-warmup',
  BUS: 'bg-phase-bus',
  DROP: 'bg-phase-drop',
  STORM: 'bg-phase-storm',
  ENDED: 'bg-phase-ended',
}

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
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  )
}

export function ServerStrip({
  connected,
  inMatch,
  lobby,
  capacity,
  matches,
}: {
  connected: number
  inMatch: number
  lobby: number
  capacity: number
  matches: MatchRow[]
}) {
  const pctMatch = capacity > 0 ? (inMatch / capacity) * 100 : 0
  const pctLobby = capacity > 0 ? (lobby / capacity) * 100 : 0
  const pctFull = capacity > 0 ? (connected / capacity) * 100 : 0

  return (
    <Card className="surface-edge animate-rise gap-0 overflow-hidden px-5 py-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Figure value={connected} label="on server" />
        <Figure value={inMatch} label="in match" colour="var(--primary)" />
        <Figure value={lobby} label="in lobby" colour="var(--idle)" />

        <div className="ml-auto flex items-end gap-6">
          <Figure value={matches.length} label="matches" colour="var(--live)" />

          {/* Phase pips: one dot per running match, coloured by phase. The
              shape of the server's activity in the width of a word. */}
          {matches.length > 0 && (
            <div className="flex items-center gap-1.5 pb-1">
              {matches.map((m) => (
                <Tooltip key={m.id}>
                  <TooltipTrigger
                    render={
                      <span
                        className={cn(
                          'size-2.5 rounded-full ring-2 ring-background transition-transform duration-200 hover:scale-125',
                          PHASE_DOT[m.state] ?? PHASE_DOT.ENDED,
                        )}
                      />
                    }
                  />
                  <TooltipContent>
                    match {m.id} · {m.state.toLowerCase()} · {m.alive} alive
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The population bar. Segments are in-match then lobby, against the
          full slot count -- so the empty remainder is as informative as the
          filled part. */}
      <div className="mt-4">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${pctMatch}%` }}
          />
          <div
            className="h-full bg-idle/70 transition-[width] duration-700 ease-out"
            style={{ width: `${pctLobby}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {Math.round(pctFull)}% of {capacity} slots
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary" />
              in match
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-idle/70" />
              lobby
            </span>
          </span>
        </div>
      </div>
    </Card>
  )
}
