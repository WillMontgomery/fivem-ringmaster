'use client'

import { Ban as BanIcon, LogOut, ShieldOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { BanDialog } from '@/components/BanDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { KickDialog } from '@/components/KickDialog'
import { Button } from '@/components/ui/button'
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
 * BUTTONS, NOT A BAR (#22 items 1 and 2). This used to be its own Card sitting
 * above the profile, with a heading and a line of help text under it. It is now
 * a bare row of buttons that the profile's top bar renders beside the player's
 * name — the owner's words: "The moderation bar should have buttons built-into
 * the profile top bar", and "The help text in the moderation bar is not
 * helpful, it can be removed altogether".
 *
 * IT RENDERS NO CONTAINER OF ITS OWN, deliberately. Whoever places it owns the
 * layout; this component owns only what the buttons do. That is also what lets
 * the /preview harness drop it into the same top bar without a session.
 *
 * THE HELP TEXT IS GONE BUT ITS INFORMATION IS NOT. Everything the paragraph
 * said — they are connected, they are already banned, you lack the scope — is
 * now carried by the button that the fact applies to: enabled or disabled, with
 * the reason on hover. A disabled control with no explanation is a bug report
 * waiting to be filed, which is why nothing here is merely greyed out.
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
      <div className="flex items-center gap-2">
        {/*
          Kick is disabled when they are not here, because there is nothing to
          kick — and it says so on hover rather than being mysteriously greyed
          out. Without the `ban` scope both buttons disable the same way and
          say why, which is where the removed "you can see this record but not
          act on it" paragraph went.
        */}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={online && canBan ? undefined : 'cursor-not-allowed'}
              />
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!online || !canBan}
              onClick={() => setKickOpen(true)}
            >
              <LogOut />
              Kick
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {!canBan
              ? 'Kicking needs the ban scope, which this account does not have.'
              : online
                ? 'Remove them from the server now. Does not ban.'
                : `${name} is not connected — there is nobody to kick.`}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={<span className={canBan ? undefined : 'cursor-not-allowed'} />}
          >
            {active ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canBan}
                onClick={() => setLiftOpen(true)}
              >
                <ShieldOff />
                Lift ban
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                disabled={!canBan}
                onClick={() => setBanOpen(true)}
              >
                <BanIcon />
                Ban
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {!canBan
              ? 'Banning needs the ban scope, which this account does not have.'
              : active
                ? `Let ${name} join again. The ban record is kept.`
                : online
                  ? 'Ban them. They are on the server, so it removes them immediately.'
                  : 'Ban them. It applies the next time they try to join.'}
          </TooltipContent>
        </Tooltip>
      </div>

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
