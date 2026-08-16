'use client'

import {
  Ban,
  CircleAlert,
  Crosshair,
  DoorClosed,
  Eye,
  EyeOff,
  Gavel,
  Layers,
  Lock,
  Radar,
  Scale,
  SearchX,
  Server,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

/**
 * The anticheat explainer, written for an admin who does not read the code.
 *
 * WHY IT IS TABBED RATHER THAN A PAGE (owner, 2026-08-14): the previous version
 * of this was one continuous scroll — mode, then every check with an example,
 * then the limits, then the decision procedure. All of it true, none of it
 * findable. "Reads like a chapter book" was the note, and the fix is not fewer
 * facts but four questions answered separately:
 *
 *   Detection   what it can see
 *   Mitigation  what happens once it sees it
 *   Prevention  why most cheats have nothing to work with in the first place
 *   Blind spots what it cannot see at all
 *
 * PREVENTION IS THE BIGGEST OF THE FOUR AND THE LEAST VISIBLE, which is exactly
 * why it needs saying. Almost nothing on that tab is anticheat code — it is the
 * gamemode being server-authoritative from the first commit, plus bans keeping
 * the same person from coming back. An admin who thinks the seven checks on the
 * Detection tab are the whole defence has the picture upside down.
 *
 * NO JARGON. No refusal enum names, no table names, no "validator". An admin
 * reads this to know what to trust and what to watch for by eye; every term
 * that needs a definition gets one in the sentence that uses it.
 *
 * WHAT THIS FILE MUST NEVER DO IS FLATTER THE SYSTEM. The Blind spots tab is
 * load-bearing: an admin who believes this is comprehensive stops watching,
 * which is worse than having no anticheat at all, because it converts vigilance
 * into false confidence.
 */

/** Severity as the game grades it, and what that means to somebody triaging. */
const WEIGHT = {
  high: {
    label: 'High',
    cls: 'bg-danger/10 text-danger ring-danger/30',
    note: 'no innocent explanation',
  },
  normal: {
    label: 'Normal',
    cls: 'bg-warn/10 text-warn ring-warn/30',
    note: 'real, but a bad connection can imitate it',
  },
  counted: {
    label: 'Counts only',
    cls: 'bg-muted/40 text-muted-foreground ring-border',
    note: 'never opens a case by itself',
  },
} as const

/**
 * The checks that count, in the order an admin should read them.
 *
 * `reads` is the line that will appear on the incident itself. It is here so
 * that somebody who has just opened a case can find the row that explains it
 * without translating — the game writes that exact sentence into the record
 * (`BR.ShotRefusal` in br_lib/shared/combat_solve.lua).
 *
 * THE WEIGHTS ARE FIXED IN THE GAME BUILD, not configurable, which is why they
 * are written down here rather than read off the snapshot like the threshold is.
 * The one thing this page must never do is state a *setting* from memory.
 */
const DETECTS = [
  {
    name: 'A weapon the game does not hand out',
    plain:
      'Damage arrived from something no crate on the map contains. The game only issues weapons from its own list.',
    example: 'A minigun kills somebody on a map that has no minigun.',
    reads: 'weapon is not one this gamemode issues',
    weight: 'high',
  },
  {
    name: 'A weapon they are not holding',
    plain:
      'The server tracks what is in every player’s hands. This is damage from something else.',
    example: 'A player carrying a pistol deals sniper-rifle damage.',
    reads: 'shooter does not hold that weapon',
    weight: 'high',
  },
  {
    name: 'Ammunition they do not have',
    plain:
      'Every round is counted on the server. This is a shot from a magazine the server knows is empty.',
    example: 'Forty rounds land from a rifle counted as empty.',
    reads: 'shooter has no rounds for it',
    weight: 'high',
  },
  {
    name: 'An explosive they never threw',
    plain:
      'Explosion damage credited to somebody the server never watched throw one.',
    example: 'A grenade goes off with no throw recorded anywhere.',
    reads: 'shooter did not throw that explosive',
    weight: 'high',
  },
  {
    name: 'Further than the weapon reaches',
    plain:
      'Measured against the server’s own positions, with slack added for lag. Well beyond that slack is not a lucky shot.',
    example: 'A shotgun kills across 300 metres.',
    reads: "beyond the weapon's range",
    weight: 'normal',
  },
  {
    name: 'Faster than the weapon fires',
    plain:
      'Shots arriving closer together than the weapon can physically cycle, again with slack added.',
    example: 'A bolt-action lands six hits in one second.',
    reads: 'faster than the weapon can cycle',
    weight: 'normal',
  },
  {
    name: 'Repeatedly hurting themselves',
    plain:
      'Standing in your own grenade is ordinary and allowed. Doing it over and over in seconds is somebody testing something — so it counts toward the total, but on its own it opens nothing.',
    example: 'Three self-inflicted hits inside five seconds.',
    reads: 'shooter and victim are the same player',
    weight: 'counted',
  },
] as const

/**
 * Refused and deliberately not counted.
 *
 * THIS IS THE HALF THAT KEEPS THE THRESHOLD MEANINGFUL and the half admins are
 * most likely to ask about, because these are the ones they will see happen in
 * front of them. Everyone has fists at all times, so a friendly scrap on the
 * warmup pad produces a dozen of these in seconds; counting them would fire the
 * anticheat at honest players on the first minute of every match.
 */
const NOT_COUNTED = [
  {
    name: 'Friendly fire inside a squad',
    why: 'Squadmates cannot hurt each other. This happens constantly and means nothing.',
  },
  {
    name: 'Shooting during warmup',
    why: 'The warmup pad deals no damage at all, by design.',
  },
  {
    name: 'One of them is not alive in the match',
    why: 'A shot at somebody already eliminated, or fired by somebody who is.',
  },
  {
    name: 'The two are in different matches',
    why: 'A shot still in the air when a match ended. Matches are kept apart, so this is a timing edge, not an attack.',
  },
] as const

/** What actually happens once something is detected, in order. */
const MITIGATION = [
  {
    icon: ShieldOff,
    tone: 'text-live',
    name: 'The damage never lands',
    body: 'This is the part that protects the match, and it happens on every single impossible hit — not only at the threshold. The server refuses the damage before it reaches anybody, so no health is lost and no kill is credited. Nothing later in this list can undo that or is needed for it.',
  },
  {
    icon: Layers,
    tone: 'text-info',
    name: 'A case is opened, with the match’s evidence attached',
    body: 'Enough counted hits in the window and the server writes an incident: what was refused, how many times, and the chat and kills from that match for everybody involved. Evidence is kept for players who have already disconnected, so leaving does not erase the case.',
  },
  {
    icon: EyeOff,
    tone: 'text-warn',
    name: 'The player is told nothing. Ever.',
    body: 'No warning, no on-screen message, no hint that anything was noticed — not at the threshold, and not when a case is opened. A warning is free feedback for somebody testing a cheat: it tells them exactly which of their tricks the server can see. If they are eventually removed, the reason they read is deliberately generic.',
  },
  {
    icon: Scale,
    tone: 'text-info',
    name: 'A person decides — here, not on the game server',
    // NOT "with a severity to help you sort it". The game records a severity on
    // every case, but the queue does not display or sort on it yet, and a page
    // that describes an affordance the reader then cannot find is the same lie
    // as claiming an enforcement mode the server does not have.
    body: 'The game server has no opinion about what should happen to anybody. It counts, it files, it stops. The case lands in the queue on Incidents and stays open until an admin decides — carrying a severity the game worked out, as a hint for whoever picks it up.',
  },
  {
    icon: Gavel,
    tone: 'text-danger',
    name: 'Any removal is sent from this console',
    body: 'Kicks and bans are issued here and carried out by the game server. That keeps every enforcement in one audit trail with a name against it, and means nothing can be done to a player that an admin did not do.',
  },
] as const

/** Prevention: the design, then the door. */
const BUILT_IN = [
  {
    name: 'The server decides who is alive',
    body: 'Who is playing, who is down, which squad they are on, how much health they have. A player’s computer cannot make itself alive, revive a teammate, or see anybody the server has not told it about.',
  },
  {
    name: 'The server owns every inventory',
    body: 'Every slot, every stack, every round lives on the server. A player can only ask for things — “pick this up”, “switch to slot 3” — and the answer is worked out from information their computer does not have. There is no code path anywhere that adds an item because a player said so.',
  },
  {
    name: 'Ammunition can only ever go down',
    body: 'The server accepts a report that a player has fewer rounds and refuses one that says they have more. The worst somebody can achieve by lying is disarming themselves.',
  },
  {
    name: 'Loot cannot be found early or taken twice',
    body: 'Where the loot is never leaves the server — a player is only sent the small area they are standing in. Picking something up is range-checked and first-come, so the second person to claim the same item gets nothing.',
  },
  {
    name: 'Only weapons on the list exist',
    body: 'Weapons are matched against the game’s own list. Anything else is not a weapon this gamemode knows about, which is why the very first check on the Detection tab exists at all.',
  },
] as const

const DOOR = [
  {
    name: 'Bans are checked before a player loads in',
    body: 'A banned player is turned away at connect, so a repeat offender never reaches a match to be detected in. Bans can be permanent or timed, and a timed one lets itself out.',
  },
  {
    name: 'A ban is a record, not a deletion',
    body: 'Lifting a ban keeps the original, along with who lifted it and why. So “has this person been banned before, and who let them back in” always has an answer — and an accidental lift is visible and reversible.',
  },
  {
    name: 'Removals are tied to a person, not a slot',
    body: 'Everything is recorded against the player’s account identifier rather than their name or their slot on the server, both of which change. A new name does not shake off a ban.',
  },
] as const

/** The limits, stated so nobody mistakes silence for safety. */
const BLIND = [
  {
    icon: Crosshair,
    name: 'Aimbots',
    body: 'Every shot an aimbot fires is one the player could legitimately have fired: the right weapon, in range, at a possible rate. The server checks whether a shot was possible — never whether it was humanly plausible. Suspiciously perfect aim is something you have to see for yourself.',
  },
  {
    icon: Eye,
    name: 'Wallhacks and seeing through terrain',
    body: 'Reading information is passive — nothing is sent to the server, so there is nothing for it to check. The game limits what it tells each player, which narrows this, but it cannot detect somebody who is simply looking.',
  },
  {
    icon: Radar,
    name: 'Movement, speed and teleporting',
    body: 'Only damage is checked today. Positions are sampled for the range check but are not policed on their own, so unusual movement will not open a case.',
  },
  {
    icon: Layers,
    name: 'Anything outside combat',
    body: 'Looting, vehicles and the storm have no checks of their own beyond the design protections on the Prevention tab.',
  },
  {
    icon: SearchX,
    name: 'The cheat program itself',
    body: 'There is no scanning of files, memory or running programs, and there never will be. The goal is narrower and more durable: make a player’s computer unable to change the outcome, rather than trying to recognise every tool that tries.',
  },
  {
    icon: CircleAlert,
    name: 'Nothing accumulates over time',
    body: 'The count is per player and per window and starts again from empty. Somebody careful enough to stay under the threshold — a few impossible hits a minute, all match, every match — files nothing. There is no running total, no strike count, and no memory of it between matches.',
  },
] as const

function ms(n: number): string {
  return n >= 1000 ? `${n / 1000}s` : `${n}ms`
}

function SectionHead({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4', tone)} />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

/** A named row with a paragraph. The shape most of this guide is made of. */
function Rows({
  items,
}: {
  items: readonly {
    name: string
    body: string
    icon?: React.ComponentType<{ className?: string }>
    tone?: string
  }[]
}) {
  return (
    <ul className="divide-y divide-border/60 rounded-lg border border-border">
      {items.map((r) => (
        <li key={r.name} className="flex gap-3 px-4 py-3">
          {r.icon && (
            <r.icon className={cn('mt-0.5 size-4 shrink-0', r.tone ?? 'text-muted-foreground')} />
          )}
          <div className="min-w-0">
            <div className="text-sm font-medium">{r.name}</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {r.body}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * Only the two numbers this guide quotes, rather than `AnticheatConfig`.
 *
 * NOT LAZINESS AND NOT A CYCLE: AnticheatBoard renders this component, so
 * importing its type back would be circular, and the narrower type is the
 * truthful one — nothing here reads the mode or the self-damage window. The
 * board keeps those.
 */
interface GuideNumbers {
  limit: number
  windowMs: number
  barHigh?: number
  barNormal?: number
}

export function AnticheatGuide({ config }: { config: GuideNumbers | null }) {
  // THE SAME STALE READ THE BOARD TILE HAD. `limit` is zeroed by every current
  // server — the real thresholds moved to the graded bar — so this sentence
  // told admins they needed "0 of them inside 10s".
  const threshold = !config
    ? 'enough of them in one match'
    : config.barHigh != null
      ? `${config.barHigh} of the worst kind, or ${config.barNormal ?? '?'} of the rest, in one match`
      : `${config.limit} of them inside ${ms(config.windowMs)}`

  return (
    <Tabs defaultValue="detection">
      <TabsList className="w-full">
        <TabsTrigger value="detection">
          <Radar />
          Detection
        </TabsTrigger>
        <TabsTrigger value="mitigation">
          <ShieldCheck />
          Mitigation
        </TabsTrigger>
        <TabsTrigger value="prevention">
          <Lock />
          Prevention
        </TabsTrigger>
        <TabsTrigger value="blind">
          <CircleAlert />
          Blind spots
        </TabsTrigger>
      </TabsList>

      {/* DETECTION ------------------------------------------------------- */}
      <TabsContent value="detection" className="mt-2 space-y-4">
        <SectionHead icon={Radar} tone="text-primary" title="What it can see">
          Every hit is checked against what the <em>server</em> believes — the
          positions it sampled and the inventory it keeps — and never against
          anything the shooter’s computer claimed. A hit the server considers
          impossible is refused. Some of those refusals mean somebody is
          cheating and some are ordinary play, and telling the two apart is the
          whole job.
        </SectionHead>

        <div>
          <h3 className="text-sm font-medium">Counted toward a case</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            These have no honest explanation. {threshold} from the same player
            opens one incident. A single one is noise — a bad connection, a
            close call at the edge of a weapon’s range — which is why one never
            does anything on its own.
          </p>

          {/* A GRID, NOT ui/table. Two attempts here were wrong and both are
              worth recording, because the next person will reach for the same
              two things.

              A third column for Weight looked obvious and pushed the widest
              column off the right edge: the page is max-w-4xl and prose does not
              compress. So Weight moved up beside the name, where it is read in
              the same glance as the thing it grades.

              And ui/table cannot hold prose at all — shadcn's TableCell carries
              `whitespace-nowrap`, which is right for the tabular data everywhere
              else in this console and turns a paragraph into one long line with a
              scrollbar under it. This is the same two-column reading order,
              built from a grid so the text wraps, and it stacks on a narrow
              screen instead of scrolling sideways. */}
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <div className="hidden border-b border-border bg-card/60 px-4 py-2 text-sm font-medium sm:grid sm:grid-cols-[17rem_1fr] sm:gap-4">
              <div>What was caught</div>
              <div>What that means</div>
            </div>
            <ul className="divide-y divide-border/60">
              {DETECTS.map((d) => {
                const w = WEIGHT[d.weight]
                return (
                  <li
                    key={d.name}
                    className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[17rem_1fr]"
                  >
                    <div>
                      <div className="text-sm font-medium">{d.name}</div>
                      <Badge
                        className={cn(
                          'mt-1.5 border-0 text-xs uppercase tracking-wider ring-1 ring-inset',
                          w.cls,
                        )}
                      >
                        {w.label}
                      </Badge>
                      {/* The exact sentence the incident will carry, so a case
                          can be matched back to this row without anybody
                          translating between two vocabularies. */}
                      <div className="mt-1.5 text-xs text-muted-foreground/60">
                        on a case: “{d.reads}”
                      </div>
                    </div>
                    <div>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {d.plain}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/60">
                        e.g. {d.example}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="mt-2 max-w-3xl space-y-1 text-xs text-muted-foreground/60">
            <p>
              <span className="text-muted-foreground">Weight</span> is recorded
              on the case as a hint for whoever reads it, never a decision:{' '}
              <span className="text-muted-foreground">high</span> means{' '}
              {WEIGHT.high.note};{' '}
              <span className="text-muted-foreground">normal</span> means{' '}
              {WEIGHT.normal.note};{' '}
              <span className="text-muted-foreground">counts only</span>{' '}
              {WEIGHT.counted.note}.
            </p>
            <p>
              A case is graded by the worst thing in it, so a run of high-weight
              hits is not softened by a self-inflicted one mixed in.
            </p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium">Refused, but never counted</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            An honest player produces these constantly — the game simply
            declines the shot and moves on. Everybody has fists at all times, so
            counting these would fire the anticheat at innocent players in the
            first minute of every match.
          </p>
          <Rows items={NOT_COUNTED.map((r) => ({ name: r.name, body: r.why }))} />
        </div>
      </TabsContent>

      {/* MITIGATION ------------------------------------------------------ */}
      <TabsContent value="mitigation" className="mt-2 space-y-4">
        <SectionHead
          icon={ShieldCheck}
          tone="text-live"
          title="What happens once it sees something"
        >
          Two separate things, and they are worth keeping apart. The{' '}
          <em>shot</em> is dealt with instantly and automatically, every time.
          The <em>player</em> is dealt with by a person, here, after reading the
          case. The game server does nothing to anybody on its own.
        </SectionHead>

        <Rows items={MITIGATION} />

        <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">
              A case survives the console being down
            </h3>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            The game server writes the incident to storage itself and only then
            tells this console about it. So if Ringmaster is offline, restarting
            or unreachable when something happens, the case is still written and
            still complete — you will see it when the console next looks. Nothing
            depends on the two being up at the same time.
          </p>
        </div>

        <p className="max-w-3xl text-sm text-muted-foreground">
          Cases waiting on somebody are in{' '}
          <Link
            href="/incidents"
            className="text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Incidents
          </Link>
          . Removals and their history are in{' '}
          <Link
            href="/moderation"
            className="text-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            Kick &amp; ban
          </Link>
          .
        </p>
      </TabsContent>

      {/* PREVENTION ----------------------------------------------------- */}
      <TabsContent value="prevention" className="mt-2 space-y-4">
        <SectionHead icon={Lock} tone="text-primary" title="Why there is less to catch">
          The strongest protection here is not the anticheat — it is that the
          game was built so a player’s computer never decides anything that
          matters. Most cheats for this kind of game work by having your machine
          announce what happened. Here the server works it out instead, so those
          cheats have nothing to announce to.
        </SectionHead>

        <div>
          <h3 className="text-sm font-medium">Built into how the game works</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            None of this is a detection rule that could miss something. These are
            paths that do not exist, so there is nothing to detect.
          </p>
          <Rows items={BUILT_IN} />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <DoorClosed className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Keeping the same person out</h3>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Detection deals with what somebody is doing now. Bans deal with them
            coming back to do it again.
          </p>
          <Rows items={DOOR} />
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground/60">
            Worth knowing the limit: this system never collects a player’s
            network address, deliberately — so every identifier a ban can use is
            one a determined person could change. It catches the ordinary case
            and is not a wall.
          </p>
        </div>
      </TabsContent>

      {/* BLIND SPOTS ---------------------------------------------------- */}
      <TabsContent value="blind" className="mt-2 space-y-4">
        <SectionHead
          icon={CircleAlert}
          tone="text-warn"
          title="What it does not do"
        >
          Read this one properly. Everything on the other three tabs is real, and
          none of it adds up to a system that catches cheating in general. An
          admin who assumes it does stops watching, which costs more than having
          no anticheat at all.
        </SectionHead>

        <Rows items={BLIND} />

        <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <Ban className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">So what covers the gap</h3>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            You do, and players do. Everything above is something a person
            notices and this system does not: aim that is too good, somebody
            always knowing where you are, a player who never loses. Suspicion
            this system cannot confirm belongs in{' '}
            <Link
              href="/incidents"
              className="text-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              Incidents
            </Link>
            , where it stays open until an admin decides — the same queue the
            anticheat files into, so a hunch and a detection sit side by side.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}
