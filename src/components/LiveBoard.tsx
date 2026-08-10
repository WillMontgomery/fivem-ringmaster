import { AlertTriangle, Signal, Swords, Users2, UserRound } from 'lucide-react'

import { MatchCard } from '@/components/MatchCard'
import { PlayerRowView } from '@/components/PlayerRow'
import { Card } from '@/components/ui/card'
import { Table, TableBody } from '@/components/ui/table'
import type { PlayerRow as Player } from '@/lib/ingest'
import type { liveView } from '@/lib/state'

import { FeedStatus } from './FeedStatus'

type View = ReturnType<typeof liveView>

/**
 * The live board.
 *
 * A PURE COMPONENT OVER A VIEW OBJECT, deliberately: it never fetches, so the
 * same tree renders from real ingest state and from a committed fixture. That
 * is what makes the whole surface reviewable before the game half exists — the
 * same trick the gamemode's NUI dev harness uses, for the same reason.
 */

function Tile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: number
  hint?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card className="surface-edge gap-0 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 font-mono text-3xl leading-none tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-muted-foreground/60">{hint}</div>
      )}
    </Card>
  )
}

export function LiveBoard({ view }: { view: View }) {
  const lobby: Player[] = view.players.filter((p) => p.matchId === null)
  const playersOf = (matchId: number) =>
    view.players.filter((p) => p.matchId === matchId)

  return (
    <div className="space-y-4">
      <FeedStatus ageMs={view.ageMs} bootEpoch={view.bootEpoch} />

      {/*
        The truncation warning sits ABOVE the data, not beside it. The push is
        a full snapshot with no delta encoding, so at real scale the list gets
        capped — and a short list that looks complete is a worse failure than
        an ugly banner.
      */}
      {view.truncated && (
        <div
          role="alert"
          className="surface-edge flex items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/5 px-4 py-3"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <div className="text-sm text-warn">
            <span className="font-medium">Player list truncated.</span>{' '}
            <span className="text-warn/80">
              The server reports more players than the snapshot carries — this
              view is incomplete.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Connected" value={view.counts.connected} icon={Users2} />
        <Tile label="In match" value={view.counts.inMatch} icon={Swords} />
        <Tile label="Matches" value={view.matches.length} icon={Signal} />
        <Tile
          label="In lobby"
          value={lobby.length}
          icon={UserRound}
          hint={lobby.length ? 'not in a match' : undefined}
        />
      </div>

      {!view.online && (
        <Card className="surface-edge items-center px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing received from the game server yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground/60">
            <code className="font-mono text-muted-foreground/80">
              br_ringmaster
            </code>{' '}
            pushes here every two seconds once{' '}
            <code className="font-mono text-muted-foreground/80">
              br_ringmaster_ingest_url
            </code>{' '}
            and its secret are set in{' '}
            <code className="font-mono text-muted-foreground/80">
              server.cfg
            </code>
            . Until then this is the correct display, not an error.
          </p>
        </Card>
      )}

      {view.matches.map((m) => (
        <MatchCard key={m.id} match={m} players={playersOf(m.id)} />
      ))}

      {lobby.length > 0 && (
        <Card className="surface-edge gap-0 overflow-hidden py-0">
          <header className="flex items-baseline gap-2 border-b border-border bg-card/60 px-4 py-3">
            <span className="text-sm">Lobby</span>
            <span className="text-[11px] text-muted-foreground">
              connected, not in a match
            </span>
          </header>
          <Table>
            <TableBody>
              {lobby.map((p) => (
                <PlayerRowView key={p.src} p={p} />
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
