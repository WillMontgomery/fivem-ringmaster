'use client'

import { ArrowUpCircle } from 'lucide-react'
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

/**
 * "Update available", in the header, on every page.
 *
 * IT BELONGS IN THE CHROME because "is the running server current with the code
 * it is meant to be running" is a standing fact about the deployment, not
 * something you should have to open the Host page to learn. It reads /api/host,
 * which answers from the telemetry poller's memory, on a slow cadence — a
 * deploy is a minutes-scale event, not a seconds-scale one, so 30s is plenty
 * and it keeps the header cheap.
 *
 * It renders NOTHING when the server is current, unconfigured, or unreachable.
 * A chip that is only ever present when there is genuinely an update to ship is
 * a chip an operator can trust at a glance; one that is always there is
 * wallpaper. Clicking it goes to Maintenance, where the deploy actually happens.
 *
 * IT MEASURES AGAINST WHATEVER REF THE BOX IS ON, and says which. Two different
 * distances can be called "behind" here and confusing them is worse than
 * showing nothing: on main it is `behindMain`, the distance from reviewed code;
 * parked on a branch it is `refUpdate.behind`, the distance from the tip of the
 * branch somebody is pushing to. The first is what a deploy from here would
 * close on main; off main a deploy closes the second and leaves the first
 * exactly where it was. So the parked chip names the branch in its own label
 * rather than only in the tooltip — "Update on dev" and "Update available" are
 * different sentences, and a reader who cannot tell them apart is worse off
 * than one who sees nothing.
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

  const sentence = chip.ref
    ? `The game server is not running the newest commit on ${chip.ref}, the branch it is parked on. Open Maintenance to see which commit it would move to, and to deploy it.`
    : 'The game server is not running the latest code on main. Open Maintenance to see which commit it would move to, and to deploy it.'

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href="/maintenance"
            className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2 py-1 text-xs font-medium uppercase tracking-wider text-info ring-1 ring-inset ring-info/30 transition-colors hover:bg-info/20"
          />
        }
      >
        <ArrowUpCircle className="size-3.5" />
        {/*
          Icon-only below `xl`, so the header's right-hand cluster cannot crowd
          the search bar. Safe to hide here specifically because this badge
          already has a tooltip carrying more than the label does.

          THE PARKED LABEL CARRIES THE BRANCH NAME, where the main label does
          not. That asymmetry is deliberate: on main there is only one thing
          "update available" can mean, and off main there are two — so the fact
          that distinguishes them is in the markup rather than only on hover,
          which is the floor docs/hover-text.md sets.

          IT USED TO CARRY THE COUNT AS WELL ("3 behind dev"). The count is gone
          on the owner's instruction and the ref stays, because the ref was the
          half doing the disambiguating; the number only ever said how much of
          something nobody was measuring in units they cared about.
        */}
        <span className="hidden xl:inline">
          {chip.ref ? `Update on ${chip.ref}` : 'Update available'}
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
let value: { ref: string | null } | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function publish(next: { ref: string | null } | null): void {
  const same =
    (next === null && value === null) ||
    (next !== null && value !== null && next.ref === value.ref)
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
      publish(behind !== null && behind > 0 ? { ref } : null)
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
    publish(behind !== null && behind > 0 ? { ref: null } : null)
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
