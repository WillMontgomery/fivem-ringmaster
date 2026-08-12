import { Database, Radio, ShieldAlert, Trophy } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
    <Tooltip>
      <TooltipTrigger
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
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[20rem]">
        {k.detail}
      </TooltipContent>
    </Tooltip>
  )
}
