import { Database, Radio, ShieldAlert, Trophy } from 'lucide-react'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import type { Provenance as Kind } from '@/lib/profile'
import { cn } from '@/lib/utils'

/**
 * Where a number came from, and how much to trust it.
 *
 * A PROFILE PAGE MIXES FOUR DIFFERENT KINDS OF FACT, and presenting them
 * identically is how a moderator ends up acting on the wrong one. "In match 41
 * right now" is two seconds old and gone on restart. "412 matches played" is
 * durable but only written at match end, so it is always one match behind.
 * "Banned by Will on Tuesday" is authoritative. They look the same in a grid,
 * and they are not the same.
 *
 * So every block on that page is tagged, and the tag says its freshness in a
 * hover rather than in a paragraph nobody reads.
 *
 * THIS IS THE ONE HOVER IN THE CONSOLE THAT EARNED A CARD, and it spent a long
 * time as a tooltip instead. `TooltipContent` is a single-line pill —
 * `inline-flex items-center text-xs` on an inverted background — and these
 * details are one to two full sentences each. The old site even passed
 * `max-w-[20rem]` to widen it, which did nothing, because the popup was already
 * `max-w-xs` and `max-w-xs` IS 20rem. That is what a component being asked to do
 * a different component's job looks like from the inside.
 *
 * A CARD IS A LAYOUT, NOT AN EMPHASIS LEVEL, so it has one: a header row that
 * repeats the icon and label at readable size, then the detail as a paragraph —
 * the same shape `FeedStatus` uses, which is the other card in the app.
 */

const KIND: Record<
  Kind,
  { label: string; detail: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; className: string }
> = {
  live: {
    label: 'Live',
    detail:
      'From the current snapshot. At most one push interval old, and gone entirely when the game server restarts.',
    icon: Radio,
    className: 'text-live ring-live/25 bg-live/10',
  },
  identity: {
    label: 'Identity',
    detail:
      'From the player_seen event stream, appended whenever this license connects. Durable. Never includes an IP — that is not collected.',
    icon: Database,
    className: 'text-info ring-info/25 bg-info/10',
  },
  stats: {
    label: 'Stats',
    detail:
      'From persistent stats, written at match end. Durable, but always one match behind a player who is mid-game.',
    icon: Trophy,
    className: 'text-phase-warmup ring-phase-warmup/25 bg-phase-warmup/10',
  },
  moderation: {
    label: 'Moderation',
    detail:
      "Ringmaster's own record — bans, incidents, audit. Authoritative, and the only data here that another admin wrote on purpose.",
    icon: ShieldAlert,
    className: 'text-primary ring-primary/25 bg-primary/10',
  },
}

export function ProvenanceTag({ kind }: { kind: Kind }) {
  const k = KIND[kind]
  const Icon = k.icon

  return (
    <HoverCard>
      {/* `render` is not optional here: `HoverCardTrigger` renders an `<a>` by
          default, and an anchor with no href in the middle of a stat block is
          both wrong markup and a styling surprise. */}
      <HoverCardTrigger
        render={
          <span
            className={cn(
              'inline-flex cursor-help items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
              k.className,
            )}
          />
        }
      >
        <Icon className="size-2.5" />
        {k.label}
        {/* The card only ever opens for a mouse: hover is `mouseOnly`, and the
            focus path Base UI also wires cannot help an inert `<span>` that
            nothing can focus. The popup is not announced either — no `role`, no
            `aria-describedby`. So the detail also exists in the DOM. It is the
            console's own account of how far to trust a number, and it was
            invisible to a screen reader for as long as it was hover-only. */}
        <span className="sr-only">. {k.detail}</span>
      </HoverCardTrigger>
      <HoverCardContent side="top">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded ring-1 ring-inset',
              k.className,
            )}
          >
            <Icon className="size-3" />
          </span>
          <span className="text-sm font-medium">{k.label}</span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{k.detail}</p>
      </HoverCardContent>
    </HoverCard>
  )
}
