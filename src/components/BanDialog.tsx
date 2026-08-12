'use client'

import { AlertTriangle, Ban as BanIcon, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

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

const MIN_REASON = 15

const DURATIONS = [
  { value: '1', label: '24 hours' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
] as const

function expiryLabel(days: number | null): string {
  if (days === null) return 'permanently'
  const when = new Date(Date.now() + days * 86_400_000)
  return `until ${when.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export function BanDialog({
  license,
  name,
  online,
  open,
  onOpenChange,
}: {
  license: string
  name: string
  /** Drives the "they will be kicked immediately" warning. */
  online: boolean
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
      const res = await fetch('/api/bans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          license,
          reason: reason.trim(),
          playerName: name,
          days: effectiveDays,
        }),
      })
      const d = (await res.json()) as {
        ok?: boolean
        error?: string
        kicked?: { attempted: boolean; ok: boolean; error?: string }
      }
      if (!res.ok || !d.ok) throw new Error(d.error ?? 'Ban failed.')

      // The toast names the player and the expiry, because "Ban recorded" a
      // second after clicking Confirm tells you nothing you did not already
      // know — and if the wrong row was open, the NAME is what reveals it.
      const expiry =
        effectiveDays === null ? 'permanently' : expiryLabel(effectiveDays)

      if (d.kicked?.attempted && d.kicked.ok) {
        toast.success(`${name} banned ${expiry} and removed from the server.`)
      } else if (d.kicked?.attempted) {
        toast.warning(
          `${name} banned ${expiry}, but the kick failed — they stay in until they reconnect.`,
          { description: d.kicked.error },
        )
      } else {
        toast.success(`${name} banned ${expiry}.`)
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
              <DialogTitle>Ban {name}</DialogTitle>
              <DialogDescription>
                The reason is shown to the player. Keep it specific enough to
                stand up to an appeal.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ban-reason">Reason</Label>
                <Textarea
                  id="ban-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Aimbot through walls in match 3 — clip in #reports"
                />
                <p
                  className={
                    reasonOk
                      ? 'text-[11px] text-muted-foreground'
                      : 'text-[11px] text-warn'
                  }
                >
                  {reasonOk
                    ? `${reason.trim().length} characters`
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
                    <SelectValue placeholder="Choose a length" />
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
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
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

            <div className="space-y-2 text-[13px]">
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
