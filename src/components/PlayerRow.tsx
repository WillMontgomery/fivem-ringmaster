'use client'

import { Check, Copy, Crosshair } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { TableCell, TableRow } from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { connectedFor, humanDuration } from '@/lib/duration'
import type { PlayerRow as Player } from '@/lib/ingest'
import { humanLabel } from '@/lib/labels'
import { stateKey } from '@/lib/playerState'
import { cn } from '@/lib/utils'

/**
 * One player, as a moderator reads them.
 *
 * Ordered by what an investigation actually asks, left to right: who they are,
 * what they are doing, how they are doing, how long they have been here, and
 * only then the identifiers you need to act on them.
 */

/**
 * KEYED LOWERCASE, because that is what the game sends — `BR.PlayerState` is a
 * table of lowercase strings and the snapshot carries them verbatim. The
 * uppercase keys this used to have never matched a real row, so every player on
 * a live server fell to the grey fallback below: the chip printed their state
 * (which looked right, because the CSS uppercases it) with none of the colour
 * that makes a table of forty rows scannable. Alive and dead looked identical.
 */
const STATE: Record<string, { label: string; className: string }> = {
  alive: { label: 'Alive', className: 'text-live ring-live/25 bg-live/10' },
  dbno: { label: 'Downed', className: 'text-warn ring-warn/25 bg-warn/10' },
  dead: { label: 'Dead', className: 'text-danger ring-danger/25 bg-danger/10' },
  spectating: { label: 'Spectating', className: 'text-info ring-info/25 bg-info/10' },
  left: { label: 'Left', className: 'text-muted-foreground ring-border bg-muted/40' },
  lobby: { label: 'Lobby', className: 'text-muted-foreground ring-border bg-muted/40' },
  warmup: { label: 'Warmup', className: 'text-phase-warmup ring-phase-warmup/25 bg-phase-warmup/10' },
  bus: { label: 'Bus', className: 'text-phase-bus ring-phase-bus/25 bg-phase-bus/10' },
  freefall: { label: 'Freefall', className: 'text-phase-drop ring-phase-drop/25 bg-phase-drop/10' },
  glide: { label: 'Glide', className: 'text-phase-drop ring-phase-drop/25 bg-phase-drop/10' },
}

function StateChip({ state }: { state: string }) {
  const s = STATE[stateKey(state)] ?? {
    // A state this build has never heard of still shows, and still shows as
    // itself — through `humanLabel` rather than raw, so `some_new_state` reads
    // as "Some new state" instead of shouting its wire spelling at an operator.
    label: humanLabel(state),
    className: 'text-muted-foreground ring-border bg-muted/40',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset',
        s.className,
      )}
    >
      {s.label}
    </span>
  )
}

/**
 * Health as a bar, not a number.
 *
 * "87" and "12" take the same effort to read; a nearly-empty bar does not.
 * Armour is a second segment rather than a separate figure, because what
 * matters at a glance is total survivability and two numbers make the reader
 * add them up.
 */
function Vitals({ hp, armour }: { hp: number; armour: number }) {
  const h = Math.max(0, Math.min(100, hp))
  const a = Math.max(0, Math.min(100, armour))
  const tone = h > 60 ? 'bg-live' : h > 25 ? 'bg-warn' : 'bg-danger'

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        {/* Width transitions rather than jumping. Between two-second pushes
            that reads as someone taking damage, which is information; an
            instant jump reads as a glitch. */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500 ease-out',
            tone,
          )}
          style={{ width: `${h}%` }}
        />
        {a > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-info/80 transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, a)}%`, height: '3px' }}
          />
        )}
      </div>
      <span className="w-6 text-right font-mono text-xs text-muted-foreground">
        {Math.round(h)}
      </span>
    </div>
  )
}

/**
 * The license, copyable in one click.
 *
 * Every ban, grant and audit row keys on this string, so the single most
 * common physical action in this console is copying one. Making that a click
 * rather than a careful drag-select removes the way it goes wrong: a
 * half-selected license looks exactly like a valid one.
 */
function License({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={(e) => {
              // The row is a link to the profile; copying must not navigate.
              e.preventDefault()
              e.stopPropagation()
              void navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }}
            className="group/lic -ml-1 flex max-w-[14rem] items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-xs text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
          />
        }
      >
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="size-3 shrink-0 text-live" />
        ) : (
          <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover/lic:opacity-100" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {copied ? 'Copied' : 'Copy license'}
      </TooltipContent>
    </Tooltip>
  )
}

export function PlayerRowView({
  p,
  accent,
  server,
  now,
}: {
  p: Player
  /** The squad's colour, when this row belongs to one. */
  accent?: string
  /** The envelope's clock pair, for converting `connectedAt`. */
  server?: { wallMs: number; gameMs: number }
  now?: number
}) {
  const state = stateKey(p.state)
  const dim = state === 'dead' || state === 'lobby'

  const connected =
    server && now !== undefined
      ? humanDuration(connectedFor(server, p.connectedAt, now))
      : '—'

  return (
    <TableRow className="group/row relative border-border/60 transition-colors duration-150 hover:bg-muted/30">
      <TableCell className="relative py-2">
        {/* The squad spine, continued down each member and brightened on
            hover — so pointing at one player shows you their squad. */}
        {accent && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] opacity-40 transition-opacity duration-150 group-hover/row:opacity-100"
            style={{ background: accent }}
          />
        )}
        {/*
          The whole name is the link to the profile, rather than a separate
          "view" button. The row is the record; clicking the person is the
          obvious gesture, and an extra column of chevrons is a column of
          nothing.

          A player with no license yet — mid-handshake, or the rare account
          that reports none — is not clickable and shows no license line: the
          profile is keyed on license, so there is nothing to link to. It still
          renders as a row, because "who is connecting right now" is exactly
          what an admin watching a join wants to see.
        */}
        {p.license ? (
          <Link
            href={`/players/${encodeURIComponent(p.license)}`}
            className={cn(
              'text-sm underline-offset-4 transition-colors hover:text-primary hover:underline',
              dim ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {p.name}
          </Link>
        ) : (
          <span className={cn('text-sm', dim ? 'text-muted-foreground' : 'text-foreground')}>
            {p.name}
          </span>
        )}
        {p.license ? (
          <License value={p.license} />
        ) : (
          <span className="text-xs text-muted-foreground/50">no license yet</span>
        )}
      </TableCell>

      <TableCell>
        <StateChip state={p.state} />
      </TableCell>

      <TableCell>
        {state === 'lobby' ? (
          <span className="text-xs text-muted-foreground/50">—</span>
        ) : (
          <Vitals hp={p.hp} armour={p.armour} />
        )}
      </TableCell>

      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {connected}
      </TableCell>

      <TableCell className="text-right">
        <span className="inline-flex items-center gap-1 font-mono text-sm">
          {p.kills > 0 && <Crosshair className="size-3 text-muted-foreground/50" />}
          {p.kills}
        </span>
      </TableCell>

      <TableCell className="text-right font-mono text-sm text-muted-foreground">
        {Math.round(p.damage)}
      </TableCell>

      <TableCell className="text-right font-mono text-xs text-muted-foreground/50">
        {p.src}
      </TableCell>
    </TableRow>
  )
}
