'use client'

import { Ban as BanIcon, LogOut, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { BanDialog } from '@/components/BanDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KickDialog } from '@/components/KickDialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { postJson } from '@/lib/api'
import type { Ban } from '@/lib/bans'

/**
 * Kick and ban, for the player whose page this is.
 *
 * IT SITS AT THE TOP because it is what the page is FOR. A moderator opening a
 * profile has almost always already decided something is wrong; making them
 * scroll past match history to act on it optimises for the rare visit over the
 * common one.
 *
 * THE LICENSE IS ALREADY IN HAND, which is the whole reason these live here
 * rather than only on a form that asks you to paste one. Copying an identifier
 * between panels is how the wrong player gets banned.
 */
export function PlayerActions({
  license,
  name,
  ban,
  online,
  canBan,
}: {
  license: string
  name: string
  ban: Ban | null
  /** On the server right now — decides whether a kick is even possible. */
  online: boolean
  canBan: boolean
}) {
  const router = useRouter()
  const [banOpen, setBanOpen] = useState(false)
  const [liftOpen, setLiftOpen] = useState(false)
  const [kickOpen, setKickOpen] = useState(false)

  const active =
    ban && !ban.liftedAt && (ban.expiresAt === null || ban.expiresAt > Date.now())

  if (!canBan) {
    return (
      <Card className="surface-edge gap-0 px-5 py-4">
        <h2 className="text-sm font-medium">Moderation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You can see this player&rsquo;s record but not act on it — kicking and
          banning need the <code className="font-mono">ban</code> scope.
        </p>
      </Card>
    )
  }

  const lift = async () => {
    try {
      await postJson('/api/bans/lift', { license })
      toast.success(`Ban lifted for ${name}. The record is kept.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lift failed.')
    }
  }

  return (
    <>
      <Card className="surface-edge gap-0 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Moderation</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {active
                ? `Banned by ${ban!.byName} — “${ban!.reason}”`
                : online
                  ? 'On the server now. A ban removes them immediately.'
                  : 'Not connected. A ban applies the next time they join.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/*
              Kick is disabled when they are not here, because there is nothing
              to kick — and it says so on hover rather than being mysteriously
              greyed out. A disabled control with no explanation is a bug report
              waiting to be filed.
            */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className={online ? undefined : 'cursor-not-allowed'} />
                }
              >
                <Button
                  variant="outline"
                  disabled={!online}
                  onClick={() => setKickOpen(true)}
                >
                  <LogOut />
                  Kick
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {online
                  ? 'Remove them from the server now. Does not ban.'
                  : `${name} is not connected — there is nobody to kick.`}
              </TooltipContent>
            </Tooltip>

            {active ? (
              <Button variant="outline" onClick={() => setLiftOpen(true)}>
                <ShieldOff />
                Lift ban
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setBanOpen(true)}>
                <BanIcon />
                Ban
              </Button>
            )}
          </div>
        </div>
      </Card>

      <BanDialog
        license={license}
        name={name}
        online={online}
        open={banOpen}
        onOpenChange={setBanOpen}
      />

      <ConfirmDialog
        open={liftOpen}
        onOpenChange={setLiftOpen}
        title="Lift this ban?"
        confirmLabel="Confirm lift"
        busyLabel="Lifting…"
        onConfirm={lift}
        body={
          <>
            <p>
              <span className="font-medium text-foreground">{name}</span> will be
              able to join again immediately.
            </p>
            <p className="text-muted-foreground">
              The ban record is kept, with your name against the lift — nothing
              is deleted.
            </p>
          </>
        }
      />

      <KickDialog
        license={license}
        name={name}
        open={kickOpen}
        onOpenChange={setKickOpen}
      />
    </>
  )
}
