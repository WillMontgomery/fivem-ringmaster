'use client'

import { AlertTriangle, LayoutGrid, Rows3 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { MatchCard, squadColour } from '@/components/MatchCard'
import { PlayerTable } from '@/components/PlayerTable'
import { ServerStrip } from '@/components/ServerStrip'
import { Card } from '@/components/ui/card'
import type { PlayerRow as Player } from '@/lib/ingest'
import { useLiveState } from '@/lib/livePoll'
import type { liveView } from '@/lib/state'
import { cn } from '@/lib/utils'

type View = ReturnType<typeof liveView>

/**
 * The live board.
 *
 * A COMPONENT OVER A VIEW OBJECT, deliberately: it never fetches, so the same
 * tree renders from real ingest state and from a fixture. That is what makes
 * the whole surface reviewable before the game half exists — the same trick
 * the gamemode's NUI dev harness uses, for the same reason.
 *
 * Two arrangements of the same data, because they answer different questions.
 * "By match" is the operational view — who is fighting whom, which squads are
 * down to one. "All players" is the investigative one — sortable by damage,
 * searchable by license, indifferent to which match anybody is in.
 */

export function LiveBoard({
  view: initialView,
  now: initialNow,
  live = false,
}: {
  view: View
  /** Server-rendered clock, so first paint matches. */
  now: number
  /** Poll for fresh state. Off in the preview harness, on for the real app. */
  live?: boolean
}) {
  // Fresh state from the shared poller, falling back to the server render so
  // first paint is never blank. The fixture harness passes live=false and
  // renders exactly what it was given.
  const polled = useLiveState(live)
  const view = polled?.view ?? initialView
  // "All players" is the default view: the first question on opening the
  // console is almost always "who is on", not "how are the matches arranged".
  const [mode, setMode] = useState<'match' | 'all'>('all')

  /**
   * A ticking clock, so "connected for" counts up between pushes instead of
   * freezing until the next snapshot arrives.
   *
   * Seeded from a server-rendered value and only advanced after mount —
   * calling Date.now() during render would produce a different number on the
   * server than on the client and trip a hydration mismatch.
   */
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const lobby: Player[] = view.players.filter((p) => p.matchId === null)
  const playersOf = (matchId: number) =>
    view.players.filter((p) => p.matchId === matchId)

  const server = view.snapshotClock

  return (
    <div className="space-y-4">
      <ServerStrip
        connected={view.counts.connected}
        inMatch={view.counts.inMatch}
        lobby={lobby.length}
        matches={view.matches}
      />

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

      {!view.online && (
        <Card className="surface-edge animate-rise relative items-center overflow-hidden px-6 py-14 text-center">
          {/* The one looping animation on this page, and it earns it: without
              motion, "waiting to hear from the server" and "this console is
              broken" look identical. */}
          <div
            aria-hidden
            className="animate-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-primary/[0.06] to-transparent"
          />
          <p className="relative text-sm text-muted-foreground">
            Nothing received from the game server yet.
          </p>
          <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground/60">
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

      {view.online && (
        <>
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5 rounded-lg border border-border bg-card/60 p-1">
              {(
                [
                  { k: 'all', label: 'All players', icon: Rows3 },
                  { k: 'match', label: 'By match', icon: LayoutGrid },
                ] as const
              ).map(({ k, label, icon: Icon }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                    mode === k
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'match' ? (
            <div className="space-y-4">
              {view.matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  players={playersOf(m.id)}
                  server={server}
                  now={now}
                />
              ))}

              {lobby.length > 0 && (
                <Card className="surface-edge gap-0 overflow-hidden py-0">
                  <header className="flex items-baseline gap-2 border-b border-border bg-card/60 px-4 py-3">
                    <span className="text-sm">Lobby</span>
                    <span className="text-xs text-muted-foreground">
                      connected, not in a match
                    </span>
                  </header>
                  <PlayerTable
                    players={lobby}
                    server={server}
                    now={now}
                    squadColour={() => undefined}
                  />
                </Card>
              )}
            </div>
          ) : (
            <Card className="surface-edge gap-0 overflow-hidden py-0">
              <PlayerTable
                players={view.players}
                server={server}
                now={now}
                squadColour={squadColour}
                caption={
                  <span className="text-sm">
                    Everyone connected
                    <span className="ml-2 text-xs text-muted-foreground">
                      across all matches
                    </span>
                  </span>
                }
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}
