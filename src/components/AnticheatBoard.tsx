'use client'

import { CircleAlert, Eye, Gavel, ShieldCheck, TriangleAlert } from 'lucide-react'

import { AnticheatGuide } from '@/components/AnticheatGuide'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * The anticheat page: live status, then the explainer.
 *
 * THIS FILE IS NOW ONLY THE LIVE HALF. Everything that describes how the system
 * works moved to AnticheatGuide, which splits it four ways — detection,
 * mitigation, prevention, blind spots — because as one continuous page it was
 * accurate and unreadable (owner, 2026-08-14: "reads like a chapter book").
 *
 * The split is not cosmetic. What belongs here is anything the server reports
 * and could therefore be *different from what a page assumes*; what belongs in
 * the guide is the design, which does not vary per server. Keeping them apart is
 * what stops the guide from quietly acquiring a hardcoded threshold.
 *
 * IT READS THE LIVE CONFIG rather than describing it from memory. A page that
 * hardcodes "eight refusals then a kick" lies the day somebody edits
 * config/match.lua, and the dangerous version of that lie is claiming
 * enforcement that is not happening.
 *
 * WHICH IS WHAT THIS PAGE ITSELF USED TO CLAIM. The game no longer decides
 * anything about a player: crossing the threshold files an incident and stops
 * there. `incident` is what a current server reports; the three modes after it
 * describe a build that still acted on its own, kept so this page can say the
 * server is out of date instead of rendering "unknown" at it.
 */

export interface AnticheatConfig {
  action: 'incident' | 'log' | 'notify' | 'kick'
  /** Legacy, and ZEROED by any current server. Read `barHigh`/`barNormal`. */
  limit: number
  /** Legacy. Survives only as wording in an incident summary. */
  windowMs: number
  /** Refusals needed at the high tier — the server never issued the means. */
  barHigh?: number
  /** Refusals needed at the normal tier — a number the weapon does not have. */
  barNormal?: number
  selfLimit: number
  selfWindow: number
}

const MODE = {
  incident: {
    label: 'Filing incidents',
    icon: ShieldCheck,
    cls: 'bg-info/10 text-info ring-info/30',
    blurb:
      'Crossing the threshold files an incident with the match’s evidence attached, and tells the player nothing. What happens next is decided here, not on the game server.',
  },
  kick: {
    label: 'Enforcing — out of date',
    icon: Gavel,
    cls: 'bg-warn/10 text-warn ring-warn/30',
    blurb:
      'This server removes players itself, before any incident exists and with a warning they can read. That behaviour was retired; the game build is behind.',
  },
  notify: {
    label: 'Notifying — out of date',
    icon: TriangleAlert,
    cls: 'bg-warn/10 text-warn ring-warn/30',
    blurb:
      'This server warns the player their shots are not landing. That behaviour was retired; the game build is behind.',
  },
  log: {
    label: 'Log only — out of date',
    icon: Eye,
    cls: 'bg-warn/10 text-warn ring-warn/30',
    blurb:
      'This server records detections to its console and files nothing. The game build predates incident filing.',
  },
} as const

function ms(n: number): string {
  return n >= 1000 ? `${n / 1000}s` : `${n}ms`
}

export function AnticheatBoard({ config }: { config: AnticheatConfig | null }) {
  const mode = config ? MODE[config.action] : null
  const ModeIcon = mode?.icon ?? CircleAlert

  return (
    <div className="space-y-4">
      {/* MODE FIRST. Whether this thing acts on its own is the single most
          important fact about it, and the one a static page would get wrong. */}
      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Current mode</h2>
              <Badge
                className={cn(
                  'gap-1 border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                  mode?.cls ?? 'bg-muted/40 text-muted-foreground ring-border',
                )}
              >
                <ModeIcon className="size-3" />
                {mode?.label ?? 'Unknown'}
              </Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {mode?.blurb ??
                'The game server has not reported its anticheat settings yet. Either it is not running, or it is on a build that predates this page.'}
            </p>
          </div>
        </div>

        {/* TWO TILES, NOT THREE. The third used to repeat the mode label that is
            already in the badge two lines above it. These are the numbers a
            server can actually have set differently. */}
        {config && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Threshold
              </div>
              {/*
                THE BAR IS PER MATCH AND GRADED, and this tile used to render
                `limit` — which every current server sends as 0, so it read
                "0 in 10s": zero impossible hits opens a case. Meaningless, and
                alarming if you believed it.

                Falls back to the legacy pair only when the graded fields are
                absent, which means the game is on a build that still enforced
                on its own. Saying so is more useful than hiding it.
              */}
              {config.barHigh != null ? (
                <>
                  <div className="mt-0.5 text-lg tabular-nums">
                    {config.barHigh} high · {config.barNormal ?? '—'} normal
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    impossible hits in one match before a case is opened
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-0.5 text-lg tabular-nums">
                    {config.limit} in {ms(config.windowMs)}
                  </div>
                  <div className="text-xs text-warn/70">
                    this server predates the graded bar
                  </div>
                </>
              )}
            </div>
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Self-damage
              </div>
              <div className="mt-0.5 text-lg tabular-nums">
                {config.selfLimit} in {ms(config.selfWindow)}
              </div>
              <div className="text-xs text-muted-foreground/60">
                allowed before it starts counting
              </div>
            </div>
          </div>
        )}
      </Card>

      <AnticheatGuide config={config} />
    </div>
  )
}
