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
 *
 * ═══ "CURRENTLY BANNED" IS DECIDED ONCE, ON THE SERVER, AND ARRIVES AS A
 *     BOOLEAN ═══
 *
 * This component USED TO RE-DERIVE IT — `ban && !ban.liftedAt && (expiresAt ===
 * null || expiresAt > Date.now())`, a hand-copy of `bans.isActive` sitting one
 * component away from the BANNED chip that reads the real thing. Two
 * representations of one fact with nothing asserting they agree is this
 * project's signature bug, and this pair could drift on the two axes that matter
 * most: `Date.now()` here is the BROWSER's clock and a different instant from
 * the server's `now`, and any future change to what "lifted" or "expired" means
 * would land in `lib/bans` and not here.
 *
 * So the row is gone and `banned` comes down from `ProfileView`, which already
 * has it: the profile page computes it as `bans.isActive(ban, now)` — the one
 * rule — and hands the same boolean to the chip beside the player's name and to
 * these buttons. They cannot disagree because there is only one of it.
 *
 * THE `ban` ROW ITSELF IS NO LONGER A PROP. It was only ever here to be reduced
 * to that boolean, and a `Ban` shape passed to a component that does not read a
 * single field of it is an invitation to start.
 */
export function PlayerActions({
  license,
  name,
  banned,
  online,
  canBan,
}: {
  license: string
  name: string
  /**
   * A ban IN FORCE right now — `bans.isActive`, decided on the server.
   *
   * NOT "there is a ban row". A ban that was served or lifted is history, and
   * history must not take the kick button away or turn Ban into Lift ban.
   */
  banned: boolean
  /**
   * On the server right now.
   *
   * Decides whether the kick button EXISTS — not whether it is enabled; see
   * `kick` below. Also picks which of the two ban tooltips is true, because a
   * ban on somebody connected removes them and a ban on somebody absent waits.
   */
  online: boolean
  canBan: boolean
}) {
  const router = useRouter()
  const [banOpen, setBanOpen] = useState(false)
  const [liftOpen, setLiftOpen] = useState(false)
  const [kickOpen, setKickOpen] = useState(false)

  /**
   * EVERY CONDITION ON THE KICK BUTTON, IN ONE PLACE, AND THEY ARE TWO
   * DIFFERENT QUESTIONS.
   *
   *   shown    THERE IS SOMEBODY TO KICK. Two ways there is not, and both
   *            HIDE rather than grey out:
   *
   *            `!banned` — "the kick button should not be displayed on the
   *            profile page when a ban is in place" — the owner. A banned
   *            player is not somebody you kick, so there is no action being
   *            withheld and nothing to explain.
   *
   *            `online` — "let's remove the 'kick' button from the profile page
   *            if the user is offline" — the owner, and it MOVED HERE FROM
   *            `enabled`. It used to draw a dead button over an absent player.
   *            An action with no target is not an action being withheld either;
   *            it is one that does not exist right now, and a greyed control
   *            with a caption under it was the console explaining an absence
   *            nobody asked about. Nothing marks the gap.
   *
   *   enabled  `canBan`, and only that. It is the one condition that is
   *            genuinely about the ADMIN rather than the player: the action
   *            exists, there is somebody it would apply to, and this account
   *            may not take it. That stays DISABLED-with-a-reason on hover,
   *            because a permission you do not have is worth knowing about in a
   *            way that an empty seat is not.
   *
   * THE DISTINCTION THE TWO LINES DRAW, since it is the whole shape of this:
   * the state of the PLAYER decides whether the control is there at all, and
   * the scope of the ADMIN decides whether it works.
   *
   * A banned player who is somehow still connected is a transient state —
   * `/api/bans` kicks them in the same request — and it resolves towards the
   * button being irrelevant either way.
   *
   * `ProfileView`'s loading skeleton COUNTS THESE BUTTONS and must be changed
   * with this line. Both `banned` and `online` are known without waiting for
   * Discord, so the skeleton can draw the right number rather than drawing two
   * and resolving to one.
   */
  const kick = { shown: !banned && online, enabled: canBan }

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
          KICK IS ABSENT ALTOGETHER WHENEVER THERE IS NOBODY TO KICK — while a
          ban is in force, and while the player is offline. See `kick` above for
          both. Nothing marks either gap: a caption or a ghost button explaining
          the absence would be text nobody asked for.

          WHAT IS LEFT ON HOVER IS THE SCOPE. Without `ban` this button and the
          one beside it disable the same way and say why, which is where the
          removed "you can see this record but not act on it" paragraph went.
        */}
        {kick.shown && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className={kick.enabled ? undefined : 'cursor-not-allowed'} />
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={!kick.enabled}
                onClick={() => setKickOpen(true)}
              >
                <LogOut />
                Kick
              </Button>
            </TooltipTrigger>
            {/*
              NO "not connected" BRANCH ANY MORE, and it is not an oversight:
              `kick.shown` now requires `online`, so this tooltip is only ever
              read over a player who is here. A branch for the offline case
              would be unreachable text asserting something the button's own
              presence contradicts.
            */}
            <TooltipContent side="bottom">
              {canBan
                ? 'Remove them from the server now. Does not ban.'
                : 'Kicking needs the ban scope, which this account does not have.'}
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            render={<span className={canBan ? undefined : 'cursor-not-allowed'} />}
          >
            {banned ? (
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
              : banned
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
