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
import { cn } from '@/lib/utils'

/**
 * One player, as a moderator reads them.
 *
 * Ordered by what an investigation actually asks, left to right: who they are,
 * what they are doing, how they are doing, how long they have been here, and
 * only then the identifiers you need to act on them.
 */

const STATE: Record<string, { label: string; className: string }> = {
  ALIVE: { label: 'Alive', className: 'text-live ring-live/25 bg-live/10' },
  DBNO: { label: 'Downed', className: 'text-warn ring-warn/25 bg-warn/10' },
  DEAD: { label: 'Dead', className: 'text-danger ring-danger/25 bg-danger/10' },
  SPECTATING: { label: 'Spectating', className: 'text-info ring-info/25 bg-info/10' },
  LOBBY: { label: 'Lobby', className: 'text-muted-foreground ring-border bg-muted/40' },
  WARMUP: { label: 'Warmup', className: 'text-phase-warmup ring-phase-warmup/25 bg-phase-warmup/10' },
  BUS: { label: 'Bus', className: 'text-phase-bus ring-phase-bus/25 bg-phase-bus/10' },
  FREEFALL: { label: 'Freefall', className: 'text-phase-drop ring-phase-drop/25 bg-phase-drop/10' },
  GLIDE: { label: 'Glide', className: 'text-phase-drop ring-phase-drop/25 bg-phase-drop/10' },
}

function StateChip({ state }: { state: string }) {
  const s = STATE[state] ?? {
    label: state,
    className: 'text-muted-foreground ring-border bg-muted/40',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
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
      <span className="w-6 text-right font-mono text-[11px] text-muted-foreground">
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
            className="group/lic -ml-1 flex max-w-[14rem] items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-[10px] text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
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
  const dim = p.state === 'DEAD' || p.state === 'LOBBY'

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
        */}
        <Link
          href={`/players/${encodeURIComponent(p.license)}`}
          className={cn(
            'text-sm underline-offset-4 transition-colors hover:text-primary hover:underline',
            dim ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {p.name}
        </Link>
        <License value={p.license} />
      </TableCell>

      <TableCell>
        <StateChip state={p.state} />
      </TableCell>

      <TableCell>
        {p.state === 'LOBBY' ? (
          <span className="text-[11px] text-muted-foreground/50">—</span>
        ) : (
          <Vitals hp={p.hp} armour={p.armour} />
        )}
      </TableCell>

      <TableCell className="text-right font-mono text-[12px] text-muted-foreground">
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

      <TableCell className="text-right font-mono text-[11px] text-muted-foreground/50">
        {p.src}
      </TableCell>
    </TableRow>
  )
}
