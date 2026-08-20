'use client'

import { ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { useSyncExternalStore } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { behindMainNow, refBehindNow } from '@/lib/maintenance'
// TYPE-ONLY, AND IT HAS TO STAY THAT WAY — `lib/ssh` reaches
// `node:child_process` at module scope and this is a client component. `import
// type` is erased outright, so nothing from the SSH channel reaches the bundle.
import type { RefUpdate } from '@/lib/ssh'
import { cn } from '@/lib/utils'

/**
 * Whether the running server is current, in the header, on every page.
 *
 * IT BELONGS IN THE CHROME because "is the running server current with the code
 * it is meant to be running" is a standing fact about the deployment, not
 * something you should have to open the Host page to learn. It reads /api/host,
 * which answers from the telemetry poller's memory, on a slow cadence — a
 * deploy is a minutes-scale event, not a seconds-scale one, so 30s is plenty
 * and it keeps the header cheap. Clicking it goes to Maintenance, where the
 * deploy actually happens.
 *
 * ═══ IT NO LONGER RENDERS NOTHING WHEN THE SERVER IS CURRENT ═══
 *
 * THE HEADER WENT SILENT, AND THE OWNER NOTICED WITHIN A DAY. Before the
 * feed chips were removed there was always something in this cluster — Live,
 * Falling behind, Feed lost — so "the console has looked and everything is
 * fine" and "the console has not looked" were told apart at a glance. With them
 * gone, every remaining chip needed a POSITIVE abnormal reading to appear: an
 * update to ship, a maintenance window, a deploy in flight, a deploy that
 * failed. On an ordinary day with a healthy server the whole cluster was empty.
 * The owner, on a freshly built console taking heartbeats: the chips "no longer
 * appear ... until AFTER an fxserver update is kicked off". They were describing
 * exactly that — the first thing the header had to say all day was "Updating".
 *
 * SO THE SETTLED CASE IS STATED TOO, and this chip is where it belongs, because
 * "is the running server current with the code it is meant to be running" is a
 * question with two answers and the console knows both. `Update available` and
 * `Up to date` are the same reading reported either way round.
 *
 * IT IS NOT THE FEED CHIP UNDER ANOTHER NAME, which is the line that must not be
 * crossed: nothing here reads `lastPushAt`, nothing ages, and nothing turns
 * amber because a poll was missed. It is a fact about which COMMIT is deployed,
 * from the SSH status poll, and it changes a handful of times a week.
 *
 * "NOT KNOWING" STILL SHOWS NOTHING AT ALL. Unconfigured, unreachable, or
 * simply never polled all still render null — see `tick`, which publishes null
 * for each of those. `Up to date` is a claim, and it is only ever made off a
 * host that positively said so.
 *
 * IT MEASURES AGAINST WHATEVER REF THE BOX IS ON. Two different distances can
 * be called "behind" here: on main it is `behindMain`, the distance from
 * reviewed code; parked on a branch it is `refUpdate.behind`, the distance from
 * the tip of the branch somebody is pushing to. The first is what a deploy from
 * here would close on main; off main a deploy closes the second and leaves the
 * first exactly where it was.
 *
 * THE LABEL NO LONGER NAMES THE BRANCH, on the owner's instruction: "The
 * 'update on dev' chip needs to specifically only exactly say 'UPDATE
 * AVAILABLE'". It used to read "Update on dev" when parked, so that the two
 * distances could be told apart in the markup rather than only on hover. The
 * branch is still named — in the tooltip, and in the off-main banner that sits
 * across the top of every page of a parked console, which is a louder statement
 * of the same fact than three words in a chip ever were.
 *
 * NO COUNT, ON EITHER REF, since #26. The owner: "we don't need it to show how
 * many commits anything is behind — just 'update available'". The number was
 * doing two jobs and only one of them honestly: it disambiguated WHICH distance
 * was meant, which the ref name does better, and it implied a magnitude nobody
 * acts on — three commits and thirty are the same decision, and the same drain.
 * The commits themselves are on the Maintenance page this chip links to, where
 * there is room to show them and where the deploy actually happens.
 *
 * AND IT NEVER GUESSES BEFORE THE FIRST POLL. Both readings come from the
 * lib/maintenance derivations, which answer `null` for "we have not been told" —
 * never `0`. This chip renders nothing in that case, which it also does when the
 * server is current, so the visible behaviour is unchanged; what changed is that
 * it is no longer one refactor away from claiming an update it has not seen.
 */
export function UpdateBadge() {
  /** `ref` null means the chip is about main. Null state = show nothing. */
  const chip = useSyncExternalStore(subscribe, () => value, () => null)

  if (!chip) return null

  const behind = chip.behind

  const sentence = behind
    ? chip.ref
      ? `The game server is not running the newest commit on ${chip.ref}, the branch it is parked on. Open Maintenance to see which commit it would move to, and to deploy it.`
      : 'The game server is not running the latest code on main. Open Maintenance to see which commit it would move to, and to deploy it.'
    : chip.ref
      ? `The game server is running the newest commit on ${chip.ref}, the branch it is parked on. Nothing on that branch is waiting to ship — note that this says nothing about main, which the box is not on.`
      : 'The game server is running the latest code on main. There is nothing waiting to deploy.'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/maintenance"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ring-1 ring-inset transition-colors',
              /*
                THE SETTLED STATE IS QUIET, AND THAT IS THE WHOLE DESIGN OF THE
                PAIR. "Up to date" is true almost all of the time, so it is
                painted in the muted token the console uses for "nothing to do
                here" — present enough to prove the header is awake, dim enough
                that the day it changes to the info-coloured "Update available"
                the difference is the thing your eye catches. Two chips in the
                same colour would have made the standing state and the actionable
                one equally loud, which is how a chip becomes wallpaper.
              */
              behind
                ? 'bg-info/10 text-info ring-info/30 hover:bg-info/20'
                : 'bg-muted/40 text-muted-foreground ring-border hover:bg-muted/60',
            )}
          />
        }
      >
        {behind ? (
          <ArrowUpCircle className="size-3.5" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
        {/*
          Icon-only below `xl`, so the header's right-hand cluster cannot crowd
          the search bar. Safe to hide here specifically because this badge
          already has a tooltip carrying more than the label does.

          "UPDATE AVAILABLE", EXACTLY, ON EITHER REF (owner). It read "Update on
          dev" when the box was parked, so that the two distances "behind" can
          mean were distinguishable in the markup. The branch now lives in the
          tooltip and in the off-main banner directly below the header, which
          says the same thing at a size that cannot be missed.

          IT USED TO CARRY A COUNT AS WELL ("3 behind dev"), removed in #26: the
          number implied a magnitude nobody acts on — three commits and thirty
          are the same decision and the same drain — and the commits themselves
          are on the Maintenance page this links to.
        */}
        <span className="hidden xl:inline">
          {behind ? 'Update available' : 'Up to date'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[20rem]">
        {sentence}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The chip's state, and the poller that fills it — BOTH AT MODULE SCOPE.
 *
 * THIS WAS `useState` + `useEffect`, AND THE HEADER RE-MOUNTS. `AppShell` is
 * rendered by each page rather than by a layout, so every client-side
 * navigation unmounts the whole header and mounts a new one. Component state
 * therefore restarted at `null` on every navigation, which for this chip means
 * IT DISAPPEARED and came back a round trip later — a badge flickering out of
 * the header each time you clicked a nav item, on a console where the badge's
 * whole value is being trustworthy at a glance. The interval restarted too, so
 * every navigation also cost an extra `/api/host` fetch.
 *
 * A MODULE-LEVEL STORE SURVIVES THE RE-MOUNT because the module is loaded once.
 * The new instance reads the last known value synchronously on its first render
 * and the chip never blinks. This is the same shape as `lib/livePoll` and for
 * the same reason; it is kept here rather than folded into that one because the
 * two poll different endpoints on deliberately different cadences — live state
 * every two seconds, a deploy-scale fact every thirty.
 *
 * THE TIMER IS REFERENCE-COUNTED, so a console with no header mounted stops
 * asking, and the LAST value is deliberately retained when it does. That is the
 * point: it is what the next header renders instantly.
 */
/**
 * What the header is showing.
 *
 *   null            the console has no answer — unconfigured, unreachable, or
 *                   not yet polled. Renders nothing, and MUST: `Up to date` on
 *                   a host nobody has reached is a claim about a box we have
 *                   not looked at, which is the failure #26 was opened over.
 *   { behind: … }   a host that answered. `behind` is which way round.
 *   ref             null = the reading is about main; a string = the branch the
 *                   box is parked on, which is a different distance entirely.
 */
interface Chip {
  ref: string | null
  behind: boolean
}

let value: Chip | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function publish(next: Chip | null): void {
  const same =
    (next === null && value === null) ||
    (next !== null &&
      value !== null &&
      next.ref === value.ref &&
      next.behind === value.behind)
  if (same) return
  value = next
  listeners.forEach((l) => l())
}

async function tick(): Promise<void> {
  try {
    const res = await fetch('/api/host', { cache: 'no-store' })
    if (!res.ok) return

    /**
     * `RefUpdate` IN FULL, NOT A HAND-WRITTEN SUBSET. This was
     * `{ ref: string; behind: number }` — a narrower shape that silently DROPPED
     * `stale`, so the one field that distinguishes "the branch has not moved"
     * from "the box could not finish its fetch" never reached the decision.
     * Naming the real type is what makes `refBehindNow` able to apply its own
     * rules here, rather than this file re-deciding a subset of them by accident.
     */
    const v = (await res.json()) as {
      configured?: boolean
      status?: { behindMain?: number; deployedRef?: string } | null
      refUpdate?: RefUpdate | null
    }

    if (!v.configured || !v.status) {
      publish(null)
      return
    }

    /**
     * THE TEST IS DELIBERATELY THE OPPOSITE POLARITY TO `isOnMain`, and the
     * asymmetry is the point. `isOnMain` gates the AUTOMATION and reads a
     * missing `deployedRef` as "not main", because a host too old to answer must
     * not have deploys fired at it automatically. This is a chip: a host too old
     * to answer is a host that has always shown this chip against main, and
     * changing that would be a silent regression on a box that is fine. Gate the
     * automation pessimistically, gate the decoration on a stated fact.
     */
    const ref = v.status.deployedRef
    const parked = typeof ref === 'string' && ref !== 'main'

    if (parked) {
      /**
       * THE READING HAS TO BE FOR THE BRANCH THE BOX IS ON RIGHT NOW, and
       * `refBehindNow` is where that rule lives. `refUpdate` is re-read on its
       * own cadence, so for the few seconds after a switch lands the poller
       * still holds the previous branch's count while `deployedRef` already
       * names the new one; pairing them would put an old reading under a new
       * branch's name, which is the exact mislabelling this chip exists to
       * avoid. Null — mismatched, stale-zero, or never read — shows nothing.
       */
      const behind = refBehindNow(ref, v.refUpdate)
      publish(behind === null ? null : { ref, behind: behind > 0 })
      return
    }

    /**
     * THROUGH `behindMainNow`, NOT `?? 0`. The coalesce read an unanswered host
     * as "zero commits behind", which is a claim rather than a reading — and it
     * is the claim #26 was opened about. Null renders nothing, which is what "we
     * have not looked" should look like in a chip whose entire value is that it
     * only ever appears when there is genuinely something to ship.
     */
    const behind = behindMainNow(v.status)
    publish(behind === null ? null : { ref: null, behind: behind > 0 })
  } catch {
    /* leave the last value; a dropped poll is not news */
  }
}

/** A deploy is a minutes-scale event; thirty seconds keeps the header cheap. */
const POLL_MS = 30_000

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!timer) {
    timer = setInterval(() => void tick(), POLL_MS)
    void tick()
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
