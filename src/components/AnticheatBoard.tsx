'use client'

import {
  CircleAlert,
  Eye,
  Gavel,
  Info,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * What the anticheat is, what it will do to you, and what it cannot see.
 *
 * REFERENCE, NOT A FEED. Individual firings are incidents and live on that
 * page; this answers the questions you ask once and then rely on — which
 * checks exist, which of them act on their own, and where the edges are.
 *
 * IT READS THE LIVE CONFIG rather than describing it from memory. A page that
 * hardcodes "eight refusals then a kick" lies the day somebody edits
 * config/match.lua, and the dangerous version of that lie is claiming
 * enforcement while the server is set to `log` and is removing nobody.
 */

export interface AnticheatConfig {
  action: 'log' | 'notify' | 'kick'
  limit: number
  windowMs: number
  selfLimit: number
  selfWindow: number
}

const MODE = {
  kick: {
    label: 'Enforcing',
    icon: Gavel,
    cls: 'bg-live/10 text-live ring-live/30',
    blurb:
      'The anticheat removes players on its own when they cross the threshold. Every removal is recorded.',
  },
  notify: {
    label: 'Notifying',
    icon: TriangleAlert,
    cls: 'bg-warn/10 text-warn ring-warn/30',
    blurb:
      'Detections are recorded and admins are alerted, but nobody is removed automatically.',
  },
  log: {
    label: 'Log only',
    icon: Eye,
    cls: 'bg-info/10 text-info ring-info/30',
    blurb:
      'Detections are recorded and nothing else happens. Nobody is removed automatically — act on what you see from Incidents.',
  },
} as const

/**
 * The checks, in the game's own two categories.
 *
 * MEANS vs RULES is the distinction the whole threshold rests on, and it is
 * the thing an admin most needs to understand: an honest client trips RULES
 * constantly (friendly fire, shooting during warmup) and those are not
 * counted, while MEANS has no honest explanation at all.
 */
const MEANS = [
  {
    name: 'Weapon the server never issued',
    what: 'A shot from a weapon this gamemode does not hand out.',
    example: 'Damage arrives from a minigun that no crate on the map contains.',
  },
  {
    name: 'Weapon they are not holding',
    what: 'A shot from something the server does not believe is in their hands.',
    example: 'A player holding a pistol deals damage with a sniper rifle.',
  },
  {
    name: 'Ammunition they do not have',
    what: 'A shot fired from a magazine the server never filled.',
    example: 'Forty rounds land from a rifle the server counted as empty.',
  },
  {
    name: 'Beyond the weapon’s range',
    what: 'A hit further away than the weapon can reach, measured against the server’s own positions.',
    example: 'A shotgun kills across 300 metres.',
  },
  {
    name: 'Faster than the weapon can fire',
    what: 'Shots arriving closer together than the weapon’s cycle time allows.',
    example: 'A bolt-action lands six hits in a second.',
  },
  {
    name: 'An explosive they never threw',
    what: 'Explosion damage credited to somebody the server never saw throw one.',
    example: 'A grenade detonates with no throw recorded.',
  },
  {
    name: 'Repeatedly damaging themselves',
    what: 'Self-damage is allowed once — standing in your own grenade is ordinary. Doing it repeatedly is exercising a path.',
    example: 'Three self-hits inside five seconds.',
  },
]

const RULES = [
  'Friendly fire within a squad',
  'Shooting during warmup',
  'Either player not alive in the match',
  'Players in two different matches',
]

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
                  'gap-1 border-0 text-[12px] uppercase tracking-wider ring-1 ring-inset',
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

        {config && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Threshold
              </div>
              <div className="mt-0.5 text-lg tabular-nums">
                {config.limit} in {ms(config.windowMs)}
              </div>
              <div className="text-[12px] text-muted-foreground/60">
                impossible shots before it acts
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Self-damage
              </div>
              <div className="mt-0.5 text-lg tabular-nums">
                {config.selfLimit} in {ms(config.selfWindow)}
              </div>
              <div className="text-[12px] text-muted-foreground/60">
                allowed before it counts
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card/40 px-3 py-2.5">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground">
                Action
              </div>
              <div className="mt-0.5 text-lg">{mode?.label}</div>
              <div className="text-[12px] text-muted-foreground/60">
                read live from the server
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h2 className="text-sm font-medium">What it checks</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every hit is validated against what the <em>server</em> believes —
          its own sampled positions and the inventory it maintains — never
          against anything the shooter reported. A client that lies about its
          weapon, its range or its cadence is checked against the truth.
        </p>

        <h3 className="mt-4 text-[13px] font-medium">
          Counted toward the threshold
        </h3>
        <p className="text-[13px] text-muted-foreground">
          These have no honest explanation. Enough of them in the window and the
          anticheat acts.
        </p>
        <ul className="mt-2 divide-y divide-border/60 rounded-lg border border-border">
          {MEANS.map((d) => (
            <li key={d.name} className="px-3 py-2.5">
              <div className="text-[13px] font-medium">{d.name}</div>
              <p className="text-[13px] text-muted-foreground">{d.what}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground/60">
                e.g. {d.example}
              </p>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-[13px] font-medium">
          Refused, but never counted
        </h3>
        <p className="text-[13px] text-muted-foreground">
          An honest client produces these constantly — the game simply declines
          the shot. Counting them would make the threshold meaningless.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {RULES.map((r) => (
            <li
              key={r}
              className="rounded-md bg-muted/40 px-2 py-1 text-[12px] text-muted-foreground ring-1 ring-inset ring-border"
            >
              {r}
            </li>
          ))}
        </ul>
      </Card>

      {/* THE LIMITS, STATED PLAINLY. An admin who believes this is
          comprehensive stops looking, which is worse than having no anticheat
          at all — it converts vigilance into false confidence. */}
      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex items-center gap-2">
          <CircleAlert className="size-4 text-warn" />
          <h2 className="text-sm font-medium">What it does not catch</h2>
        </div>
        <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Aimbots.</span> Every
            shot an aimbot fires is one the player could legitimately have
            fired — right weapon, right range, right cadence. The validator
            checks whether a shot was <em>possible</em>, not whether it was
            humanly plausible.
          </li>
          <li>
            <span className="font-medium text-foreground">Wallhacks and ESP.</span>{' '}
            Reading information is passive. Nothing reaches the server, so there
            is nothing to validate.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Movement and teleporting.
            </span>{' '}
            Only damage is validated today. Position is sampled for range
            checks, not policed on its own.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Anything outside combat.
            </span>{' '}
            Looting, vehicles and the storm have no validator.
          </li>
        </ul>
        <p className="mt-3 text-[13px] text-muted-foreground">
          These are what human review is for. Suspicion that this system cannot
          confirm belongs in{' '}
          <Link
            href="/incidents"
            className="text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Incidents
          </Link>
          , where it stays open until an admin decides.
        </p>
      </Card>

      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-info" />
          <h2 className="text-sm font-medium">How it decides</h2>
        </div>
        <ol className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1.</span> A damage
            event arrives and is checked against the server&rsquo;s model.
          </li>
          <li>
            <span className="font-medium text-foreground">2.</span> If it is
            impossible, the damage is refused — it never lands, whatever happens
            next.
          </li>
          <li>
            <span className="font-medium text-foreground">3.</span> If the
            reason has no honest explanation, it is counted against that player.
          </li>
          <li>
            <span className="font-medium text-foreground">4.</span> Crossing{' '}
            {config ? `${config.limit} in ${ms(config.windowMs)}` : 'the threshold'}{' '}
            triggers the current action, and the event is recorded either way.
          </li>
        </ol>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Refused damage never applies even in log-only mode. The mode decides
          what happens to the <em>player</em>, not to the shot.
        </p>
      </Card>
    </div>
  )
}
