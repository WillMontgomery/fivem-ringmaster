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
 * IT BELONGS IN THE CHROME because "is the running server current with main" is
 * a standing fact about the deployment, not something you should have to open
 * the Host page to learn. It reads the same status the Host page does
 * (/api/host reports `behindMain` from the game box) but on a slow cadence —
 * a deploy is a minutes-scale event, not a seconds-scale one, so 30s is plenty
 * and it keeps the header cheap.
 *
 * It renders NOTHING when the server is current, unconfigured, or unreachable.
 * A chip that is only ever present when there is genuinely an update to ship is
 * a chip an operator can trust at a glance; one that is always there is
 * wallpaper. Clicking it goes to Maintenance, where the deploy actually
 * happens (built in M6 — the link is live now so the affordance is learned
 * before the page is).
 */
export function UpdateBadge() {
  const [behind, setBehind] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/host', { cache: 'no-store' })
        if (!res.ok || !alive) return
        const v = (await res.json()) as {
          configured?: boolean
          status?: { behindMain?: number } | null
        }
        setBehind(v.configured && v.status ? (v.status.behindMain ?? 0) : null)
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

  if (!behind || behind <= 0) return null

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
          Icon-only below `xl`, so the header's right-hand cluster cannot crowd the
          search bar. Safe to hide here specifically because this badge already has
          a tooltip carrying more than the label does -- it names how many commits
          behind the server is.
        */}
        <span className="hidden xl:inline">Update available</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[20rem]">
        The game server is {behind} commit{behind > 1 ? 's' : ''} behind main.
        Open Maintenance to deploy the latest.
      </TooltipContent>
    </Tooltip>
  )
}
