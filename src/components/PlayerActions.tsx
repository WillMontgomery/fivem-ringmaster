'use client'

import { Ban as BanIcon, Eye, Loader2, LogOut, ShieldOff } from 'lucide-react'
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
import { actionBar } from '@/lib/actionBar'
import { postJson } from '@/lib/api'

/**
 * THE SPECTATE BUTTON NO LONGER CARRIES A SENTENCE, and its removal is the
 * point rather than a tidy-up.
 *
 * `NO_SPECTATE_SCOPE` used to live here — "Spectating needs the spectate scope,
 * which this account does not have" — rendered into a tooltip and into an
 * `sr-only` span beside it. It was honest about the state and the state was the
 * bug: nothing in this console can grant a scope, so the sentence asked every
 * admin on the server to acquire something no surface hands out. The route
 * moved to the `view` scope (dba5a6a) and the button follows it here.
 *
 * SO SPECTATE IS NOW SHOWN-OR-ABSENT WITH NO THIRD STATE. Nothing explains what
 * spectating is, nothing explains why it is missing, and both silences are the
 * owner's standing rule rather than an omission.
 */

/**
 * Kick, ban and spectate, for the player whose page this is.
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
 * said — they are connected, they are already banned — is now carried by the
 * button the fact applies to, with the reason on hover.
 *
 * "YOU LACK THE SCOPE" WAS THE THIRD THING IT SAID, and that one is gone
 * outright rather than relocated. There are no scopes (lib/grants.ts): whoever
 * can open this profile can act from it, so no button here is ever greyed for a
 * permission and no tooltip has a second branch explaining one.
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
  adminOnline,
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
  /**
   * THE ACTING ADMIN is on the server right now.
   *
   * THE SAME QUESTION AS `online`, ASKED OF A DIFFERENT LICENSE, and derived
   * from the same `liveView` array at the same call site — not a second notion
   * of presence. It decides whether Spectate EXISTS, because the camera runs on
   * the admin's own client: reading the console in a browser at a desk, there
   * is no body in the world to put behind it.
   */
  adminOnline: boolean
}) {
  const router = useRouter()
  const [banOpen, setBanOpen] = useState(false)
  const [liftOpen, setLiftOpen] = useState(false)
  const [kickOpen, setKickOpen] = useState(false)
  /**
   * Spectate is the only action here with no dialog in front of it, so it is
   * the only one that can be fired twice by a double click. Every other button
   * opens something and the something owns the busy state.
   */
  const [watching, setWatching] = useState(false)

  /**
   * WHICH BUTTONS EXIST AND WHICH OF THEM WORK — ALL OF IT, FROM ONE FUNCTION.
   *
   * `const kick = { shown: !banned && online, enabled: canBan }` USED TO BE
   * THIS LINE, with every word of its reasoning above it. (The `enabled` half
   * has since gone entirely — no scope can withhold these buttons.) The reasoning moved
   * to `lib/actionBar.ts` unchanged; what changed is that it is no longer
   * written down twice. `ProfileView`'s loading skeleton has to draw the right
   * NUMBER of button-shaped rectangles before this component has rendered, so
   * it re-spelled the rule as `!banned && online ? 2 : 1` and carried a comment
   * admitting the two were "kept in step by hand". Spectate would have made
   * that two hand-kept copies of two rules.
   *
   * So both readers call the same function and the skeleton counts
   * `bar.buttons`. THE ONE THING THAT STILL HAS TO BE KEPT IN STEP is that
   * every input remains knowable without Discord — see the note in that file.
   *
   * `src/lib/actionBar.check.ts` drives this function over the whole truth
   * table AND asserts that this file still gates each button on it, because a
   * correct rule with a call site that ignores it is the failure this repo
   * keeps shipping.
   */
  const bar = actionBar({ banned, online, adminOnline })

  /**
   * Ask the game to point this admin's camera at this player (#192).
   *
   * NO CONFIRMATION STEP, and that is a choice rather than an omission. A kick
   * and a ban each open a dialog because each needs a reason the player will
   * read; nobody reads this one, because the whole point is that the subject is
   * not told. What would a confirm box ask? "Yes, watch them" adds a click and
   * no information — and the record that makes this accountable is the audit
   * row `/api/spectate` writes before the command leaves, not a box the admin
   * clicked through.
   *
   * THE SESSION IS NOT ENDED FROM HERE, EITHER. The admin stops it from the
   * game's own pause menu, and it stops itself if the target disconnects (#192,
   * the owner). Neither is something the console asked for, so neither is a
   * button here — a "Stop spectating" control in a browser tab would be a
   * second way to end a session that has already ended itself.
   */
  const watch = async () => {
    setWatching(true)
    try {
      await postJson('/api/spectate', { license, playerName: name })
      toast.success(`Spectating ${name}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Spectate failed.')
    } finally {
      setWatching(false)
    }
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
      <div className="flex items-center gap-2">
        {/*
          SPECTATE IS FIRST BECAUSE IT IS THE LIGHTEST. The row runs
          watch → remove → bar, which is the order of how much of somebody's
          evening it costs, and it is the order a moderator escalates in.

          IT IS ABSENT UNLESS BOTH PEOPLE ARE IN-GAME — the player, and the
          admin reading this page. See `spectate` in lib/actionBar.ts for why
          the admin's own presence is half the rule. Nothing marks the gap; a
          ghost button explaining that nobody is on the server would be text
          nobody asked for.

          NO TOOLTIP ON THIS BUTTON AT ALL, and the wrapper is gone rather than
          left empty.

          It had exactly one branch — the scope sentence — and the scope is
          gone, so a `<Tooltip>` around it would render nothing on every path.
          Kick beside it keeps its popup because Kick still has a scope that can
          genuinely be missing. Writing a popup for the ENABLED state instead
          would be a sentence explaining what spectating is, which is the one
          thing this feature was told not to add; a button labelled "Spectate"
          is not improved by a pill repeating the word.

          `disabled` IS NOW ONLY THE DOUBLE-CLICK GUARD. Spectate is the only
          action here with no dialog in front of it, so `watching` is the whole
          of it — there is no permission that can withhold a button that is
          drawn.
        */}
        {bar.spectate.shown && (
          <Button
            variant="outline"
            size="sm"
            disabled={watching}
            onClick={watch}
          >
            {watching ? <Loader2 className="animate-spin" /> : <Eye />}
            Spectate
          </Button>
        )}

        {/*
          KICK IS ABSENT ALTOGETHER WHENEVER THERE IS NOBODY TO KICK — while a
          ban is in force, and while the player is offline. See `kick` in
          lib/actionBar.ts for both. Nothing marks either gap: a caption or a
          ghost button explaining the absence would be text nobody asked for.

          WHAT IS LEFT ON HOVER IS WHAT THE BUTTON DOES, and nothing else. The
          scope branch that used to grey this button and the one beside it went
          with the scopes themselves — see lib/actionBar.ts.
        */}
        {bar.kick.shown && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setKickOpen(true)}
                />
              }
            >
              <LogOut />
              Kick
            </TooltipTrigger>
            {/*
              NO "not connected" BRANCH ANY MORE, and it is not an oversight:
              `kick.shown` now requires `online`, so this tooltip is only ever
              read over a player who is here. A branch for the offline case
              would be unreachable text asserting something the button's own
              presence contradicts.
            */}
            <TooltipContent side="bottom">
              Remove them from the server now. Does not ban.
            </TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              banned ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLiftOpen(true)}
                />
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBanOpen(true)}
                />
              )
            }
          >
            {banned ? <ShieldOff /> : <BanIcon />}
            {banned ? 'Lift ban' : 'Ban'}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {banned
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
