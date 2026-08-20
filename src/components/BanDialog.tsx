'use client'

import { AlertTriangle, Ban as BanIcon, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { useFormatInstant } from '@/components/PrefsProvider'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Issue a ban, in two deliberate steps.
 *
 * THE SECOND STEP EXISTS BECAUSE THE FIRST ONE IS EASY TO GET WRONG. Banning is
 * the most consequential thing this console does to a person, it is usually
 * done in a hurry while something annoying is happening, and — now that a ban
 * kicks a connected player immediately — it interrupts someone mid-match. A
 * confirm step that restates WHO and FOR HOW LONG is the cheapest possible
 * guard against the wrong name and the wrong duration.
 *
 * The minimum reason length is not bureaucracy either. The reason is shown to
 * the player as they are dropped and is the only thing they have to appeal
 * against; "cheating" tells them nothing and tells the next admin reading the
 * audit log even less.
 */

/**
 * EXPORTED BECAUSE IT IS A RULE, NOT A LOCAL.
 *
 * The incident page's "no action" verdict asks for a reason with the same floor,
 * because it closes the same kind of case with the same finality — and a second
 * `const MIN_REASON = 15` over there would be a second place to change it. This
 * is the origin; anything that needs the number imports it from here.
 */
export const MIN_REASON = 15

const DURATIONS = [
  { value: '1', label: '24 hours' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
] as const

export function BanDialog({
  license,
  name,
  online,
  incidentId,
  open,
  onOpenChange,
}: {
  license: string
  name: string
  /** Drives the "they will be kicked immediately" warning. */
  online: boolean
  /**
   * The incident this ban is the verdict on, when it was chosen from one.
   *
   * THE SAME DIALOG, NOT A COPY OF IT. The owner asked for the incident page to
   * offer a ban "with the same 'are you sure', character requirement, and
   * pre-defined terms/perma options that exist already" — so it opens this,
   * with one more field in the request body. Everything the admin sees, every
   * validation, and the `ban.issue` row that comes out are identical to a ban
   * issued from a profile, because they are the same code.
   *
   * IT ALSO CLOSES THE INCIDENT, server-side, in the same request. The two
   * cannot be separated by a failed second fetch or a closed tab, and the
   * verdict records the ban this route actually wrote rather than the one the
   * browser asked for.
   */
  incidentId?: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [days, setDays] = useState<string>('1')
  const [permanent, setPermanent] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const effectiveDays = permanent ? null : Number(days)
  const reasonOk = reason.trim().length >= MIN_REASON

  /**
   * "until Aug 19, 14:20 EDT" — in the reader's stated zone, and labelled.
   *
   * THE ZONE SUFFIX MATTERS MORE HERE THAN ANYWHERE ELSE in the console. This
   * sentence is the confirm step for cutting somebody off for three days, and
   * an unlabelled time in a zone the reader did not choose is exactly how a ban
   * gets confirmed for the wrong moment.
   *
   * `Date.now()` during render is safe in this one case and nowhere else: Base
   * UI does not mount a dialog's content until it opens, so this only ever runs
   * in the browser after a click. There is no server render to disagree with.
   */
  const { format } = useFormatInstant()
  const expiryLabel = (d: number | null) =>
    d === null
      ? 'permanently'
      : `until ${format(Date.now() + d * 86_400_000, { withYear: false })}`

  const reset = () => {
    setReason('')
    setDays('1')
    setPermanent(false)
    setConfirming(false)
  }

  const close = (v: boolean) => {
    if (busy) return
    if (!v) reset()
    onOpenChange(v)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const d = await postJson<{
        ok?: boolean
        error?: string
        kicked?: { attempted: boolean; ok: boolean; error?: string }
        incident?: { closed: boolean; error?: string }
        /**
         * The other cases this ban closed, present only on a permanent ban that
         * found some. See `closeOthersOnPermanentBan` in lib/incidents.
         */
        alsoClosed?: {
          found: number
          closed: number
          refused: number
          failed: number
          leftOpen: number
          lookupFailed: boolean
        }
      }>('/api/bans', {
        license,
        reason: reason.trim(),
        playerName: name,
        days: effectiveDays,
        ...(incidentId ? { incidentId } : {}),
      })

      // The toast names the player and the expiry, because "Ban recorded" a
      // second after clicking Confirm tells you nothing you did not already
      // know — and if the wrong row was open, the NAME is what reveals it.
      const expiry =
        effectiveDays === null ? 'permanently' : expiryLabel(effectiveDays)

      /**
       * THE VERDICT FAILING IS ITS OWN SENTENCE, and it wins over the kick's.
       *
       * The ban happened either way — that is the loud part and it is already
       * true — but "the case was closed by somebody else while you were typing"
       * is the only outcome here that leaves work undone, so it is the one the
       * admin has to read. Reporting it as a plain success would leave them
       * believing they had resolved something they had not.
       */
      if (incidentId && d.incident && !d.incident.closed) {
        toast.warning(
          `${name} banned ${expiry}, but the incident was not closed.`,
          { description: d.incident.error },
        )
      } else if (d.kicked?.attempted && d.kicked.ok) {
        toast.success(`${name} banned ${expiry} and removed from the server.`)
      } else if (d.kicked?.attempted) {
        toast.warning(
          `${name} banned ${expiry}, but the kick failed — they stay in until they reconnect.`,
          { description: d.kicked.error },
        )
      } else {
        toast.success(`${name} banned ${expiry}.`)
      }

      /**
       * THE OTHER CASES GET THEIR OWN TOAST, and that is not one toast too many.
       *
       * A permanent ban closes every other open case about the same player, so
       * the incidents badge can drop by five the moment this returns — and a
       * queue that empties with no explanation is the thing an admin cannot
       * unsee. It is separate from the ban's toast because it is a separate
       * fact, on cases the admin never opened, and because the ban's sentence is
       * already carrying the kick and the verdict.
       *
       * WORDED BY THIS TASK AND AWAITING THE OWNER'S WORDS, exactly like the
       * note written onto the cases themselves.
       */
      const also = d.alsoClosed
      if (also) {
        const cases = (n: number) => `${n} other case${n === 1 ? '' : 's'}`

        if (also.lookupFailed) {
          toast.warning(
            `Other open cases about ${name} could not be read, so none were closed.`,
          )
        } else if (also.failed > 0 || also.leftOpen > 0) {
          toast.warning(
            `Closed ${cases(also.closed)} about ${name}, out of ${also.found}.`,
            { description: 'The rest are still in the incident queue.' },
          )
        } else if (also.closed > 0) {
          toast.success(`Closed ${cases(also.closed)} about ${name}.`)
        }
      }

      reset()
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ban failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {!confirming ? (
          <>
            <DialogHeader>
              {/*
                THE DANGER ICON IS ON ALL THREE VERDICT BOXES NOW (owner,
                playtest: "please use the same danger icon for 'no action' on
                the kick/ban ones"). Kick had it, the no-action confirm has it
                from `ConfirmDialog`, and this — the first thing an admin sees
                when they choose Ban — was the one heading in the set with
                nothing beside it.
              */}
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-danger" />
                Ban {name}
              </DialogTitle>
              {/*
                THE WARNING IS ONLY ON THE INCIDENT PATH, AND THAT IS THE POINT.
                The reason has always been shown to the banned player; what is
                new is WHERE it gets typed. On an incident page the reporter's
                name is on screen, a few lines above this box, so "reported by
                Marla for aimbot" is the natural thing to type — and it would be
                shown to the person Marla reported, as they are dropped. The
                gamemode already treats that as a rule rather than a preference
                (#93: an offender must be shown nothing at all), and a console
                that hands them the name of their reporter breaks it from the
                other end. Nowhere else in the console is a reporter's name on
                the same screen as this field, so nowhere else needs the line.
              */}
              <DialogDescription>
                {incidentId
                  ? 'The reason is shown to the player as they are dropped. Do not name whoever reported them.'
                  : 'The reason is shown to the player. Keep it specific enough to stand up to an appeal.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                {/*
                  THE LABEL IS THE KICK DIALOG'S, and that is the one thing the
                  owner asked to keep rather than to replace: "copy and paste
                  the same exact verbiage from No Action — but for kicks and
                  bans, keep the 'Reason (shown to the player)' text". The
                  no-action box asks "Why? Only admins ever see this", which is
                  the opposite claim and cannot be borrowed here. This field
                  said only "Reason" while the kick's said who reads it, so the
                  one fact that separates these two boxes from that one was
                  missing from the louder of them.
                */}
                <Label htmlFor="ban-reason">Reason — shown to the player</Label>
                <Textarea
                  id="ban-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Aimbot through walls in match 3 — clip in #reports"
                />
                {/*
                  THE SHORTFALL WORDING WAS ALREADY THE NO-ACTION CONFIRM'S;
                  what differed was the satisfied half, which counted characters
                  back at an admin who had already cleared the floor. The
                  no-action line lost its satisfied half at playtest and says
                  nothing once the field is long enough, so this one does too —
                  and the reserved line keeps the confirm button from moving as
                  the fifteenth character lands.
                */}
                <p className={cn('min-h-4 text-xs', !reasonOk && 'text-warn')}>
                  {reasonOk
                    ? null
                    : `At least ${MIN_REASON} characters (${reason.trim().length} so far).`}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ban-duration">Duration</Label>
                <Select
                  value={days}
                  onValueChange={(v) => setDays(v ?? '1')}
                  disabled={permanent}
                >
                  <SelectTrigger id="ban-duration" className="w-full">
                    {/* Base UI's Select.Value renders the raw VALUE unless it
                        is told how to render, so the trigger read "1" while the
                        open list correctly said "24 hours". Mapping it back to
                        the label keeps the closed and open states saying the
                        same thing — a duration field that reads "1" next to a
                        ban button is exactly the ambiguity this dialog exists
                        to remove. */}
                    <SelectValue placeholder="Choose a length">
                      {(value) =>
                        DURATIONS.find((d) => d.value === value)?.label ??
                        'Choose a length'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="ban-permanent"
                  checked={permanent}
                  onCheckedChange={(v) => setPermanent(v === true)}
                />
                <Label htmlFor="ban-permanent" className="font-normal">
                  Permanent — never expires
                </Label>
              </div>
            </div>

            <DialogFooter>
              {/*
                "GO BACK", NOT "CANCEL". The dismiss button reads "Go back" on
                the no-action confirm, on the kick dialog and on this dialog's
                own second step; this was the single place in the verdict set
                where the same control had a different name.
              */}
              <Button variant="ghost" onClick={() => close(false)}>
                Go back
              </Button>
              <Button
                variant="destructive"
                disabled={!reasonOk}
                onClick={() => setConfirming(true)}
              >
                <BanIcon />
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-danger" />
                Are you sure?
              </DialogTitle>
              <DialogDescription>
                Review this before it happens.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium text-foreground">{name}</span>{' '}
                    will be banned{' '}
                    <span className="font-medium text-foreground">
                      {effectiveDays === null
                        ? 'permanently'
                        : expiryLabel(effectiveDays)}
                    </span>
                    .
                  </p>
                  {online ? (
                    <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-danger">
                      They are on the server right now and will be{' '}
                      <strong>kicked immediately</strong>, mid-match, with this
                      reason shown to them.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      They are not connected. The ban applies the next time they
                      try to join.
                    </p>
                  )}
                  <p className="text-muted-foreground">“{reason.trim()}”</p>
                  {/*
                    THE LAST CHANCE HAS TO SAY WHAT BECOMES PERMANENT (owner,
                    2026-08-17: verdicts cannot be changed after the fact). There
                    is no edit screen, no re-resolve and no appeal path in this
                    console, so the sentence that would have been on one belongs
                    here instead — a confirm step that only restated the ban
                    would be hiding the half of this action that cannot be
                    revisited at all. The ban itself can at least be lifted.

                    IT IS THE NO-ACTION CONFIRM'S SENTENCE NOW, EXACTLY (owner,
                    playtest: "copy and paste the same exact verbiage from No
                    Action"). This one said "it" where that one says "this", and
                    it carried a fourth clause the other two boxes have no
                    equivalent of: "and lifting the ban later does not change
                    it". That clause was true — it is the line above, restated
                    from the verdict's side — but the ask was one wording across
                    the three, and this was the only one that had grown an extra
                    one. If it is wanted back it comes back as the owner's words
                    on all three, not as this box's alone.
                  */}
                  {incidentId && (
                    <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground ring-1 ring-inset ring-border">
                      The incident is closed with a verdict of{' '}
                      <span className="font-medium text-foreground">banned</span>
                      . Verdicts are final — this cannot be edited, re-resolved
                      or reopened.
                    </p>
                  )}
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Go back
              </Button>
              <Button variant="destructive" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="animate-spin" /> : <BanIcon />}
                {busy ? 'Banning…' : 'Confirm ban'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
