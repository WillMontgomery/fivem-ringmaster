'use client'

import { ArrowUpCircle } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
 * rather than only in the tooltip — "3 behind dev" and "Update available" are
 * different sentences, and a reader who cannot tell them apart is worse off
 * than one who sees nothing.
 */
export function UpdateBadge() {
  /** `ref` null means the count is against main. Null state = show nothing. */
  const [chip, setChip] = useState<{ behind: number; ref: string | null } | null>(
    null,
  )

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/host', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const v = (await res.json()) as {
          configured?: boolean
          status?: { behindMain?: number; deployedRef?: string } | null
          refUpdate?: { ref: string; behind: number } | null
        }

        if (!v.configured || !v.status) {
          setChip(null)
          return
        }

        /**
         * THE TEST IS DELIBERATELY THE OPPOSITE POLARITY TO `isOnMain`, and the
         * asymmetry is the point. `isOnMain` gates the AUTOMATION and reads a
         * missing `deployedRef` as "not main", because a host too old to answer
         * must not have deploys fired at it automatically. This is a chip: a
         * host too old to answer is a host that has always shown this chip
         * against main, and changing that would be a silent regression on a box
         * that is fine. Gate the automation pessimistically, gate the
         * decoration on a stated fact.
         */
        const ref = v.status.deployedRef
        const parked = typeof ref === 'string' && ref !== 'main'

        if (parked) {
          /**
           * THE READING HAS TO BE FOR THE BRANCH THE BOX IS ON RIGHT NOW.
           *
           * `refUpdate` is re-read on its own cadence, so for the few seconds
           * after a switch lands the poller still holds the previous branch's
           * count while `deployedRef` already names the new one. Rendering the
           * two together would put an old number under a new branch's name —
           * the exact mislabelling this chip exists to avoid — so a mismatch
           * shows nothing until the next reading arrives.
           */
          const r = v.refUpdate
          setChip(r && r.ref === ref && r.behind > 0 ? { behind: r.behind, ref } : null)
          return
        }

        const behind = v.status.behindMain ?? 0
        setChip(behind > 0 ? { behind, ref: null } : null)
      } catch {
        /* leave the last value; a dropped poll is not news */
      }
    }
    void tick()
    const t = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!chip) return null

  const plural = chip.behind === 1 ? '' : 's'
  const sentence = chip.ref
    ? `The game server is ${chip.behind} commit${plural} behind ${chip.ref}, the branch it is parked on. Open Maintenance to deploy it.`
    : `The game server is ${chip.behind} commit${plural} behind main. Open Maintenance to deploy the latest.`

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

          THE PARKED LABEL CARRIES THE BRANCH NAME AND THE COUNT, where the main
          label carries neither. That asymmetry is deliberate: on main there is
          only one thing "update available" can mean, and off main there are two
          — so the fact that distinguishes them is in the markup rather than
          only on hover, which is the floor docs/hover-text.md sets.
        */}
        <span className="hidden xl:inline">
          {chip.ref ? `${chip.behind} behind ${chip.ref}` : 'Update available'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[20rem]">
        {sentence}
      </TooltipContent>
    </Tooltip>
  )
}
