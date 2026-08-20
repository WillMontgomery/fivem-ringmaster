'use client'

import { AlertTriangle, Loader2, LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { postJson } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Kick a connected player, with a reason they actually see.
 *
 * THE REASON IS THE WHOLE POINT OF THIS DIALOG. Kicking used to fire straight
 * from a confirm, so the player was dropped with a generic "Kicked by an admin"
 * and no idea what they had done — which produces exactly one outcome: they
 * reconnect and do it again, then complain in Discord that they were kicked for
 * nothing. The admin knows why; the person who needs to know does not.
 *
 * A LOWER BAR THAN A BAN, deliberately. A ban demands 15 characters because it
 * is what the player appeals against, weeks later, to somebody who was not
 * there. A kick is a nudge — "you are blocking the bus door" — and demanding a
 * paragraph for it means the kick either does not happen or gets typed as
 * "asdf". Short and true beats long and fake.
 */

const MIN_REASON = 5

export function KickDialog({
  license,
  name,
  incidentId,
  open,
  onOpenChange,
}: {
  license: string
  name: string
  /**
   * The incident this kick is the verdict on, when it was chosen from one.
   *
   * THE FIVE-CHARACTER FLOOR STAYS FIVE HERE, and that is deliberate rather
   * than an oversight of the ban's fifteen. The floor is set by who reads the
   * string and what they do with it, not by the screen it was typed on: a kick
   * reason is read once, by somebody being dropped, and the argument written at
   * the top of this file — short and true beats long and fake — does not stop
   * being true because the kick was chosen as a verdict. The reason still lands
   * on the incident and in the audit log in full.
   */
  incidentId?: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const reasonOk = reason.trim().length >= MIN_REASON

  const close = (v: boolean) => {
    if (busy) return
    if (!v) setReason('')
    onOpenChange(v)
  }

  const submit = async () => {
    setBusy(true)
    try {
      const d = await postJson<{
        ok?: boolean
        error?: string
        incident?: { closed: boolean; error?: string }
      }>('/api/kick', {
        license,
        playerName: name,
        reason: reason.trim(),
        ...(incidentId ? { incidentId } : {}),
      })

      // Same rule as the ban dialog: the kick happened either way, and an
      // incident that did not close is the only part still needing attention.
      if (incidentId && d.incident && !d.incident.closed) {
        toast.warning(`${name} was kicked, but the incident was not closed.`, {
          description: d.incident.error,
        })
      } else {
        toast.success(`${name} was kicked.`, {
          description: `They were shown: “${reason.trim()}”`,
        })
      }
      setReason('')
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Kick failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-danger" />
            Kick {name}?
          </DialogTitle>
          <DialogDescription>
            They are removed immediately, mid-match. A kick is not a ban —
            nothing stops them reconnecting straight away.
          </DialogDescription>
          {/*
            THE VERDICT IS THE PERMANENT HALF OF THIS, and it is the opposite way
            round from what the sentence above says: the kick is the reversible
            action and the record of it is not. Somebody reading only "nothing
            stops them reconnecting" would reasonably assume the whole thing was
            undoable. It is also where the reporter warning goes, for the same
            reason it is on the ban dialog — this box is the only one in the
            console reached from a screen showing who filed the report.
          */}
          {incidentId && (
            <div className="space-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground ring-1 ring-inset ring-border">
              <p>
                The reason below is shown to {name} as they are dropped. Do not
                name whoever reported them.
              </p>
              {/*
                THE VERDICT SENTENCE IS GONE FROM ALL THREE BOXES (owner, playtest
                2026-08-21). It read "The incident is closed with a verdict of X.
                Verdicts are final -- this cannot be edited, re-resolved or reopened."

                It was consolidated onto one wording across the three boxes earlier the
                same evening and then removed outright. That is not a reversal: the
                consolidation was about the three agreeing, and they still do -- at
                nothing.

                WHAT IS LOST, SO NOBODY RE-ADDS IT BY ACCIDENT. Finality is real and
                still enforced -- lib/incidents.ts allows only pending_review and
                resolved, a resolved case cannot be reopened, and a verdict cannot be
                rewritten. The confirm step no longer SAYS so. Ban and kick each keep
                their own consequence line and their reason field, which is what the
                owner kept when the rest went.
              */}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="kick-reason">Reason — shown to the player</Label>
          <Textarea
            id="kick-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Blocking the bus door — stop it"
          />
          {/*
            THE SHORTFALL LINE IS THE NO-ACTION CONFIRM'S TOO, and so is its
            silence once the floor is cleared. This box said "At least 5
            characters — they see this, so it has to mean something." while the
            other two counted "(0 so far)", and it answered a satisfied field
            with a sentence where the other two say nothing. The floor is still
            five and the satisfied half is gone, which is the same cut the owner
            already made on the no-action line.

            THE ROW KEEPS ITS HEIGHT for the reason it does over there: one
            line of reserved space, so the dialog does not jump and move the
            confirm button out from under the pointer.
          */}
          <p className={cn('min-h-4 text-xs', !reasonOk && 'text-warn')}>
            {reasonOk
              ? null
              : `At least ${MIN_REASON} characters (${reason.trim().length} so far).`}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => close(false)}>
            Go back
          </Button>
          <Button
            variant="destructive"
            disabled={busy || !reasonOk}
            onClick={submit}
          >
            {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
            {busy ? 'Kicking…' : 'Confirm kick'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
